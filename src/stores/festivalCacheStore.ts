// ─── festivalCacheStore.ts ────────────────────────────────────────────────────
// Caches festival feed state per slug so navigating back restores instantly.
// Persisted to expo-file-system so it survives app restarts (24 h TTL).
// In-memory cache is bounded to MAX_IN_MEMORY most-recent festivals to prevent
// heap accumulation when the user visits many festivals in one session.

import { File, Paths } from 'expo-file-system';
import { create } from 'zustand';

import type { SpotifyTrack } from '@/src/services/spotify';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FestivalFeedCache {
  tracks: SpotifyTrack[];
  currentIndex: number;
  allGenres: string[];
  sliderValue: number;
  /** null = "All genres" selected */
  activeGenres: string[] | null;
  /** festival.artists.length at cache time — detects lineup changes */
  festivalArtistCount: number;
  /** Date.now() when tracks were first fetched from iTunes */
  loadedAt: number;
}

type CacheData = Record<string, FestivalFeedCache>;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
/**
 * Maximum number of festival caches to keep in Zustand memory at once.
 * Older entries are evicted from memory (and from the on-disk file) when this
 * limit is exceeded. 2 covers "current festival" + "one previously visited".
 */
const MAX_IN_MEMORY = 2;

function getCacheFile(): File {
  return new File(Paths.document, 'festival-feed-cache.json');
}

// ─── File helpers ─────────────────────────────────────────────────────────────

async function readFile(): Promise<CacheData> {
  try {
    const file = getCacheFile();
    if (!file.exists) return {};
    const content = await file.text();
    return JSON.parse(content) as CacheData;
  } catch {
    return {};
  }
}

function writeFile(data: CacheData): void {
  try {
    getCacheFile().write(JSON.stringify(data));
  } catch {}
}

/** Returns the `n` most recently loaded entries from a CacheData map. */
function keepMostRecent(data: CacheData, n: number): CacheData {
  const entries = Object.entries(data).sort(([, a], [, b]) => b.loadedAt - a.loadedAt);
  return Object.fromEntries(entries.slice(0, n));
}

// ─── Store ────────────────────────────────────────────────────────────────────

type FestivalCacheState = {
  /** In-memory cache — bounded to MAX_IN_MEMORY most recently visited. */
  cache: CacheData;
  isLoaded: boolean;
};

type FestivalCacheActions = {
  /** Load from file into memory (no-op if already loaded). */
  loadCache: () => Promise<void>;
  /** Persist the current feed state for a festival. */
  saveCache: (slug: string, data: FestivalFeedCache) => void;
  /**
   * Returns cached feed for `slug`, or null if:
   * - No entry exists in memory
   * - Entry is older than 24 h
   * - Festival lineup has changed (artist count mismatch)
   */
  getCache: (slug: string, festivalArtistCount: number) => FestivalFeedCache | null;
  /** Wipe the cache for one festival (Start Over, pull-to-refresh). */
  clearCache: (slug: string) => void;
};

export const useFestivalCacheStore = create<FestivalCacheState & FestivalCacheActions>(
  (set, get) => ({
    cache: {},
    isLoaded: false,

    loadCache: async () => {
      if (get().isLoaded) return;
      const allData = await readFile();
      // Only hydrate the MAX_IN_MEMORY most recent festivals into Zustand
      const bounded = keepMostRecent(allData, MAX_IN_MEMORY);
      const totalOnDisk = Object.keys(allData).length;
      const inMemory = Object.keys(bounded).length;
      console.log(`[FestivalCache] Loaded: ${totalOnDisk} on disk, ${inMemory} in memory (cap ${MAX_IN_MEMORY})`);
      set({ cache: bounded, isLoaded: true });
    },

    saveCache: (slug, data) => {
      // Add new entry, then evict oldest beyond the cap
      const merged = { ...get().cache, [slug]: data };
      const bounded = keepMostRecent(merged, MAX_IN_MEMORY);

      const evicted = Object.keys(merged).filter((k) => !(k in bounded));
      if (evicted.length) {
        console.log(`[FestivalCache] Evicted from memory: ${evicted.join(', ')} (cap ${MAX_IN_MEMORY})`);
      }
      console.log(`[FestivalCache] Saved "${slug}": ${data.tracks.length} tracks at index ${data.currentIndex}. In memory: ${Object.keys(bounded).length}`);

      set({ cache: bounded });
      // File also stores only the bounded set — no point keeping more on disk
      // than we'd ever load back into memory.
      writeFile(bounded);
    },

    getCache: (slug, festivalArtistCount) => {
      const entry = get().cache[slug];
      if (!entry) {
        console.log(`[FestivalCache] READ "${slug}": not in memory`);
        return null;
      }
      if (Date.now() - entry.loadedAt > CACHE_TTL_MS) {
        console.log(`[FestivalCache] READ "${slug}": entry expired`);
        return null;
      }
      if (entry.festivalArtistCount !== festivalArtistCount) {
        console.log(`[FestivalCache] READ "${slug}": lineup changed (cached ${entry.festivalArtistCount} vs current ${festivalArtistCount} artists)`);
        return null;
      }
      console.log(`[FestivalCache] READ "${slug}": HIT — ${entry.tracks.length} tracks, index ${entry.currentIndex}`);
      return entry;
    },

    clearCache: (slug) => {
      const newCache = { ...get().cache };
      delete newCache[slug];
      set({ cache: newCache });
      writeFile(newCache);
    },
  }),
);
