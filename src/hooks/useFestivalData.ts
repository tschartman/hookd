// ─── Festival data hook ───────────────────────────────────────────────────────
// Fetches festival data exclusively from Supabase.
// No hardcoded fallback — only festivals in the database are shown.

import { useEffect, useState } from 'react';

import { type Festival, type FestivalArtist, type ArtistTier } from '@/src/data/festivals';
import { supabase } from '@/src/services/supabase';
import type { ResolvedTrack } from '@/src/types/index';

// ─── Types matching Supabase column names ─────────────────────────────────────

interface SupabaseFestival {
  id: string;
  name: string;
  slug: string;
  dates: string | null;
  location: string | null;
  description: string | null;
  genre_tags: string[];
  estimated_attendance: number;
  image_color_primary: string;
  image_color_secondary: string;
  year: number | null;
  active: boolean;
  start_date: string | null;
  end_date: string | null;
  poster_url: string | null;
  festival_artists: SupabaseArtist[];
}

interface SupabaseArtist {
  id: string;
  name: string;
  tier: ArtistTier;
  genres: string[];
}

// ─── Module-level cache ───────────────────────────────────────────────────────

/** Loaded festivals, keyed by slug. Null means not yet fetched. */
const cache = new Map<string, Festival>();
let fetchPromise: Promise<void> | null = null;
/** Listeners notified when the fetch completes. */
const listeners = new Set<() => void>();

function transformFestival(row: SupabaseFestival): Festival {
  const artists: FestivalArtist[] = (row.festival_artists ?? []).map((a) => ({
    name: a.name,
    tier: a.tier,
    genres: a.genres ?? [],
  }));

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    dates: row.dates ?? '',
    location: row.location ?? '',
    description: row.description ?? '',
    genres: row.genre_tags ?? [],
    estimatedAttendance: row.estimated_attendance ?? 0,
    imageColors: {
      primary: row.image_color_primary ?? '#1DB954',
      secondary: row.image_color_secondary ?? '#0A0A0A',
    },
    artists,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    posterUrl: row.poster_url ?? undefined,
  };
}

async function fetchFromSupabase(): Promise<void> {
  const { data, error } = await supabase
    .from('festivals')
    .select(`
      id, name, slug, dates, location, description,
      genre_tags, estimated_attendance,
      image_color_primary, image_color_secondary,
      year, active, start_date, end_date, poster_url,
      festival_artists ( id, name, tier, genres )
    `)
    .eq('active', true);

  if (!error && data) {
    cache.clear();
    for (const row of data as SupabaseFestival[]) {
      cache.set(row.slug, transformFestival(row));
    }
  }

  listeners.forEach((fn) => fn());
  listeners.clear();
}

/** Trigger the Supabase fetch exactly once per session. */
function ensureFetched(): Promise<void> {
  if (!fetchPromise) {
    fetchPromise = fetchFromSupabase();
  }
  return fetchPromise;
}

function isFetched(): boolean {
  return fetchPromise !== null && cache.size >= 0;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Returns all active festivals from Supabase.
 * Shows a loading state until the first fetch completes.
 */
export function useFestivals(): { festivals: Festival[]; isLoading: boolean } {
  const [festivals, setFestivals] = useState<Festival[]>([]);
  const [isLoading, setIsLoading] = useState(!isFetched());

  useEffect(() => {
    let cancelled = false;

    ensureFetched().then(() => {
      if (!cancelled) {
        setFestivals([...cache.values()]);
        setIsLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, []);

  return { festivals, isLoading };
}

// ─── Resolved-track catalog ───────────────────────────────────────────────────

/**
 * Fetch all pre-resolved tracks for a list of festival artists in a single
 * Supabase query. Only rows where `itunes_preview_url IS NOT NULL` are
 * returned — these are ready to play, no iTunes calls needed.
 *
 * Returns a Map keyed by `artist_name` so callers can look up an artist's
 * full 50-track catalog instantly.
 */
export async function fetchFestivalTracks(
  artistNames: string[],
): Promise<Map<string, ResolvedTrack[]>> {
  if (!artistNames.length) return new Map();

  const { data, error } = await supabase
    .from('festival_artist_tracks')
    .select(
      'artist_name, track_name, track_rank, lastfm_listeners, lastfm_playcount, ' +
      'itunes_track_id, itunes_preview_url, itunes_artwork_url, ' +
      'itunes_artist_name, itunes_collection_name, itunes_release_date',
    )
    .in('artist_name', artistNames)
    .not('itunes_preview_url', 'is', null)
    .order('track_rank', { ascending: true });

  if (error || !data) {
    console.warn('[festival] fetchFestivalTracks error:', error?.message);
    return new Map();
  }

  const byArtist = new Map<string, ResolvedTrack[]>();
  for (const row of data as ResolvedTrack[]) {
    const existing = byArtist.get(row.artist_name) ?? [];
    existing.push(row);
    byArtist.set(row.artist_name, existing);
  }
  return byArtist;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Returns a single festival by slug, or null while loading / not found.
 */
export function useFestivalBySlug(slug: string): Festival | null {
  const [festival, setFestival] = useState<Festival | null>(
    () => cache.get(slug) ?? null,
  );

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    ensureFetched().then(() => {
      if (!cancelled) {
        setFestival(cache.get(slug) ?? null);
      }
    });

    return () => { cancelled = true; };
  }, [slug]);

  return festival;
}
