// ─── lastfm.ts ────────────────────────────────────────────────────────────────
// App-side discovery service. Despite the name, this talks to SUPABASE at
// runtime — not Last.fm. Last.fm is only touched by the Edge Function cache
// refresh job (supabase/functions/refresh-genre-era-cache).
//
// ONE exception: getSimilarArtists() may call Last.fm directly on a cache miss
// for "sounds like" artists that haven't been pre-cached. This only fires for
// user-typed artist names on the mission vibe screen. Results are cached back
// to Supabase so subsequent lookups are instant.

import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenreEraArtist {
  artist_name: string;
  lastfm_listeners: number;
  rank: number;
}

export interface SimilarArtist {
  artist_name: string;
  match_score: number;
}

// ─── Genre × Era artist lookup ────────────────────────────────────────────────

/**
 * Get artists for a genre × era combo, ranked by Last.fm listener count.
 * Reads from Supabase cache (populated weekly by the Edge Function).
 *
 * @param genre  Lowercase genre id, e.g. 'pop', 'rock', 'hip-hop'
 * @param era    Era string, e.g. '90s', '00s'
 * @param options.limit          Max artists to return (default 50)
 * @param options.offset         Row offset for pagination / session variety
 * @param options.excludeArtists Artists to skip (already seen this session)
 */
export async function getArtistsForGenreEra(
  genre: string,
  era: string,
  options?: {
    limit?: number;
    offset?: number;
    excludeArtists?: string[];
  },
): Promise<GenreEraArtist[]> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  let query = supabase
    .from('genre_era_artists')
    .select('artist_name, lastfm_listeners, rank')
    .eq('genre', genre.toLowerCase())
    .eq('era', era)
    .order('rank', { ascending: true });

  if (offset > 0) {
    query = query.range(offset, offset + limit - 1);
  } else {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    console.warn('[lastfm] getArtistsForGenreEra error:', error.message);
    return [];
  }

  const results: GenreEraArtist[] = (data ?? []).map((r) => ({
    artist_name: r.artist_name as string,
    lastfm_listeners: (r.lastfm_listeners as number) ?? 0,
    rank: r.rank as number,
  }));

  // Client-side exclude filter (Supabase `not in` requires specific escaping)
  if (options?.excludeArtists?.length) {
    const excluded = new Set(options.excludeArtists.map((a) => a.toLowerCase()));
    return results.filter((r) => !excluded.has(r.artist_name.toLowerCase()));
  }

  return results;
}

// ─── Mission artist pool ──────────────────────────────────────────────────────

/**
 * Get artists for a mission — combines multiple genres × eras.
 * Returns a merged list sorted by Last.fm listener count (most popular first).
 * Queries all genre × era combos in parallel.
 *
 * @param genres  Lowercase genre ids, e.g. ['pop', 'electronic']
 * @param eras    Era strings; if empty, spans all eras
 * @param options.limit          Max artists in merged result (default 100)
 * @param options.excludeArtists Artists to skip
 */
export async function getArtistsForMission(
  genres: string[],
  eras: string[],
  options?: {
    limit?: number;
    excludeArtists?: string[];
  },
): Promise<GenreEraArtist[]> {
  const allEras = eras.length > 0
    ? eras
    : ['50s', '60s', '70s', '80s', '90s', '00s', '10s', '20s'];

  // Query all genre × era combos in parallel
  const queries = genres.flatMap((genre) =>
    allEras.map((era) =>
      getArtistsForGenreEra(genre, era, {
        limit: 30,
        excludeArtists: options?.excludeArtists,
      }),
    ),
  );

  const batches = await Promise.all(queries);

  // Flatten, deduplicate by artist name (keep the entry with highest listener count)
  const artistMap = new Map<string, GenreEraArtist>();
  for (const batch of batches) {
    for (const artist of batch) {
      const key = artist.artist_name.toLowerCase();
      const existing = artistMap.get(key);
      if (!existing || artist.lastfm_listeners > existing.lastfm_listeners) {
        artistMap.set(key, artist);
      }
    }
  }

  // Sort by listener count descending
  const sorted = [...artistMap.values()].sort(
    (a, b) => b.lastfm_listeners - a.lastfm_listeners,
  );

  return sorted.slice(0, options?.limit ?? 100);
}

// ─── Similar artist lookup ────────────────────────────────────────────────────

/**
 * Get similar artists for adaptive mission discovery.
 *
 * Flow:
 * 1. Check Supabase `lastfm_similar_artists` cache.
 * 2. Cache hit → return results immediately.
 * 3. Cache miss → call Last.fm API directly (if LASTFM_API_KEY is available),
 *    cache results in Supabase, return results.
 * 4. No API key or Last.fm unavailable → return [] gracefully.
 *
 * The Last.fm API key is stored in app.json `extra.lastfmApiKey` — it is a
 * free, public API key (not a secret). It is only used here, never for bulk
 * discovery (that stays server-side in the Edge Function).
 */
export async function getSimilarArtists(
  artistName: string,
  limit = 10,
): Promise<SimilarArtist[]> {
  // ── 1. Check cache ──────────────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('lastfm_similar_artists')
    .select('similar_artist, match_score')
    .eq('source_artist', artistName)
    .order('match_score', { ascending: false })
    .limit(limit);

  if (!error && data && data.length > 0) {
    return data.map((d) => ({
      artist_name: d.similar_artist as string,
      match_score: (d.match_score as number) ?? 0.5,
    }));
  }

  // ── 2. Cache miss: try Last.fm directly ────────────────────────────────────
  const apiKey = getLastfmApiKey();
  if (!apiKey) {
    // No API key configured — skip gracefully.
    // The mission still works, just no similar-artist boosting for this artist.
    console.log(`[lastfm] getSimilarArtists: no API key, skipping cache fill for "${artistName}"`);
    return [];
  }

  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(artistName)}&api_key=${apiKey}&format=json&limit=20`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[lastfm] getSimilarArtists HTTP ${res.status} for "${artistName}"`);
      return [];
    }

    const json = await res.json();
    const similar: Array<{ name: string; match: string }> =
      json?.similarartists?.artist ?? [];

    if (!similar.length) return [];

    // Cache in Supabase for next time
    const rows = similar.map((s) => ({
      source_artist: artistName,
      similar_artist: s.name,
      match_score: parseFloat(s.match) || 0,
      updated_at: new Date().toISOString(),
    }));

    // Fire-and-forget; don't block the mission on the write
    supabase
      .from('lastfm_similar_artists')
      .upsert(rows, { onConflict: 'source_artist,similar_artist' })
      .then(({ error: writeErr }) => {
        if (writeErr) console.warn('[lastfm] similar artists cache write failed:', writeErr.message);
      });

    return similar.slice(0, limit).map((s) => ({
      artist_name: s.name,
      match_score: parseFloat(s.match) || 0,
    }));
  } catch (err) {
    console.warn(`[lastfm] getSimilarArtists fetch failed for "${artistName}":`, err);
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the Last.fm API key from expo-constants app config.
 * Configure in app.json: { "extra": { "lastfmApiKey": "YOUR_KEY" } }
 * This is a free, public API key — not a secret.
 */
function getLastfmApiKey(): string | null {
  try {
    // Dynamic import to avoid bundling issues on platforms that don't support it
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require('expo-constants').default;
    return (Constants.expoConfig?.extra?.lastfmApiKey as string) ?? null;
  } catch {
    return null;
  }
}
