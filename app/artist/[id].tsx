import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SwipeFeed from '@/src/components/SwipeFeed';
import { useCollections } from '@/src/hooks/useCollections';
import { useAudioPlayer } from '@/src/hooks/useAudioPlayer';
import {
  abortAllPending,
  resetRateLimitWindow,
  searchArtistTracksForView,
} from '@/src/services/itunes';
import type { SpotifyTrack } from '@/src/services/spotify';
import { getCachedArtist, setCachedArtist } from '@/src/stores/artistCacheStore';
import { useCollectionStore, type CollectionContext } from '@/src/stores/collectionStore';
import { usePlayerStore } from '@/src/stores/playerStore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function reorderToOriginating(tracks: SpotifyTrack[], originatingTrackId?: string): SpotifyTrack[] {
  if (!originatingTrackId) return tracks;
  const idx = tracks.findIndex((t) => t.id === originatingTrackId);
  if (idx <= 0) return tracks;
  const spliced = [...tracks];
  const [origin] = spliced.splice(idx, 1);
  return [origin, ...spliced];
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ArtistScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    id: string;
    name: string;
    sourceCollection: string;
    sourceContext: string;
    originatingTrackId?: string;
  }>();

  const { id, name, sourceCollection, sourceContext, originatingTrackId } = params;

  // Start without a spinner if the cache already has this artist's tracks.
  // The useEffect below will set the queue synchronously on the first render.
  const [isLoading, setIsLoading] = useState(() => getCachedArtist(name) === null);
  const loadedRef = useRef(false);

  const { queue } = usePlayerStore();
  const { saveTrack, unsaveTrack } = useCollections();

  // ── Resolve collection context for saves ──────────────────────────────────
  // Prefer looking up the existing collection so we use its real name.
  const collectionContext = useMemo((): CollectionContext => {
    const existing = useCollectionStore.getState().collections[sourceCollection];
    if (existing) {
      return { type: existing.type, slug: existing.slug, name: existing.name };
    }
    if (sourceContext === 'festival') {
      return { type: 'festival', slug: sourceCollection, name: sourceCollection };
    }
    if (sourceContext === 'mission') {
      return { type: 'mission', slug: sourceCollection, name: sourceCollection };
    }
    return { type: 'main_feed', slug: sourceCollection, name: 'Main Feed Discoveries' };
  }, [sourceCollection, sourceContext]);

  const collectionTracks = useCollectionStore(
    (s) => s.collections[sourceCollection]?.tracks,
  );
  const savedTrackIds = useMemo(
    () => new Set((collectionTracks ?? []).map((t) => t.itunesTrackId)),
    [collectionTracks],
  );

  // ── Mount: set context + load tracks ──────────────────────────────────────
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    abortAllPending();
    resetRateLimitWindow();
    usePlayerStore.getState().setFeedContext({ type: 'artist', id });

    const load = async () => {
      // ── Check prefetch cache first ─────────────────────────────────────────
      const cached = getCachedArtist(name);
      if (cached) {
        console.log(`[artist] Cache HIT for ${name}: ${cached.tracks.length} tracks`);
        const ordered = reorderToOriginating(cached.tracks, originatingTrackId);
        usePlayerStore.getState().setQueue(ordered, 0, true, { type: 'artist', id });
        setIsLoading(false);
        return;
      }

      // ── Cache MISS — fetch on demand through the normal rate limiter ───────
      console.log(`[artist] Cache MISS for ${name}, fetching...`);
      const tracks = await searchArtistTracksForView(name);

      if (tracks.length === 0) {
        setIsLoading(false);
        return;
      }

      // Cache for potential re-visit
      setCachedArtist({ artistName: name, artistId: id, tracks, fetchedAt: Date.now() });

      const ordered = reorderToOriginating(tracks, originatingTrackId);
      console.log(
        `[artist] Queue set: ${ordered.length} tracks${originatingTrackId ? ', starting at originating track' : ''}`,
      );
      usePlayerStore.getState().setQueue(ordered, 0, true, { type: 'artist', id });
      setIsLoading(false);
    };

    void load();

    return () => {
      abortAllPending();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Audio player ────────────────────────────────────────────────────────────
  useAudioPlayer();

  // ── Save handler ────────────────────────────────────────────────────────────
  const handleSave = useCallback(
    (track: SpotifyTrack) => {
      if (savedTrackIds.has(track.id)) {
        unsaveTrack(track.id, sourceCollection);
      } else {
        saveTrack(track, collectionContext);
        console.log(`[collection] Saved to: ${sourceCollection}`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    },
    [savedTrackIds, saveTrack, unsaveTrack, collectionContext, sourceCollection],
  );

  // Artist name taps within this feed don't navigate further (no nesting)
  const handleExpand = useCallback((_track: SpotifyTrack) => {}, []);
  const handleEndReached = useCallback(() => {}, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#1DB954" />
        </View>
      ) : queue.length === 0 ? (
        <View style={styles.loading}>
          <Text style={styles.emptyText}>No tracks found</Text>
        </View>
      ) : (
        <SwipeFeed
          tracks={queue}
          savedTrackIds={savedTrackIds}
          onSave={handleSave}
          onExpand={handleExpand}
          onEndReached={handleEndReached}
          tabBarHeight={0}
          bottomPadding={insets.bottom + 16}
        />
      )}

      {/* Floating header — sits above the feed */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backButtonText}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {name}
        </Text>
        {/* Spacer keeps title centred */}
        <View style={styles.headerSpacer} />
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 16,
  },

  // Header floats over the feed
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    // Translucent dark gradient readable over album art
    backgroundColor: 'rgba(10,10,10,0.6)',
    zIndex: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 36,
  },
  headerTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  headerSpacer: {
    width: 44, // mirrors backButton to keep title centred
  },
});
