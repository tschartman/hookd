import { Audio, type AVPlaybackStatus } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { usePlayerStore } from '@/src/stores/playerStore';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Wait this long after the last track change before starting a network load. */
const LOAD_DEBOUNCE_MS = 150;

/**
 * Hard timeout for Audio.Sound.createAsync. On slow networks or when the iOS
 * audio engine is struggling, createAsync can hang indefinitely. After this
 * timeout we discard the result and retry once, then skip the track.
 */
const LOAD_TIMEOUT_MS = 2000;

/**
 * If onPlaybackStatusUpdate hasn't fired in this many ms during active playback,
 * assume the audio engine is frozen and force-reload the current track.
 */
const WATCHDOG_MS = 5000;

// ─── Global sound registry ────────────────────────────────────────────────────
// Tracks every Audio.Sound object currently alive. Used to detect leaks and to
// aggressively unload all sounds when navigating away from a feed screen.

const _soundRegistry = new Set<Audio.Sound>();

/**
 * Unload every tracked sound object and clear the registry.
 * Call this on screen unfocus (e.g. festival screen cleanup) to ensure
 * no Sound objects outlive the screen that created them.
 */
export function unloadAllSounds(): void {
  console.log(`[audio] unloadAllSounds — active sounds: ${_soundRegistry.size}`);
  _soundRegistry.forEach((s) => {
    s.unloadAsync().catch(() => {});
  });
  _soundRegistry.clear();
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** (Re-)initialise the audio session. Safe to call at any time. */
async function initAudioSession(): Promise<void> {
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
  }).catch((e) => console.warn('[audio] setAudioModeAsync failed:', e));
}

/**
 * Create an Audio.Sound with a hard timeout.
 * Returns the Sound on success, null on timeout or error.
 * Registers the sound in _soundRegistry on success.
 * If the underlying load completes after we've already timed out, the result
 * is unloaded immediately to avoid leaking sound objects.
 */
async function tryCreateSound(url: string): Promise<Audio.Sound | null> {
  type Outcome = { sound: Audio.Sound } | null;

  const loadPromise: Promise<Outcome> = Audio.Sound.createAsync(
    { uri: url },
    { shouldPlay: false, progressUpdateIntervalMillis: 500 },
  )
    .then((r) => ({ sound: r.sound }))
    .catch((e) => {
      console.warn('[audio] createAsync error:', e);
      return null;
    });

  const timeoutPromise: Promise<null> = new Promise((resolve) =>
    setTimeout(() => resolve(null), LOAD_TIMEOUT_MS),
  );

  const outcome = await Promise.race<Outcome>([loadPromise, timeoutPromise]);

  if (outcome === null) {
    // Timed out — clean up the eventual result so we don't leak a sound object.
    loadPromise.then((r) => {
      if (r?.sound) {
        _soundRegistry.delete(r.sound);
        r.sound.unloadAsync().catch(() => {});
      }
    });
    return null;
  }

  _soundRegistry.add(outcome.sound);
  console.log(`[audio] Active sounds: ${_soundRegistry.size}`);
  return outcome.sound;
}

/** Unload a sound and remove it from the registry. */
function releaseSound(sound: Audio.Sound | null): void {
  if (!sound) return;
  _soundRegistry.delete(sound);
  sound.unloadAsync().catch((e) => console.warn('[audio] unloadAsync failed:', e));
}

/**
 * Attempt sound.playAsync(). On failure, re-initialises the audio session,
 * waits 500 ms, then retries once. Returns true on success, false if both
 * attempts fail — caller should skip to the next track.
 */
