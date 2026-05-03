// ─── feedAlgorithm.ts ─────────────────────────────────────────────────────────
// Pure utility functions for feed ordering, deduplication, and genre selection.
// These are shared between the main feed (feed.tsx) and festival feeds.

import type { SpotifyTrack } from '@/src/services/spotify';

// ─── Artist Spacing ───────────────────────────────────────────────────────────

/**
 * Extract the primary artist from a potentially compound name.
 * "Martin Garrix & Dua Lipa" → "Martin Garrix"
 * "Tiësto & Charli xcx"      → "Tiësto"
 * "Daft Punk feat. Pharrell"  → "Daft Punk"
 *
 * Used by all spacing functions so featured artists don't break spacing.
 */
export function extractPrimaryArtist(artistName: string): string {
  return artistName.split(/[&,]|feat\.|ft\./i)[0].trim();
}

/**
 * Ensure no two consecutive tracks are from the same artist.
 * When a collision is found at position i, looks ahead up to 20 positions
 * for a swap candidate that differs from both the current and previous artist.
 * Compares primary artists so "Martin Garrix & Dua Lipa" and "Martin Garrix"
 * are treated as the same artist.
 */
export function applyArtistSpacing(tracks: SpotifyTrack[]): SpotifyTrack[] {
  const result = [...tracks];
  for (let i = 1; i < result.length; i++) {
    const cur  = extractPrimaryArtist(result[i].artists[0]?.name ?? '');
    const prev = extractPrimaryArtist(result[i - 1].artists[0]?.name ?? '');
    if (!cur || cur !== prev) continue;

    let swapIndex = -1;
    for (let j = i + 1; j < Math.min(i + 20, result.length); j++) {
      const candidate = extractPrimaryArtist(result[j].artists[0]?.name ?? '');
      if (candidate !== cur && candidate !== prev) {
        swapIndex = j;
        break;
      }
    }
    if (swapIndex !== -1) {
      [result[i], result[swapIndex]] = [result[swapIndex], result[i]];
    }
  }
  return result;
}

/**
 * Run artist spacing twice to catch edge cases left by the first pass.
 * Use this instead of applyArtistSpacing for final queue builds.
 */
export function spaceTracks(tracks: SpotifyTrack[]): SpotifyTrack[] {
  return applyArtistSpacing(applyArtistSpacing(tracks));
}

/**
 * Enforce a minimum gap of `minGap` positions between tracks by the same artist.
 * Single O(n) forward pass: when a conflict is found at position i, the track
 * is swapped with the next track (after i) that has a different artist.
 * Falls back gracefully when no swap candidate exists (e.g. all remaining
 * tracks are by the same artist).
 * Compares primary artists so featured-artist variants don't break spacing.
 */
export function enforceArtistSpacing(tracks: SpotifyTrack[], minGap = 3): SpotifyTrack[] {
  const result = [...tracks];
  for (let i = 0; i < result.length; i++) {
    const curArtist = extractPrimaryArtist(result[i].artists[0]?.name ?? '');
    // Check whether this artist appeared within the last minGap positions
    let conflict = false;
    for (let k = Math.max(0, i - minGap); k < i; k++) {
      if (extractPrimaryArtist(result[k].artists[0]?.name ?? '') === curArtist) {
        conflict = true;
        break;
      }
    }
    if (!conflict) continue;
    // Find the next track with a different artist to swap in
    for (let j = i + 1; j < result.length; j++) {
      if (extractPrimaryArtist(result[j].artists[0]?.name ?? '') !== curArtist) {
        [result[i], result[j]] = [result[j], result[i]];
        break;
      }
    }
  }
  return result;
}

/**
 * Keep at most `max` randomly chosen tracks per artist.
 * Prevents any single artist from dominating a queue batch.
 */
export function limitArtistTracks(tracks: SpotifyTrack[], max = 3): SpotifyTrack[] {
  const byArtist = new Map<string, SpotifyTrack[]>();
  for (const t of tracks) {
    const key = t.artists[0]?.name ?? '__unknown__';
    if (!byArtist.has(key)) byArtist.set(key, []);
    byArtist.get(key)!.push(t);
  }
  const result: SpotifyTrack[] = [];
  for (const [, artistTracks] of byArtist) {
    const shuffled = [...artistTracks].sort(() => Math.random() - 0.5);
    result.push(...shuffled.slice(0, max));
  }
  return result;
}

