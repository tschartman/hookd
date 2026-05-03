// ─── festivalProgressStore.ts ─────────────────────────────────────────────────
// Tracks which artists the user has listened to per festival.
// Persisted locally via expo-file-system; synced to Supabase for cross-device.

import { File, Paths } from 'expo-file-system';
import { create } from 'zustand';

import { supabase } from '@/src/services/supabase';
import { useUserStore } from '@/src/stores/userStore';

// ─── Storage helpers ──────────────────────────────────────────────────────────

type ProgressData = Record<string, string[]>; // slug → heard artist names

function getProgressFile(): File {
  return new File(Paths.document, 'festival-progress.json');
}

async function readFile(): Promise<ProgressData> {
  try {
    const file = getProgressFile();
    if (!file.exists) return {};
    const content = await file.text();
    return JSON.parse(content) as ProgressData;
  } catch {
    return {};
  }
}

function writeFile(data: ProgressData): void {
  try {
    getProgressFile().write(JSON.stringify(data));
  } catch {
    // In-memory state is still correct — local write failure is non-fatal
  }
}

async function syncToSupabase(slug: string, heardArtists: string[]): Promise<void> {
  const userId = useUserStore.getState().profile?.id;
  if (!userId) return;
  await supabase
    .from('festival_progress')
    .upsert(
      {
        user_id: userId,
        festival_slug: slug,
        heard_artists: heardArtists,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,festival_slug' },
    );
}

async function loadFromSupabase(): Promise<ProgressData | null> {
  const userId = useUserStore.getState().profile?.id;
  if (!userId) return null;
  try {
    const { data } = await supabase
      .from('festival_progress')
      .select('festival_slug, heard_artists')
      .eq('user_id', userId);
    if (!data?.length) return null;
    const result: ProgressData = {};
    for (const row of data) {
      result[row.festival_slug as string] = (row.heard_artists as string[]) ?? [];
    }
    return result;
  } catch {
    return null;
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

type FestivalProgressState = {
  /** slug → array of heard artist names (arrays serialize cleanly to JSON) */
  progress: ProgressData;
  isLoaded: boolean;
};

type FestivalProgressActions = {
  /**
   * Load progress from Supabase (if logged in) then fall back to local file.
   * Safe to call multiple times — no-ops after first successful load.
   */
  loadProgress: () => Promise<void>;
  /** Record that the user has heard at least one track from this artist. */
  markArtistHeard: (slug: string, artistName: string) => void;
  /** Returns a Set of artist names the user has heard for a given festival. */
  getHeardArtists: (slug: string) => Set<string>;
  /** Wipe progress for a single festival (with Supabase sync). */
  resetProgress: (slug: string) => void;
};

export const useFestivalProgressStore = create<FestivalProgressState & FestivalProgressActions>(
  (set, get) => ({
    progress: {},
    isLoaded: false,

    loadProgress: async () => {
      if (get().isLoaded) return;

      // Try remote first so cross-device state wins over a stale local cache
      const remote = await loadFromSupabase();
      if (remote) {
        set({ progress: remote, isLoaded: true });
        writeFile(remote);
        return;
      }

      // Fall back to local file (offline or not logged in)
      const local = await readFile();
      set({ progress: local, isLoaded: true });
    },

    markArtistHeard: (slug, artistName) => {
      const current = get().progress[slug] ?? [];
      if (current.includes(artistName)) return; // already recorded

      const updated = [...current, artistName];
      const newProgress = { ...get().progress, [slug]: updated };
      set({ progress: newProgress });

      writeFile(newProgress);
      syncToSupabase(slug, updated).catch(() => {});
    },

    getHeardArtists: (slug) => new Set(get().progress[slug] ?? []),

    resetProgress: (slug) => {
      const newProgress = { ...get().progress };
      delete newProgress[slug];
      set({ progress: newProgress });

      writeFile(newProgress);
      syncToSupabase(slug, []).catch(() => {});
    },
  }),
);
