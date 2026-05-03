// ─── useCollections ───────────────────────────────────────────────────────────
// Wraps collectionStore with Supabase sync.
// All writes are optimistic: the store is updated immediately so the UI never
// blocks on a network call. Supabase writes happen in the background.

import { useCallback } from 'react';

import { supabase } from '@/src/services/supabase';
import type { SpotifyTrack } from '@/src/services/spotify';
import {
  useCollectionStore,
  type Collection,
  type CollectionContext,
  type SavedTrack,
} from '@/src/stores/collectionStore';
import { useUserStore } from '@/src/stores/userStore';

// ─── Standalone bootstrap loader ─────────────────────────────────────────────
// Called once on app start (from _layout.tsx) after the user's session is
// restored. Not a hook — no React subscriptions.

export async function loadCollectionsForUser(userId: string): Promise<void> {
  const store = useCollectionStore.getState();
  store.setLoading(true);

  try {
    const { data, error } = await supabase
      .from('collections')
      .select(
        `id, type, name, slug, exported_playlist_url, created_at, last_saved_at,
         saved_tracks (
           itunes_track_id, track_name, artist_name,
           artwork_url, preview_url, genre, saved_at
         )`,
      )
      .eq('spotify_user_id', userId)
      .order('last_saved_at', { ascending: false });

    if (error || !data) return;

    const collections: Collection[] = data.map((c: any) => {
      const tracks: SavedTrack[] = (c.saved_tracks ?? []).map((t: any) => ({
        itunesTrackId: t.itunes_track_id,
        trackName: t.track_name,
        artistName: t.artist_name,
        artworkUrl: t.artwork_url ?? '',
        previewUrl: t.preview_url ?? '',
        genre: t.genre ?? '',
        savedAt: new Date(t.saved_at),
      }));

      const coverArt = [...new Set(tracks.map((t) => t.artworkUrl).filter(Boolean))].slice(0, 4);

      return {
        id: c.id,
        type: c.type as 'festival' | 'main_feed' | 'mission',
        name: c.name,
        slug: c.slug,
        tracks,
        coverArt,
        trackCount: tracks.length,
        createdAt: new Date(c.created_at),
        lastSavedAt: new Date(c.last_saved_at),
        exportedPlaylistUrl: c.exported_playlist_url ?? undefined,
      };
    });

    store.hydrateFromSupabase(collections);
  } finally {
    store.setLoading(false);
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCollections() {
  const store = useCollectionStore();
  const userId = useUserStore((s) => s.profile?.id);

  // ── Save a track to a context's collection ────────────────────────────────
  const saveTrack = useCallback(
    (track: SpotifyTrack, context: CollectionContext) => {
      // 1. Optimistic update — UI responds immediately
      store.saveTrack(track, context);

      if (!userId) return;

      // 2. Background Supabase sync — never blocks the feed
      void (async () => {
        try {
          // Upsert the collection (creates or updates last_saved_at)
          const { data: collection, error: collErr } = await supabase
            .from('collections')
            .upsert(
              {
                spotify_user_id: userId,
                type: context.type,
                name: context.name,
                slug: context.slug,
                last_saved_at: new Date().toISOString(),
              },
              { onConflict: 'spotify_user_id,slug' },
            )
            .select('id')
            .single();

          if (collErr || !collection) return;

          // Swap temp ID for the real Supabase UUID
          useCollectionStore.getState().updateCollectionId(context.slug, collection.id);

          // Insert the saved track (ignore duplicate — idempotent)
          await supabase.from('saved_tracks').upsert(
            {
              collection_id: collection.id,
              spotify_user_id: userId,
              itunes_track_id: track.id,
              track_name: track.name,
              artist_name: track.artists[0]?.name ?? '',
              artwork_url: track.album?.images?.[0]?.url ?? '',
              preview_url: track.preview_url ?? '',
              genre: track.primaryGenreName ?? track.genres?.[0] ?? '',
            },
            { onConflict: 'collection_id,itunes_track_id', ignoreDuplicates: true },
          );
        } catch {
          // Silent failure — UI is already updated optimistically
        }
      })();
    },
    [store, userId],
  );

  // ── Remove a track from a specific collection ─────────────────────────────
  const unsaveTrack = useCallback(
    (itunesTrackId: string, collectionSlug: string) => {
      // 1. Optimistic update
      store.unsaveTrack(itunesTrackId, collectionSlug);

      if (!userId) return;

      // 2. Background Supabase delete
      void (async () => {
        try {
          // Get the real collection ID from the store (post-update)
          const collection = useCollectionStore.getState().collections[collectionSlug];
          if (!collection || collection.id.startsWith('tmp_')) {
            // Collection hasn't synced yet — fall back to a Supabase lookup
            const { data } = await supabase
              .from('collections')
              .select('id')
              .eq('spotify_user_id', userId)
              .eq('slug', collectionSlug)
              .single();
            if (!data) return;
            await supabase
              .from('saved_tracks')
              .delete()
              .eq('collection_id', data.id)
              .eq('itunes_track_id', itunesTrackId);
            return;
          }

          await supabase
            .from('saved_tracks')
            .delete()
            .eq('collection_id', collection.id)
            .eq('itunes_track_id', itunesTrackId);
        } catch {
          // Silent failure
        }
      })();
    },
    [store, userId],
  );

  return {
    saveTrack,
    unsaveTrack,
    isTrackSaved: store.isTrackSaved,
    getCollection: store.getCollection,
    getAllCollections: store.getAllCollections,
    getTrackCollections: store.getTrackCollections,
    collections: store.getAllCollections(),
    isLoading: store.isLoading,
  };
}