/**
 * Reorder `tracks` so the first `count` positions each have a distinct artist.
 * Remaining tracks are appended after. Call after spacing for the initial queue.
 */
export function ensureDistinctStart(tracks: SpotifyTrack[], count = 5): SpotifyTrack[] {
  if (tracks.length <= count) return tracks;
  const front: SpotifyTrack[] = [];
  const rest: SpotifyTrack[] = [];
  const seen = new Set<string>();
  for (const t of tracks) {
    const artist = t.artists[0]?.name ?? '';
    if (front.length < count && !seen.has(artist)) {
      front.push(t);
      seen.add(artist);
    } else {
      rest.push(t);
    }
  }
  return [...front, ...rest];
}

// ─── Genre Spacing ────────────────────────────────────────────────────────────

/**
 * Ensure no 3+ consecutive tracks share the same primary genre.
 * When a run is detected at position i, the track at i is swapped with the
 * nearest different-genre track within 10 positions ahead.
 */
export function applyGenreSpacing(tracks: SpotifyTrack[]): SpotifyTrack[] {
  const result = [...tracks];
  for (let i = 2; i < result.length; i++) {
    const g0 = result[i - 2].primaryGenreName;
    const g1 = result[i - 1].primaryGenreName;
    const g2 = result[i].primaryGenreName;
    if (!g0 || !g1 || !g2) continue;
    if (g0 !== g1 || g1 !== g2) continue;

    // 3-consecutive run detected at i — find a swap candidate
    for (let j = i + 1; j < result.length && j <= i + 10; j++) {
      if (result[j].primaryGenreName !== g2) {
        [result[i], result[j]] = [result[j], result[i]];
        break;
      }
    }
  }
  return result;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/**
 * Normalize a track name for grouping — strips version markers so
 * "New Rules", "New Rules (Remix)", "New Rules - Acoustic" all collapse
 * to the same key. Used both for SpotifyTrack queue dedup and mission pool dedup.
 */
export function normalizeTrackForGrouping(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .replace(
      /\s*[-–—]\s*(remix|remaster|remastered|live|acoustic|radio edit|radio mix|deluxe|bonus|edit|version|mix|extended|instrumental|stripped|unplugged|demo|single|album|original).*$/gi,
      '',
    )
    .replace(/\s*(feat\.?|ft\.?|featuring)\s+.*/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

/**
 * Normalize an artist name for grouping — takes only the primary artist,
 * stripping features and special characters.
 */
export function normalizeArtistForGrouping(name: string): string {
  return name
    .toLowerCase()
    .split(/\s*(feat\.?|ft\.?|featuring|,|&)\s*/i)[0]
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

/**
 * Remove tracks from `incoming` that:
 * - Are already in `playedIds` (played this session — saved or skipped)
 * - Are already in `existingQueueIds` (ahead in the current queue)
 * - Are name+artist duplicates of anything else in the incoming batch
 *
 * Name+artist matching uses aggressive normalization so different versions
 * of the same track (remix, remaster, etc.) are treated as the same track.
 */
export function deduplicateTracks(
  incoming: SpotifyTrack[],
  existingQueueIds: Set<string>,
  playedIds: Set<string>,
): SpotifyTrack[] {
  const seenKeys = new Set<string>(); // artist|||name keys within this batch
  const result: SpotifyTrack[] = [];

  for (const track of incoming) {
    if (playedIds.has(track.id)) continue;
    if (existingQueueIds.has(track.id)) continue;

    const key =
      `${normalizeArtistForGrouping(track.artists[0]?.name ?? '')}` +
      `|||${normalizeTrackForGrouping(track.name)}`;
    if (seenKeys.has(key)) continue;

    seenKeys.add(key);
    result.push(track);
  }

  return result;
}

// ─── Mission Pool Deduplication ───────────────────────────────────────────────

interface MissionPoolTrack {
  track_name: string;
  artist_name: string;
  tag_count: number;
  listeners: number;
}

/**
 * Group Supabase mission tracks by normalized name + artist and keep only the
 * best version per group.
 * Best = highest tag_count → highest listeners → shortest name (cleanest version).
 */
export function deduplicateMissionTracks<T extends MissionPoolTrack>(tracks: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const track of tracks) {
    const key =
      normalizeTrackForGrouping(track.track_name) +
      '|||' +
      normalizeArtistForGrouping(track.artist_name);
    const group = groups.get(key) ?? [];
    group.push(track);
    groups.set(key, group);
  }
  const result: T[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    const best = [...group].sort((a, b) => {
      if (b.tag_count !== a.tag_count) return b.tag_count - a.tag_count;
      if (b.listeners !== a.listeners) return b.listeners - a.listeners;
      return a.track_name.length - b.track_name.length;
    })[0];
    result.push(best);
  }
  return result;
}

/**
 * Cap tracks per artist to `max`. Input must already be sorted by quality
 * (tag_count desc, listeners desc) so the best tracks survive the cap.
 */
export function capMissionArtistTracks<T extends MissionPoolTrack>(tracks: T[], max = 3): T[] {
  const artistCount = new Map<string, number>();
  return tracks.filter((track) => {
    const artist = normalizeArtistForGrouping(track.artist_name);
    const count = artistCount.get(artist) ?? 0;
    if (count >= max) return false;
    artistCount.set(artist, count + 1);
    return true;
  });
}

// ─── Genre Synonyms ───────────────────────────────────────────────────────────

/**
 * Maps a broad seed genre to a pool of more specific iTunes search terms.
 * `expandGenreSynonym` picks one at random so consecutive queue refills
 * don't repeat the exact same query and surface different slices of iTunes.
 */
const GENRE_SYNONYMS: Record<string, string[]> = {
  pop:        ['pop', 'pop hits', 'viral pop', 'top 40', 'dance pop'],
  'hip hop':  ['hip hop', 'rap', 'trap', 'boom bap', 'underground rap'],
  electronic: ['electronic', 'deep house', 'synthwave', 'techno', 'edm'],
  indie:      ['indie rock', 'indie pop', 'bedroom pop', 'lo-fi indie', 'dreamy indie'],
  dance:      ['dance', 'dance pop', 'club', 'house', 'disco'],
  soul:       ['soul', 'neo soul', 'r&b', 'funk', 'motown'],
  rock:       ['rock', 'alternative rock', 'classic rock', 'garage rock', 'grunge'],
  jazz:       ['jazz', 'smooth jazz', 'jazz fusion', 'bebop', 'cool jazz'],
  country:    ['country', 'country pop', 'americana', 'bluegrass', 'outlaw country'],
  folk:       ['folk', 'acoustic folk', 'singer songwriter', 'indie folk', 'folk pop'],
  metal:      ['metal', 'heavy metal', 'hard rock', 'punk rock', 'thrash metal'],
  latin:      ['latin', 'reggaeton', 'salsa', 'latin pop', 'afrobeats'],
  classical:  ['classical', 'orchestral', 'piano', 'symphony', 'chamber music'],
  reggae:     ['reggae', 'ska', 'dub', 'roots reggae', 'dancehall'],
};

/**
 * Pick a random specific search term for the given genre. If the genre has no
 * synonym map entry, the genre string is returned unchanged.
 */
export function expandGenreSynonym(genre: string): string {
  const pool = GENRE_SYNONYMS[genre.toLowerCase()];
  if (!pool || !pool.length) return genre;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Vibe-Weighted Genre Selection ───────────────────────────────────────────

/**
 * Select `count` genre search terms for a queue refill, weighted by the
 * current session vibe:
 *  - 80% chance each slot pulls from the top session genres
 *  - 20% chance it pulls from `basePool` genres NOT yet in the vibe
 *
 * Each selected term is expanded via `expandGenreSynonym` so iTunes queries
 * don't repeat verbatim across consecutive refills.
 *
 * Falls back to shuffled `basePool` when no vibe data exists yet (fresh session).
 */
export function selectRefillGenres(
  genreDistribution: Record<string, number>,
  basePool: string[],
  count = 3,
): string[] {
  const topVibeGenres = Object.keys(genreDistribution).sort(
    (a, b) => genreDistribution[b] - genreDistribution[a],
  );
  const unexplored = basePool.filter((g) => !topVibeGenres.includes(g));

  if (!topVibeGenres.length) {
    // Fresh session — just pick random genres from the base pool
    const shuffled = [...basePool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count).map(expandGenreSynonym);
  }

  const selected: string[] = [];
  for (let i = 0; i < count; i++) {
    const useVibe = Math.random() < 0.8;
    const pool = useVibe
      ? topVibeGenres
      : unexplored.length > 0
        ? unexplored
        : basePool;
    const raw = pool[Math.floor(Math.random() * pool.length)];
    selected.push(expandGenreSynonym(raw));
  }

  return selected;
}
