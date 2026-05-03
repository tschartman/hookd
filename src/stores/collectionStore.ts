import { create } from 'zustand';

import type { SpotifyTrack } from '@/src/services/spotify';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CollectionType = 'festival' | 'main_feed' | 'mission';

export interface SavedTrack {
  itunesTrackId: string;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  previewUrl: string;
  genre: string;
  savedAt: Date;
}

export interface Collection {
  /** Supabase UUID — starts as a temp ID until the first Supabase write succeeds. */
  id: string;
  type: CollectionType;
  name: string;
  slug: string;
  tracks: SavedTrack[];
  /** First 4 unique artwork URLs for the mosaic cover. */
  coverArt: string[];
  trackCount: number;
  createdAt: Date;
  lastSavedAt: Date;
  exportedPlaylistUrl?: string;
}

export interface CollectionContext {
  type: CollectionType;
  slug: string;
  name: string;
}

// ─── State ────────────────────────────────────────────────────────────────────

type CollectionState = {
  collections: Record<string, Collection>;
  /**
   * Denormalized set of all saved iTunes track IDs across every collection.
   * Kept in sync with `collections` for O(1) global lookups.
   */
  savedTrackIdSet: Set<string>;
  isLoading: boolean;
};

type CollectionActions = {
  saveTrack: (track: SpotifyTrack, context: CollectionContext) => void;
  unsaveTrack: (itunesTrackId: string, collectionSlug: string) => void;
  getCollection: (slug: string) => Collection | undefined;
  getAllCollections: () => Collection[];
  isTrackSaved: (itunesTrackId: string) => boolean;
  getTrackCollections: (itunesTrackId: string) => Collection[];
  /**
   * Replace store state from Supabase data on app start.
   * The real Supabase UUIDs will replace any temp IDs.
   */
  hydrateFromSupabase: (collections: Collection[]) => void;
  /** Called after a Supabase upsert to swap in the real UUID. */
  updateCollectionId: (slug: string, realId: string) => void;
  setExportedPlaylistUrl: (slug: string, url: string) => void;
  setLoading: (loading: boolean) => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function trackToSaved(track: SpotifyTrack): SavedTrack {
  return {
    itunesTrackId: track.id,
    trackName: track.name,
    artistName: track.artists[0]?.name ?? 'Unknown Artist',
    artworkUrl: track.album?.images?.[0]?.url ?? '',
    previewUrl: track.preview_url ?? '',
    genre: track.primaryGenreName ?? track.genres?.[0] ?? '',
    savedAt: new Date(),
  };
}

function buildCoverArt(tracks: SavedTrack[]): string[] {
  const seen = new Set<string>();
  const arts: string[] = [];
  for (const t of tracks) {
    if (t.artworkUrl && !seen.has(t.artworkUrl)) {
      seen.add(t.artworkUrl);
      arts.push(t.artworkUrl);
      if (arts.length === 4) break;
    }
  }
  return arts;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useCollectionStore = create<CollectionState & CollectionActions>((set, get) => ({
  collections: {},
  savedTrackIdSet: new Set<string>(),
  isLoading: false,

  saveTrack: (track, context) => {
    set((s) => {
      const existing = s.collections[context.slug];
      const savedTrack = trackToSaved(track);
      const now = new Date();

      // Already saved in this collection — no-op (toggle is handled by caller)
      if (existing?.tracks.some((t) => t.itunesTrackId === track.id)) {
        return s;
      }

      const updatedTracks = existing ? [...existing.tracks, savedTrack] : [savedTrack];

      const updatedCollection: Collection = existing
        ? {
            ...existing,
            tracks: updatedTracks,
            trackCount: updatedTracks.length,
            coverArt: buildCoverArt(updatedTracks),
            lastSavedAt: now,
          }
        : {
            // Temp ID — replaced once Supabase upsert completes
            id: `tmp_${Math.random().toString(36).slice(2)}`,
            type: context.type,
            name: context.name,
            slug: context.slug,
            tracks: updatedTracks,
            coverArt: buildCoverArt(updatedTracks),
            trackCount: 1,
            createdAt: now,
            lastSavedAt: now,
          };

      const newIdSet = new Set(s.savedTrackIdSet);
      newIdSet.add(track.id);

      return {
        collections: { ...s.collections, [context.slug]: updatedCollection },
        savedTrackIdSet: newIdSet,
      };
    });
  },

  unsaveTrack: (itunesTrackId, collectionSlug) => {
    set((s) => {
      const collection = s.collections[collectionSlug];
      if (!collection) return s;

      const updatedTracks = collection.tracks.filter(
        (t) => t.itunesTrackId !== itunesTrackId,
      );

      const updatedCollection: Collection = {
        ...collection,
        tracks: updatedTracks,
        trackCount: updatedTracks.length,
        coverArt: buildCoverArt(updatedTracks),
      };

      // Remove from global set only if not saved in any other collection
      const stillSavedElsewhere = Object.entries(s.collections).some(
        ([slug, col]) =>
          slug !== collectionSlug &&
          col.tracks.some((t) => t.itunesTrackId === itunesTrackId),
      );

      const newIdSet = new Set(s.savedTrackIdSet);
      if (!stillSavedElsewhere) newIdSet.delete(itunesTrackId);

      return {
        collections: { ...s.collections, [collectionSlug]: updatedCollection },
        savedTrackIdSet: newIdSet,
      };
    });
  },

  getCollection: (slug) => get().collections[slug],

  getAllCollections: () =>
    Object.values(get().collections).sort(
      (a, b) => b.lastSavedAt.getTime() - a.lastSavedAt.getTime(),
    ),

  isTrackSaved: (itunesTrackId) => get().savedTrackIdSet.has(itunesTrackId),

  getTrackCollections: (itunesTrackId) =>
    Object.values(get().collections).filter((c) =>
      c.tracks.some((t) => t.itunesTrackId === itunesTrackId),
    ),

  hydrateFromSupabase: (collections) => {
    const map: Record<string, Collection> = {};
    const ids = new Set<string>();
    for (const c of collections) {
      map[c.slug] = c;
      for (const t of c.tracks) ids.add(t.itunesTrackId);
    }
    set({ collections: map, savedTrackIdSet: ids });
  },

  updateCollectionId: (slug, realId) => {
    set((s) => {
      const collection = s.collections[slug];
      if (!collection || collection.id === realId) return s;
      return {
        collections: {
          ...s.collections,
          [slug]: { ...collection, id: realId },
        },
      };
    });
  },

  setExportedPlaylistUrl: (slug, url) => {
    set((s) => {
      const collection = s.collections[slug];
      if (!collection) return s;
      return {
        collections: {
          ...s.collections,
          [slug]: { ...collection, exportedPlaylistUrl: url },
        },
      };
    });
  },

  setLoading: (loading) => set({ isLoading: loading }),
}));
