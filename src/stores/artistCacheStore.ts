import type { SpotifyTrack } from '../services/spotify';

// ─── In-memory artist track cache ─────────────────────────────────────────────
// Stores fully-processed track lists (filtered, deduped, sorted) so the artist
// view can display instantly when the user taps an artist name.
//
// Constraints:
//  • MAX_CACHED_ARTISTS=5  — ~50 tracks × ~1KB each × 5 = ~250KB, negligible
//  • CACHE_TTL_MS=10min    — data is evicted on next access after 10 minutes
//  • In-memory only        — not persisted; cleared on app kill/background
//  • Eviction: LRU by fetchedAt timestamp when at capacity

export interface CachedArtistData {
  artistName: string;
  artistId: string;
  tracks: SpotifyTrack[];
  fetchedAt: number;
}

const MAX_CACHED_ARTISTS = 5;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const artistCache = new Map<string, CachedArtistData>();

export function getCachedArtist(artistName: string): CachedArtistData | null {
  const key = artistName.toLowerCase();
  const cached = artistCache.get(key);
  if (!cached) return null;

  if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) {
    artistCache.delete(key);
    return null;
  }

  return cached;
}

export function setCachedArtist(data: CachedArtistData): void {
  // Evict oldest entry when at capacity
  if (artistCache.size >= MAX_CACHED_ARTISTS) {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [k, v] of artistCache) {
      if (v.fetchedAt < oldestTime) {
        oldestTime = v.fetchedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) artistCache.delete(oldestKey);
  }

  artistCache.set(data.artistName.toLowerCase(), data);
}

export function clearArtistCache(): void {
  artistCache.clear();
}
