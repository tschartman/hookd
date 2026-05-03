// ─── Mission Swipe Screen ─────────────────────────────────────────────────────
// Tinder-style horizontal card stack for rapid-fire mission playlist building.

import { Audio, type AVPlaybackStatus } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import CardStack from '@/src/components/CardStack';
import MissionFilterSheet from '@/src/components/MissionFilterSheet';
import MissionTopBar from '@/src/components/MissionTopBar';
import { useMission } from '@/src/hooks/useMission';
import type { SpotifyTrack } from '@/src/services/spotify';
import { useMissionStore } from '@/src/stores/missionStore';
import { usePlayerStore } from '@/src/stores/playerStore';
import type { SwipeDirection } from '@/src/hooks/useMission';

// ─── Audio hook ───────────────────────────────────────────────────────────────
// Manages a single expo-av sound for the current card, with preloading for
// the next two. Completely independent of playerStore.

function useMissionAudio(
  currentTrack: SpotifyTrack | null,
  nextTracks: SpotifyTrack[],
  active: boolean,
) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const preloadMap = useRef<Map<string, Audio.Sound>>(new Map());
  const durationMsRef = useRef<number>(0);
  const [progress, setProgress] = useState(0);

  // ── Global audio session ─────────────────────────────────────────────────
  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    }).catch(console.warn);

    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
      preloadMap.current.forEach((s) => s.unloadAsync().catch(() => {}));
      preloadMap.current.clear();
    };
  }, []);

  // ── Stop audio when screen loses focus ───────────────────────────────────
  useEffect(() => {
    if (!active) {
      soundRef.current?.stopAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
      preloadMap.current.forEach((s) => s.unloadAsync().catch(() => {}));
      preloadMap.current.clear();
    }
  }, [active]);

  // ── Swap audio when the top card changes ─────────────────────────────────
  useEffect(() => {
    if (!currentTrack?.preview_url) {
      // No preview — just stop what's playing
      soundRef.current?.stopAsync().catch(() => {});
      return;
    }

    let cancelled = false;

    const play = async () => {
      setProgress(0);

      // Tear down previous sound
      const old = soundRef.current;
      soundRef.current = null;
      if (old) old.unloadAsync().catch(() => {});

      let sound: Audio.Sound;

      if (preloadMap.current.has(currentTrack.id)) {
        sound = preloadMap.current.get(currentTrack.id)!;
        preloadMap.current.delete(currentTrack.id);
      } else {
        try {
          const { sound: s } = await Audio.Sound.createAsync(
            { uri: currentTrack.preview_url! },
            { shouldPlay: true, progressUpdateIntervalMillis: 400 },
          );
          sound = s;
        } catch (err) {
          console.warn('[mission audio] createAsync failed', err);
          return;
        }
      }

      if (cancelled) {
        sound.unloadAsync().catch(() => {});
        return;
      }

      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (!status.isLoaded) return;
        if (status.durationMillis) {
          durationMsRef.current = status.durationMillis;
          setProgress(status.positionMillis / status.durationMillis);
        }
        // Preview ended — keep card visible, user decides the pace
      });

      soundRef.current = sound;

      // Ensure playback is running (in case createAsync shouldPlay was queued)
      await sound.playAsync().catch(console.warn);
    };

    play();
    return () => {
      cancelled = true;
    };
    // Re-run only when the card changes (id), not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  // ── Preload next 2 cards ─────────────────────────────────────────────────
  useEffect(() => {
    for (const track of nextTracks) {
      if (!track.preview_url || preloadMap.current.has(track.id)) continue;
      Audio.Sound.createAsync(
        { uri: track.preview_url },
        { shouldPlay: false },
      )
        .then(({ sound }) => {
          if (preloadMap.current.has(track.id)) {
            sound.unloadAsync().catch(() => {});
          } else {
            preloadMap.current.set(track.id, sound);
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextTracks.map((t) => t.id).join(',')]);

  const seekTo = useCallback((fraction: number) => {
    const s = soundRef.current;
    if (!s) return;
    const duration = durationMsRef.current || 30_000;
    const positionMs = Math.round(Math.max(0, Math.min(1, fraction)) * duration);
    s.getStatusAsync()
      .then((status) => {
        if (!status.isLoaded) return;
        s.setPositionAsync(positionMs).catch(() => {});
      })
      .catch(() => {});
  }, []);

  return { progress, seekTo };
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MissionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const mission = useMissionStore((s) => s.getMission(id));
  const lineupCount = mission?.lineup.length ?? 0;

  const {
    cards,
    currentIndex,
    currentCard,
    nextCards,
    isLoading,
    isExhausted,
    isTuning,
    isFilterActive,
    handleSwipe,
    handleUndo,
    applyFilter,
    canUndo,
    reviewedCount,
  } = useMission(id);

  // ── Filter sheet ──────────────────────────────────────────────────────
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [isApplyingFilter, setIsApplyingFilter] = useState(false);

  const handleFilterApply = useCallback(
    async (filter: Parameters<typeof applyFilter>[0]) => {
      setIsApplyingFilter(true);
      try {
        await applyFilter(filter);
      } finally {
        setIsApplyingFilter(false);
      }
    },
    [applyFilter],
  );

  // ── Track screen focus so mission audio stops when navigating away ───────
  const [isFocused, setIsFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  const { progress, seekTo } = useMissionAudio(currentCard, nextCards, isFocused);

  // ── Pause the main feed audio when entering the mission screen ──────────
  useEffect(() => {
    const wasPlaying = usePlayerStore.getState().isPlaying;
    if (wasPlaying) usePlayerStore.getState()._setIsPlaying(false);
    // No cleanup restore — user can resume manually from the feed tab
  }, []);

  // ── Swipe handler with haptics ─────────────────────────────────────────
  const onSwipe = useCallback(
    (direction: SwipeDirection) => {
      const track = cards[currentIndex];
      if (!track) return;

      if (direction === 'right') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      handleSwipe(direction, track);
    },
    [cards, currentIndex, handleSwipe],
  );

  // ── Back navigation with confirmation ─────────────────────────────────
  const handleBack = useCallback(() => {
    if (lineupCount > 0) {
      Alert.alert(
        'Exit Mission?',
        'Your lineup is saved — you can come back to it from your library.',
        [
          { text: 'Keep Going', style: 'cancel' },
          { text: 'Exit', style: 'destructive', onPress: () => router.back() },
        ],
      );
    } else {
      router.back();
    }
  }, [lineupCount, router]);

  // ── Done — navigate to lineup review ─────────────────────────────────
  const handleDone = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    router.push(`/mission/review/${id}`);
  }, [id, router]);

  // ── Undo ─────────────────────────────────────────────────────────────
  const handleUndoPress = useCallback(() => {
    if (!canUndo) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    handleUndo();
  }, [canUndo, handleUndo]);

  // ── Error state ───────────────────────────────────────────────────────
  if (!mission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Mission not found.</Text>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <Text style={styles.backLinkText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Top bar: mission name, counter, done button, filter icon */}
      <MissionTopBar
        missionName={mission.name}
        missionIcon={mission.icon}
        lineupCount={lineupCount}
        suggestedCount={mission.suggestedCount}
        isTuning={isTuning}
        isFilterActive={isFilterActive}
        onDone={handleDone}
        onBack={handleBack}
        onFilter={() => setFilterSheetVisible(true)}
      />

      {/* Card stack area */}
      <View style={styles.stackArea}>
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#1DB954" size="large" />
            <Text style={styles.loadingText}>Loading songs…</Text>
          </View>
        ) : isExhausted && lineupCount > 0 ? (
          /* Completion state: user has swiped through all cards and saved at least one */
          <View style={styles.completionCard}>
            <Text style={styles.completionEmoji}>✓</Text>
            <Text style={styles.completionTitle}>You've built your playlist!</Text>
            <Text style={styles.completionCount}>{lineupCount} tracks saved</Text>
            <Pressable
              onPress={handleDone}
              style={({ pressed }) => [styles.reviewBtn, pressed && { opacity: 0.82 }]}
            >
              <Text style={styles.reviewBtnText}>Review Lineup →</Text>
            </Pressable>
          </View>
        ) : (
          <CardStack
            cards={cards}
            currentIndex={currentIndex}
            onSwipe={onSwipe}
            audioProgress={progress}
            onSeek={seekTo}
          />
        )}
      </View>

      {/* Bottom area: swipe hints, reviewed count, undo */}
      <View style={styles.bottomBar}>
        {/* Swipe direction hints */}
        {!isExhausted && (
          <View style={styles.hintsRow}>
            <Text style={styles.hintLeft}>← SKIP</Text>
            <Text style={styles.reviewedText}>{reviewedCount} reviewed</Text>
            <Text style={styles.hintRight}>SAVE →</Text>
          </View>
        )}

        {/* Undo button */}
        <Pressable
          onPress={handleUndoPress}
          disabled={!canUndo}
          style={[styles.undoButton, !canUndo && styles.undoButtonDisabled]}>
          <Text style={[styles.undoText, !canUndo && styles.undoTextDisabled]}>
            ↩ Undo
          </Text>
        </Pressable>
      </View>

      {/* Filter sheet — renders as an overlay */}
      <MissionFilterSheet
        visible={filterSheetVisible}
        isLoading={isApplyingFilter}
        initialFilter={mission.filter}
        onApply={handleFilterApply}
        onClose={() => setFilterSheetVisible(false)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },

  stackArea: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 8,
  },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },

  loadingText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    marginTop: 8,
  },

  // Mission completion card (shown when exhausted with saves)
  completionCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  completionEmoji: {
    fontSize: 48,
    color: '#1DB954',
    fontWeight: '700',
    lineHeight: 56,
  },
  completionTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  completionCount: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 15,
    fontFamily: 'SpaceMono',
    marginBottom: 8,
  },
  reviewBtn: {
    backgroundColor: '#1DB954',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 50,
  },
  reviewBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  errorText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 16,
  },

  backLink: {
    marginTop: 8,
  },
  backLinkText: {
    color: '#1DB954',
    fontSize: 15,
    fontWeight: '600',
  },

  // ── Bottom bar ───────────────────────────────────────────────────────────
  bottomBar: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    paddingTop: 8,
    gap: 12,
    alignItems: 'center',
  },

  hintsRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hintLeft: {
    color: 'rgba(255,100,100,0.45)',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'SpaceMono',
    letterSpacing: 0.5,
  },
  hintRight: {
    color: 'rgba(29,185,84,0.45)',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'SpaceMono',
    letterSpacing: 0.5,
  },
  reviewedText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 11,
    fontFamily: 'SpaceMono',
  },

  undoButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  undoButtonDisabled: {
    opacity: 0.3,
  },
  undoText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '600',
  },
  undoTextDisabled: {
    color: 'rgba(255,255,255,0.3)',
  },
});