async function playWithRetry(sound: Audio.Sound): Promise<boolean> {
  // Guard: confirm the sound is still loaded before calling playAsync.
  // "Cannot complete operation because sound is not loaded" happens when the
  // screen transition unloads the sound while an effect still tries to play it.
  const status = await sound.getStatusAsync().catch(() => null);
  if (!status?.isLoaded) {
    console.warn('[audio] playWithRetry: sound not loaded, skipping');
    return false;
  }
  try {
    await sound.playAsync();
    return true;
  } catch (firstErr) {
    console.warn('[audio] playAsync failed (attempt 1):', firstErr);
    // Re-init the session — iOS may have reset it after an interruption.
    await initAudioSession();
    await new Promise((r) => setTimeout(r, 500));
    // Re-check loaded status after the wait
    const statusRetry = await sound.getStatusAsync().catch(() => null);
    if (!statusRetry?.isLoaded) {
      console.warn('[audio] playWithRetry: sound unloaded during retry wait');
      return false;
    }
    try {
      await sound.playAsync();
      return true;
    } catch (secondErr) {
      console.warn('[audio] playAsync failed (attempt 2):', secondErr);
      return false;
    }
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAudioPlayer(options?: { onQueueExhausted?: () => void }) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const loadedTrackIdRef = useRef<string | null>(null);
  // Only ONE preloaded sound at a time — enough look-ahead without risking
  // the audio engine having too many objects alive simultaneously.
  const preloadedRef = useRef<Map<string, Audio.Sound>>(new Map());
  const durationMsRef = useRef<number>(0);

  // ── Debounce + generation tracking ─────────────────────────────────────────
  const loadGenRef = useRef(0);
  const loadCancelledRef = useRef(false);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Watchdog ────────────────────────────────────────────────────────────────
  // Reset on every status update. If it fires, audio engine is stuck.
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onQueueExhaustedRef = useRef(options?.onQueueExhausted);
  useEffect(() => { onQueueExhaustedRef.current = options?.onQueueExhausted; });

  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  // ─────────────────────────────────────────────────────────────────────────────
  // doLoadRef — the full load logic stored in a ref so it can be invoked from
  // both the debounced Effect-1 timeout AND from forced-reload paths (watchdog,
  // AppState recovery) without duplicating code.
  // ─────────────────────────────────────────────────────────────────────────────
  const doLoadRef = useRef<(trackId: string, gen: number) => Promise<void>>(
    async () => {},
  );

  doLoadRef.current = async (capturedTrackId: string, myGen: number) => {
    const { currentTrack, queue, queueIndex } = usePlayerStore.getState();

    if (currentTrack?.id !== capturedTrackId) return;

    if (!currentTrack.preview_url) {
      console.log('[audio] no preview_url, skipping');
      usePlayerStore.getState().nextTrack();
      return;
    }

    usePlayerStore.getState()._setLoadingAudio(true);

    // ── Unload previous sound BEFORE creating the new one (sequential) ───────
    // Parallel load/unload can confuse the iOS audio engine.
    const old = soundRef.current;
    soundRef.current = null;
    loadedTrackIdRef.current = null;
    if (old) {
      releaseSound(old);
    }

    if (loadCancelledRef.current || loadGenRef.current !== myGen) {
      usePlayerStore.getState()._setLoadingAudio(false);
      return;
    }

    // ── Resolve sound ─────────────────────────────────────────────────────────
    let sound: Audio.Sound | null;

    if (preloadedRef.current.has(capturedTrackId)) {
      sound = preloadedRef.current.get(capturedTrackId)!;
      preloadedRef.current.delete(capturedTrackId);
      console.log('[audio] using preloaded sound');
    } else {
      console.log('[audio] loading', capturedTrackId);
      sound = await tryCreateSound(currentTrack.preview_url);

      if (sound === null) {
        console.warn('[audio] load timed out, retrying once');
        if (!loadCancelledRef.current && loadGenRef.current === myGen) {
          sound = await tryCreateSound(currentTrack.preview_url);
        }
      }

      if (sound === null) {
        console.warn('[audio] load failed after retry, skipping track');
        if (!loadCancelledRef.current && loadGenRef.current === myGen) {
          usePlayerStore.getState()._setLoadingAudio(false);
          usePlayerStore.getState().nextTrack();
        }
        return;
      }
    }

    if (loadCancelledRef.current || loadGenRef.current !== myGen) {
      releaseSound(sound);
      usePlayerStore.getState()._setLoadingAudio(false);
      return;
    }

    // ── Wire up callbacks ─────────────────────────────────────────────────────
    sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
      // Discard stale callbacks from a superseded generation.
      if (loadGenRef.current !== myGen) return;
      if (!status.isLoaded) return;

      // Reset the watchdog — we know audio is alive.
      resetWatchdog();

      if (status.durationMillis) {
        durationMsRef.current = status.durationMillis;
        usePlayerStore
          .getState()
          ._setProgress(status.positionMillis / status.durationMillis);
      }
      if (status.didJustFinish) {
        if (watchdogTimerRef.current) {
          clearTimeout(watchdogTimerRef.current);
          watchdogTimerRef.current = null;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const next = usePlayerStore.getState().nextTrack();
        if (next === null) onQueueExhaustedRef.current?.();
      }
    });

    soundRef.current = sound;
    loadedTrackIdRef.current = capturedTrackId;
    usePlayerStore.getState()._setLoadingAudio(false);

    // Register seek handler for this generation.
    usePlayerStore.getState()._registerSeekHandler((fraction: number) => {
      if (loadGenRef.current !== myGen) return;
      const s = soundRef.current;
      if (!s) return;
      // iTunes previews are always 30 s — use as fallback if status hasn't fired yet.
      const duration = durationMsRef.current || 30_000;
      const positionMs = Math.round(Math.max(0, Math.min(1, fraction)) * duration);
      usePlayerStore.getState()._setProgress(fraction);
      s.getStatusAsync()
        .then((status) => {
          if (!status.isLoaded) return;
          s.setPositionAsync(positionMs).catch((e) =>
            console.warn('[audio] setPositionAsync failed:', e),
          );
        })
        .catch(() => {});
    });

    // Start playback if the store says we should be playing.
    if (usePlayerStore.getState().isPlaying) {
      console.log('[audio] calling playAsync');
      const ok = await playWithRetry(sound);
      if (!ok) {
        console.warn('[audio] playWithRetry exhausted, skipping track');
        if (!loadCancelledRef.current && loadGenRef.current === myGen) {
          usePlayerStore.getState().nextTrack();
        }
        return;
      }
      // Start the watchdog now that we expect status updates.
      resetWatchdog();
    }

    // Preload only the NEXT track (not 3) to keep total sound objects ≤ 2.
    const nextTrack = queue[queueIndex + 1];
    if (nextTrack?.preview_url && !preloadedRef.current.has(nextTrack.id)) {
      Audio.Sound.createAsync({ uri: nextTrack.preview_url }, { shouldPlay: false })
        .then(({ sound: s }) => {
          _soundRegistry.add(s);
          if (preloadedRef.current.has(nextTrack.id)) {
            // Already preloaded by a racing call — discard this duplicate.
            releaseSound(s);
          } else {
            preloadedRef.current.set(nextTrack.id, s);
          }
        })
        .catch(() => {});
    }
  };

  // ── resetWatchdog ──────────────────────────────────────────────────────────
  const resetWatchdogRef = useRef<() => void>(() => {});

  resetWatchdogRef.current = () => {
    if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
    if (!usePlayerStore.getState().isPlaying) return;

    watchdogTimerRef.current = setTimeout(async () => {
      watchdogTimerRef.current = null;
      if (!usePlayerStore.getState().isPlaying) return;

      const sound = soundRef.current;
      if (!sound) {
        console.warn('[audio] watchdog: no sound object, force-reloading');
        void forceReloadCurrentTrack();
        return;
      }

      const status = await sound.getStatusAsync().catch(() => null);
      if (!status?.isLoaded) {
        console.warn('[audio] watchdog: sound is unloaded, force-reloading');
        void forceReloadCurrentTrack();
        return;
      }

      if (!status.isPlaying) {
        console.warn('[audio] watchdog: sound exists but is not playing, retrying');
        await initAudioSession();
        const ok = await playWithRetry(sound);
        if (!ok) {
          console.warn('[audio] watchdog: retry failed, force-reloading');
          void forceReloadCurrentTrack();
        } else {
          resetWatchdog();
        }
      }
    }, WATCHDOG_MS);
  };

  function resetWatchdog() {
    resetWatchdogRef.current();
  }

  // ── forceReloadCurrentTrack ────────────────────────────────────────────────
  function forceReloadCurrentTrack() {
    const { currentTrack } = usePlayerStore.getState();
    if (!currentTrack?.id) return;

    loadCancelledRef.current = true;
    if (loadTimerRef.current) { clearTimeout(loadTimerRef.current); loadTimerRef.current = null; }

    loadCancelledRef.current = false;
    loadedTrackIdRef.current = null;
    durationMsRef.current = 0;
    usePlayerStore.getState()._registerSeekHandler(() => {});

    const capturedTrackId = currentTrack.id;
    const myGen = ++loadGenRef.current;
    void doLoadRef.current(capturedTrackId, myGen);
  }

  // ── Audio session setup ────────────────────────────────────────────────────
  useEffect(() => {
    initAudioSession();

    return () => {
      loadCancelledRef.current = true;
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
      if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
      // Release current sound and all preloads via the registry
      releaseSound(soundRef.current);
      soundRef.current = null;
      preloadedRef.current.forEach((s) => releaseSound(s));
      preloadedRef.current.clear();
    };
  }, []);

  // ── AppState recovery ──────────────────────────────────────────────────────
  useEffect(() => {
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState !== 'active') return;

      console.log('[audio] app returned to foreground');
      await initAudioSession();

      if (!usePlayerStore.getState().isPlaying) return;

      const sound = soundRef.current;
      if (!sound) {
        console.warn('[audio] AppState: sound missing on foreground, force-reloading');
        forceReloadCurrentTrack();
        return;
      }

      const status = await sound.getStatusAsync().catch(() => null);
      if (!status?.isLoaded) {
        console.warn('[audio] AppState: sound unloaded on foreground, force-reloading');
        forceReloadCurrentTrack();
        return;
      }

      if (!status.isPlaying) {
        console.log('[audio] AppState: resuming playback after foreground');
        const ok = await playWithRetry(sound);
        if (!ok) {
          console.warn('[audio] AppState: resume failed, force-reloading');
          forceReloadCurrentTrack();
        } else {
          resetWatchdog();
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Effect 1: Track changes — debounced load ───────────────────────────────
  useEffect(() => {
    // ── Queue cleared ────────────────────────────────────────────────────────
    if (!currentTrackId) {
      loadCancelledRef.current = true;
      if (loadTimerRef.current) { clearTimeout(loadTimerRef.current); loadTimerRef.current = null; }
      if (watchdogTimerRef.current) { clearTimeout(watchdogTimerRef.current); watchdogTimerRef.current = null; }

      const old = soundRef.current;
      soundRef.current = null;
      loadedTrackIdRef.current = null;
      durationMsRef.current = 0;

      if (old) {
        old.stopAsync().catch(() => {});
        releaseSound(old);
      }
      preloadedRef.current.forEach((s) => releaseSound(s));
      preloadedRef.current.clear();

      usePlayerStore.getState()._registerSeekHandler(() => {});
      usePlayerStore.getState()._setLoadingAudio(false);
      return;
    }

    // ── Same track already loaded — nothing to do ────────────────────────────
    if (loadedTrackIdRef.current === currentTrackId) return;

    // ── New track: cancel pending load, evict stale preloads ─────────────────
    // Any preloaded sound for a track OTHER than the incoming one is now stale
    // (e.g. a preloaded festival track when the queue switches to main feed).
    loadCancelledRef.current = true;
    if (loadTimerRef.current) { clearTimeout(loadTimerRef.current); loadTimerRef.current = null; }
    if (watchdogTimerRef.current) { clearTimeout(watchdogTimerRef.current); watchdogTimerRef.current = null; }

    preloadedRef.current.forEach((s, id) => {
      if (id !== currentTrackId) {
        releaseSound(s);
        preloadedRef.current.delete(id);
      }
    });

    loadCancelledRef.current = false;
    durationMsRef.current = 0;
    usePlayerStore.getState()._registerSeekHandler(() => {});

    const capturedTrackId = currentTrackId;
    const myGen = ++loadGenRef.current;

    loadTimerRef.current = setTimeout(() => {
      loadTimerRef.current = null;
      if (loadCancelledRef.current || loadGenRef.current !== myGen) return;
      void doLoadRef.current(capturedTrackId, myGen);
    }, LOAD_DEBOUNCE_MS);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackId]);

  // ── Effect 2: Play/pause toggle ────────────────────────────────────────────
  useEffect(() => {
    if (!currentTrackId) return;
    const sound = soundRef.current;
    if (!sound || loadedTrackIdRef.current !== currentTrackId) return;

    if (isPlaying) {
      playWithRetry(sound).then((ok) => {
        if (!ok && loadGenRef.current > 0) {
          console.warn('[audio] play/pause effect: playWithRetry failed, skipping');
          usePlayerStore.getState().nextTrack();
        } else if (ok) {
          resetWatchdog();
        }
      });
    } else {
      // Guard: only pause if the sound is still loaded.
      sound.getStatusAsync()
        .then((s) => {
          if (s.isLoaded) {
            sound.pauseAsync().catch((e) =>
              console.warn('[audio] pauseAsync failed:', e),
            );
          }
        })
        .catch(() => {});
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
    }
  }, [currentTrackId, isPlaying]);

  // ── Public API ─────────────────────────────────────────────────────────────

  const skip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    usePlayerStore.getState().nextTrack();
  }, []);

  const previous = useCallback(() => {
    const sound = soundRef.current;
    if (sound) {
      sound.getStatusAsync().then((status) => {
        if (status.isLoaded && status.positionMillis > 3000) {
          sound.setPositionAsync(0).catch((e) =>
            console.warn('[audio] setPositionAsync failed:', e),
          );
          usePlayerStore.getState()._setProgress(0);
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          usePlayerStore.getState().prevTrack();
        }
      }).catch(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        usePlayerStore.getState().prevTrack();
      });
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      usePlayerStore.getState().prevTrack();
    }
  }, []);

  return {
    play: useCallback(() => {
      usePlayerStore.getState()._setIsPlaying(true);
    }, []),
    pause: useCallback(() => {
      usePlayerStore.getState()._setIsPlaying(false);
    }, []),
    skip,
    previous,
  };
}
