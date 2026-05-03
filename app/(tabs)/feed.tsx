import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AddToSheet from '@/src/components/AddToSheet';
import {
  ActivityIndicator,
  Animated as RNAnimated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import GenreEraDial from '@/src/components/GenreEraDial';
import type { Era, Genre } from '@/src/data/genreEraSeeds';
import SwipeFeed from '@/src/components/SwipeFeed';
import { useCollections } from '@/src/hooks/useCollections';
import { useGenreEra } from '@/src/hooks/useGenreEra';
import { useAudioPlayer } from '@/src/hooks/useAudioPlayer';
import { abortAllPending } from '@/src/services/itunes';
import { prefetchIfIdle } from '@/src/services/artistPrefetch';
import type { SpotifyTrack } from '@/src/services/spotify';
import { useCollectionStore } from '@/src/stores/collectionStore';
import { usePlayerStore } from '@/src/stores/playerStore';

// ─── Main feed collection context ────────────────────────────────────────────
const MAIN_FEED_CONTEXT = {
  type: 'main_feed' as const,
  slug: 'main-feed',
  name: 'Main Feed Discoveries',
};

// Refetch when this many tracks remain in the unplayed queue
const PREFETCH_THRESHOLD = 5;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FeedScreen() {
  const { queue, queueIndex, setQueue, appendToQueue } = usePlayerStore();

  // Genre × Era Explorer
  const genreEra = useGenreEra();

  // Dial open trigger — incrementing this causes GenreEraDial to expand
  const [dialOpenTrigger, setDialOpenTrigger] = useState(0);

  // Collections — saves go to main feed only
  const { saveTrack, unsaveTrack } = useCollections();
  const mainFeedTracks = useCollectionStore((s) => s.collections['main-feed']?.tracks);
  const savedTrackIds = useMemo(
    () => new Set((mainFeedTracks ?? []).map((t) => t.itunesTrackId)),
    [mainFeedTracks],
  );

  // ── Intro overlay ─────────────────────────────────────────────────────────
  const [introVisible, setIntroVisible] = useState(false);
  const [introLabel, setIntroLabel] = useState('');
  const introOpacity = useRef(new RNAnimated.Value(0)).current;

  const showIntro = useCallback((era: string, genre: string) => {
    setIntroLabel(`${era} · ${genre}`);
    setIntroVisible(true);
    RNAnimated.sequence([
      RNAnimated.timing(introOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      RNAnimated.delay(900),
      RNAnimated.timing(introOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => setIntroVisible(false));
  }, [introOpacity]);

  // ── Mount: randomize (or restore saved combo) ─────────────────────────────
  const didMountRef = useRef(false);
  useEffect(() => {
    if (didMountRef.current) return;
    didMountRef.current = true;

    // If we have a saved queue for the genreEra context (e.g. returning after a
    // festival visit that caused a remount), restore era/genre without fetching.
    const saved = usePlayerStore.getState().savedQueues['genreEra'];
    if (saved && saved.queue.length > 0 && saved.meta?.era && saved.meta?.genre) {
      genreEra.restoreCombo(saved.meta.era as Era, saved.meta.genre as Genre);
      return;
    }

    const { era, genre } = genreEra.randomize();
    showIntro(era, genre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stop audio + clear queue the instant a new combo is selected ─────────
  // This fires synchronously before the fetch completes, giving instant feedback.
  const prevQueueVersionRef = useRef(-1);
  const isFirstVersionRef = useRef(true);
  useEffect(() => {
    if (isFirstVersionRef.current) {
      // On mount the initial randomize() sets version to 1; don't clear then.
      isFirstVersionRef.current = false;
      prevQueueVersionRef.current = genreEra.queueVersion;
      return;
    }
    if (genreEra.queueVersion !== prevQueueVersionRef.current) {
      // Stop audio immediately — user chose a new combo, old tracks shouldn't keep playing
      usePlayerStore.getState()._setIsPlaying(false);
      setQueue([], 0, false, { type: 'genreEra' }); // makes isInitialLoad = true → spinner shows at once
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genreEra.queueVersion]);

  // ── Sync new tracks → playerStore once they arrive ────────────────────────
  useEffect(() => {
    if (genreEra.tracks.length === 0) return;
    if (genreEra.queueVersion !== prevQueueVersionRef.current) {
      // New combo → replace queue (and start playback)
      prevQueueVersionRef.current = genreEra.queueVersion;
      setQueue(genreEra.tracks, 0, true, { type: 'genreEra' });
    } else {
      // Same combo → append more tracks
      appendToQueue(genreEra.tracks, { type: 'genreEra' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genreEra.tracks]);

  // ── Reclaim queue when returning to this tab ──────────────────────────────
  // setFeedContext saves the outgoing feed's queue and restores ours.
  useFocusEffect(
    useCallback(() => {
      // Drain any pending requests from the previous feed (festival, mission)
      // and give the genre×era feed a clean rate-limit budget.
      abortAllPending();
      usePlayerStore.getState().setFeedContext({ type: 'genreEra' });

      // If the restored queue is thin, load more tracks in the background.
      const { queue: restoredQueue, queueIndex: restoredIndex } =
        usePlayerStore.getState();
      if (restoredQueue.length > 0 && restoredQueue.length - restoredIndex < 20) {
        genreEra.loadMore();
      }

      return () => {
        // Only pause if genreEra still owns the player. If the user navigated
        // to an artist or festival screen, setFeedContext already stopped
        // audio and handed off the context — don't interfere with the new feed.
        if (usePlayerStore.getState().feedContext.type === 'genreEra') {
          usePlayerStore.getState()._setIsPlaying(false);
        }
        // Persist the current era+genre into the saved queue so it survives
        // a component remount (e.g. after navigating to a festival and back).
        usePlayerStore.getState().setSavedQueueMeta(
          { type: 'genreEra' },
          { era: genreEra.currentEra, genre: genreEra.currentGenre },
        );
      };
    }, [genreEra.currentEra, genreEra.currentGenre, genreEra.loadMore]),
  );

  // ── Audio player — onQueueExhausted triggers more loads ──────────────────
  useAudioPlayer({ onQueueExhausted: () => genreEra.loadMore() });

  // ── Infinite scroll trigger ────────────────────────────────────────────────
  const handleEndReached = useCallback(() => {
    const remaining = queue.length - queueIndex;
    if (remaining <= PREFETCH_THRESHOLD) {
      genreEra.loadMore();
    }
  }, [queue.length, queueIndex, genreEra]);

  // ── Save / unsave track ────────────────────────────────────────────────────
  const handleSave = useCallback(
    (track: SpotifyTrack) => {
      if (savedTrackIds.has(track.id)) {
        unsaveTrack(track.id, MAIN_FEED_CONTEXT.slug);
      } else {
        saveTrack(track, MAIN_FEED_CONTEXT);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    },
    [savedTrackIds, saveTrack, unsaveTrack],
  );

  const handleExpand = useCallback((track: SpotifyTrack) => {
    router.push({
      pathname: '/artist/[id]' as any,
      params: {
        id: track.artists[0]?.id ?? track.id,
        name: track.artists[0]?.name ?? track.name,
        sourceCollection: MAIN_FEED_CONTEXT.slug,
        sourceContext: 'genreEra',
        originatingTrackId: track.id,
      },
    });
  }, []);

  // ── Add-to sheet ──────────────────────────────────────────────────────────
  const [addToTrack, setAddToTrack] = useState<SpotifyTrack | null>(null);

  const handleAddTo = useCallback((track: SpotifyTrack) => {
    setAddToTrack(track);
  }, []);

  // ── Feed-exhaustion / error overlays ──────────────────────────────────────
  // Show when the user is at the last card in the queue AND we know there's
  // no more content (either pool exhausted or network error).
  const atQueueEnd = queue.length > 0 && queueIndex >= queue.length - 1;
  const showCompletion = atQueueEnd && !genreEra.hasMore && !genreEra.fetchError && !genreEra.isLoading;
  const showFetchError = atQueueEnd && genreEra.fetchError;

  const handleRetryFetch = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    genreEra.loadMore();
  }, [genreEra]);

  const handleSpinDial = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDialOpenTrigger((v) => v + 1);
  }, []);

  const handleSurpriseMe = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const { era, genre } = genreEra.randomize();
    showIntro(era, genre);
  }, [genreEra, showIntro]);

  // ── Background artist prefetch ────────────────────────────────────────────
  // While the user listens, prefetch the current and next card's artist tracks
  // so tapping an artist name shows an instant cache HIT instead of a spinner.
  const handleVisibleItemChanged = useCallback((track: SpotifyTrack, index: number) => {
    const artistId = track.artists[0]?.id ?? track.id;
    const artistName = track.artists[0]?.name ?? track.name;
    prefetchIfIdle(artistName, artistId);

    // Also prefetch the next card's artist at lower priority
    const nextTrack = queue[index + 1];
    if (nextTrack) {
      const nextArtistId = nextTrack.artists[0]?.id ?? nextTrack.id;
      const nextArtistName = nextTrack.artists[0]?.name ?? nextTrack.name;
      setTimeout(() => prefetchIfIdle(nextArtistName, nextArtistId), 2000);
    }
  }, [queue]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const isInitialLoad = genreEra.isLoading && queue.length === 0;

  if (isInitialLoad) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1DB954" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SwipeFeed
        tracks={queue}
        savedTrackIds={savedTrackIds}
        onSave={handleSave}
        onExpand={handleExpand}
        onAddToPlaylist={handleAddTo}
        onEndReached={handleEndReached}
        onVisibleItemChanged={handleVisibleItemChanged}
      />

      {/* Genre × Era dial */}
      <GenreEraDial
        currentEra={genreEra.currentEra}
        currentGenre={genreEra.currentGenre}
        isLoading={genreEra.isLoading}
        onEraChange={genreEra.setEra}
        onGenreChange={genreEra.setGenre}
        onRandomize={genreEra.randomize}
        openTrigger={dialOpenTrigger}
      />

      {/* Feed-exhaustion completion overlay */}
      {showCompletion && (
        <View style={styles.endOverlay}>
          <View style={styles.endCard}>
            <Text style={styles.endEmoji}>✓</Text>
            <Text style={styles.endTitle}>
              You've explored all of {genreEra.currentEra} {genreEra.currentGenre} for now
            </Text>
            <Text style={styles.endSubtitle}>
              Try a different era or genre to keep discovering
            </Text>
            <Pressable
              onPress={handleSpinDial}
              style={({ pressed }) => [styles.endBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.endBtnText}>Spin the Dial</Text>
            </Pressable>
            <Pressable
              onPress={handleSurpriseMe}
              style={({ pressed }) => [styles.endBtnSecondary, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.endBtnSecondaryText}>Surprise Me</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Network-error retry overlay */}
      {showFetchError && (
        <View style={styles.endOverlay}>
          <View style={styles.endCard}>
            <Text style={styles.endEmoji}>↺</Text>
            <Text style={styles.endTitle}>Couldn't load more tracks</Text>
            <Text style={styles.endSubtitle}>Check your connection and try again</Text>
            <Pressable
              onPress={handleRetryFetch}
              style={({ pressed }) => [styles.endBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.endBtnText}>Retry</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Intro overlay */}
      {introVisible && (
        <RNAnimated.View style={[styles.introOverlay, { opacity: introOpacity }]}>
          <Text style={styles.introEra}>{introLabel.split(' · ')[0]}</Text>
          <Text style={styles.introGenre}>{introLabel.split(' · ')[1]}</Text>
          <Text style={styles.introSub}>exploring {introLabel}</Text>
        </RNAnimated.View>
      )}

      {/* Add-to sheet */}
      <AddToSheet
        track={addToTrack}
        visible={addToTrack !== null}
        onClose={() => setAddToTrack(null)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  centered: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  introOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,10,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    gap: 4,
  },
  introEra: {
    color: '#1DB954',
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -1,
  },
  introGenre: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  introSub: {
    color: '#666',
    fontSize: 13,
    marginTop: 8,
    letterSpacing: 0.3,
  },

  // Feed-exhaustion overlays
  endOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,10,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    zIndex: 5, // below the dial (zIndex 10) so dial can open over it
  },
  endCard: {
    alignItems: 'center',
    gap: 12,
  },
  endEmoji: {
    fontSize: 44,
    color: '#1DB954',
    fontWeight: '700',
    lineHeight: 52,
  },
  endTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
    lineHeight: 26,
  },
  endSubtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 4,
  },
  endBtn: {
    backgroundColor: '#1DB954',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 50,
    marginTop: 4,
  },
  endBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  endBtnSecondary: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  endBtnSecondaryText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 15,
    fontWeight: '600',
  },
});
