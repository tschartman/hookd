import type { ArtistTier } from '@/src/data/festivals';
import type { SpotifyTrack } from './spotify';

// ─── iTunes Search API ────────────────────────────────────────────────────────
// Free, no auth, reliable 30-second preview URLs on virtually all tracks.
// We map results to SpotifyTrack so all existing components work unchanged.
// external_urls.spotify contains the Apple Music URL for this source.

const ITUNES_BASE = 'https://itunes.apple.com';

// ─── Global request queue ─────────────────────────────────────────────────────
// ALL iTunes HTTP calls go through this single queue so we never fire more than
// one request at a time and never burst Apple's undocumented rate limits.
//
//  • 300 ms minimum spacing between requests   (~3 req/s  — safe for Apple)
//  • Max 15 requests per rolling 60-second window
//  • 403 backoff: 2 s → 5 s → 15 s for consecutive rate-limited responses

let _queueTail: Promise<unknown> = Promise.resolve();
let _lastRequestAt = 0;
let _requestTimestamps: number[] = [];
let _consecutive403 = 0;
/**
 * Monotonically increasing counter. Incremented by abortAllPending().
 * Each queuedFetch() captures the generation at enqueue time; if the counter
 * has advanced by the time the slot is reached, the request is skipped.
 */
let _queueGeneration = 0;
let _pendingCount = 0;

const REQUEST_DELAY_MS = 300;
const MAX_PER_MIN = 20;
const BACKOFF_403_MS = [2_000, 5_000, 15_000] as const;

/**
 * Reset the rate-limit window. Call this whenever the feed context changes so
 * a previous feed's request count doesn't block the next feed from starting.
 * Safe because feeds never run concurrently; 300 ms spacing + 403 backoff still
 * protect against actual Apple rate limiting.
 */
export function resetRateLimitWindow() {
  _requestTimestamps = [];
  _consecutive403 = 0;
  console.log('[itunes] rate limit window reset');
}

/**
 * Abort all pending (queued but not yet started) iTunes requests and reset the
 * rate-limit window. Call this on every feed context switch so requests queued
 * by the previous feed don't block the next feed from loading.
 *
 * In-flight requests (the one currently executing _runFetch) complete normally —
 * there is always at most one in-flight request. All subsequent items in the
 * promise chain resolve immediately with empty results.
 */
export function abortAllPending() {
  _queueGeneration++;
  _pendingCount = 0; // all pending slots are being abandoned
  resetRateLimitWindow();
  console.log(`[itunes] pending requests aborted (gen=${_queueGeneration})`);
}

/**
 * Returns true if there are any requests currently queued or in-flight.
 * Used by the artist prefetch system to avoid competing with active feeds.
 */
export function hasQueuedRequests(): boolean {
  return _pendingCount > 0;
}

async function _runFetch(url: string): Promise<Response> {
  // 1. Per-minute rate cap
  const nowCap = Date.now();
  _requestTimestamps = _requestTimestamps.filter((t) => nowCap - t < 60_000);
  if (_requestTimestamps.length >= MAX_PER_MIN) {
    const waitMs = _requestTimestamps[0] + 60_000 - Date.now();
    if (waitMs > 0) {
      console.log(`[itunes] rate cap ${MAX_PER_MIN}/min — waiting ${Math.ceil(waitMs / 1000)}s`);
      await new Promise<void>((r) => setTimeout(r, waitMs));
    }
    // Re-trim after the wait
    _requestTimestamps = _requestTimestamps.filter((t) => Date.now() - t < 60_000);
  }

  // 2. Minimum spacing since last request
  const elapsed = Date.now() - _lastRequestAt;
  if (elapsed < REQUEST_DELAY_MS) {
    await new Promise<void>((r) => setTimeout(r, REQUEST_DELAY_MS - elapsed));
  }

  _lastRequestAt = Date.now();
  _requestTimestamps.push(_lastRequestAt);

  const res = await fetch(url);

  // 3. 403 backoff
  if (res.status === 403) {
    const idx = Math.min(_consecutive403, BACKOFF_403_MS.length - 1);
    const backoffMs = BACKOFF_403_MS[idx];
    _consecutive403++;
    console.warn(`[itunes] rate limited, backing off ${backoffMs / 1000}s`);
    await new Promise<void>((r) => setTimeout(r, backoffMs));
  } else {
    _consecutive403 = 0;
  }

  return res;
}

// Empty-result body reused by aborted requests so callers see a clean [] return.
const ABORTED_BODY = '{"resultCount":0,"results":[]}';

/**
 * Queue a fetch to the iTunes Search API.
 * Callers get back a normal Promise<Response>; the queue ensures at most one
 * in-flight request at a time with proper spacing and backoff.
 *
 * If abortAllPending() is called after this request was enqueued but before its
 * slot is reached, the request resolves immediately with empty results (no
 * network call, no rate-limit cost).
 */
function queuedFetch(url: string): Promise<Response> {
  const capturedGen = _queueGeneration; // snapshot at enqueue time
  _pendingCount++; // track in-flight + queued request count
  let resolve!: (res: Response) => void;
  let reject!: (err: unknown) => void;
  const p = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Chain onto the global tail.  Use an async wrapper so that an error in
  // _runFetch is caught here (preventing a rejected _queueTail that would
  // swallow all subsequent requests).
  _queueTail = _queueTail.then(async () => {
    if (_queueGeneration !== capturedGen) {
      // This request was abandoned by abortAllPending() — skip it instantly.
      _pendingCount = Math.max(0, _pendingCount - 1);
      resolve(new Response(ABORTED_BODY, { status: 200 }));
      return;
    }
    try {
      const res = await _runFetch(url);
      _pendingCount = Math.max(0, _pendingCount - 1);
      resolve(res);
    } catch (err) {
      _pendingCount = Math.max(0, _pendingCount - 1);
      reject(err);
    }
  });
  return p;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ItunesTrack = {
  kind: string;
  trackId: number;
  trackName: string;
  artistName: string;
  artistId: number;
  collectionName: string;
  collectionId: number;
  artworkUrl100: string;
  previewUrl?: string;
  trackTimeMillis: number;
  trackViewUrl: string;
  primaryGenreName: string;
  releaseDate?: string;
};

type ItunesSearchResult = {
  resultCount: number;
  results: ItunesTrack[];
};

// ─── Mapping ──────────────────────────────────────────────────────────────────

function mapToSpotifyTrack(t: ItunesTrack): SpotifyTrack {
  // Artwork is returned at 100x100; swap for a larger size
  const artHigh = t.artworkUrl100.replace('100x100bb', '600x600bb');

  return {
    id: String(t.trackId),
    name: t.trackName,
    preview_url: t.previewUrl ?? null,
    duration_ms: t.trackTimeMillis ?? 30_000,
    artists: [{ id: String(t.artistId), name: t.artistName }],
    album: {
      id: String(t.collectionId),
      name: t.collectionName ?? '',
      images: [
        { url: artHigh, width: 600, height: 600 },
        { url: t.artworkUrl100, width: 100, height: 100 },
      ],
    },
    // Points to Apple Music — used for the share sheet URL
    external_urls: { spotify: t.trackViewUrl ?? '' },
    primaryGenreName: t.primaryGenreName,
    releaseYear: t.releaseDate ? parseInt(t.releaseDate.slice(0, 4), 10) : undefined,
  };
}

// ─── Artist search ────────────────────────────────────────────────────────────

/**
 * Search iTunes for tracks by a specific artist name.
 * Uses attribute=artistTerm for precision so results are actually by that artist.
 */
export async function searchTracksByArtist(
  artist: string,
  limit = 3,
): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({
    term: artist,
    media: 'music',
    entity: 'song',
    attribute: 'artistTerm',
    limit: String(Math.min(Math.max(1, limit), 50)),
  });

  try {
    const res = await queuedFetch(`${ITUNES_BASE}/search?${params.toString()}`);
    if (!res.ok) {
      console.warn(`[itunes] artist="${artist}" status=${res.status}`);
      return [];
    }
    const data: ItunesSearchResult = await res.json();
    const needle = artist.toLowerCase();
    return data.results
      .filter((r) => {
        if (r.kind !== 'song' || !r.previewUrl) return false;
        const hay = r.artistName.toLowerCase();
        return hay.includes(needle) || needle.includes(hay);
      })
      .map(mapToSpotifyTrack);
  } catch (err) {
    console.warn(`[itunes] artist="${artist}" failed:`, err);
    return [];
  }
}

// ─── Artist autocomplete ──────────────────────────────────────────────────────

export interface ArtistResult {
  name: string;
  id: string;
  imageUrl: string | null;
}

/**
 * Search iTunes for artist names matching a query string.
 * Used by the vibe screen "Sounds like..." autocomplete input.
 * Goes through the global rate-limiter queue.
 */
export async function searchArtistsByName(
  query: string,
  limit = 5,
): Promise<ArtistResult[]> {
  const params = new URLSearchParams({
    term: query,
    media: 'music',
    entity: 'musicArtist',
    limit: String(Math.min(Math.max(1, limit), 25)),
  });

  try {
    const res = await queuedFetch(`${ITUNES_BASE}/search?${params.toString()}`);
    if (!res.ok) {
      console.warn(`[itunes] artist autocomplete status=${res.status}`);
      return [];
    }
    const data = await res.json() as { results: Array<{ artistName: string; artistId: number; artworkUrl60?: string }> };
    return data.results.map((r) => ({
      name: r.artistName,
      id: String(r.artistId),
      imageUrl: r.artworkUrl60 ?? null,
    }));
  } catch (err) {
    console.warn('[itunes] searchArtistsByName failed:', err);
    return [];
  }
}

// ─── Festival artist search ───────────────────────────────────────────────────

/**
 * Fetch tracks for a festival artist and tag each result with its tier and
 * its 1-indexed position in the iTunes results (lower = more popular).
 * Preserves original result order so popularity ranking is accurate.
 */
export async function searchFestivalArtistTracks(
  artist: string,
  limit: number,
  tier: ArtistTier,
  genres?: string[],
): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({
    term: artist,
    media: 'music',
    entity: 'song',
    attribute: 'artistTerm',
    limit: String(Math.min(Math.max(1, limit), 50)),
  });

  try {
    const res = await queuedFetch(`${ITUNES_BASE}/search?${params.toString()}`);
    if (!res.ok) {
      console.warn(`[itunes] festival artist="${artist}" status=${res.status}`);
      return [];
    }
    const data: ItunesSearchResult = await res.json();
    const needle = artist.toLowerCase();
    const tracks: SpotifyTrack[] = [];

    for (let i = 0; i < data.results.length; i++) {
      const r = data.results[i];
      if (r.kind !== 'song' || !r.previewUrl) continue;
      const hay = r.artistName.toLowerCase();
      if (!hay.includes(needle) && !needle.includes(hay)) continue;
      tracks.push({ ...mapToSpotifyTrack(r), tier, popularity: i + 1, genres });
    }

    return tracks;
  } catch (err) {
    console.warn(`[itunes] festival artist="${artist}" failed:`, err);
    return [];
  }
}

// ─── Single-term search ───────────────────────────────────────────────────────

/**
 * Fetch playable tracks from iTunes for a single search term.
 */
export async function searchByTerm(term: string, limit = 20): Promise<SpotifyTrack[]> {
  const safeLimit = Math.min(Math.max(1, limit), 50);
  const params = new URLSearchParams({
    term,
    media: 'music',
    entity: 'song',
    limit: String(safeLimit),
  });

  try {
    const res = await queuedFetch(`${ITUNES_BASE}/search?${params.toString()}`);
    if (!res.ok) {
      console.warn(`[itunes] term="${term}" status=${res.status}`);
      return [];
    }
    const data: ItunesSearchResult = await res.json();
    return data.results
      .filter((r) => r.kind === 'song' && !!r.previewUrl)
      .map(mapToSpotifyTrack);
  } catch (err) {
    console.warn(`[itunes] term="${term}" failed:`, err);
    return [];
  }
}

// ─── Discovery ────────────────────────────────────────────────────────────────

/**
 * Fetch playable (preview_url present) tracks from the iTunes Search API.
 * Fetches all provided `genres` sequentially through the global queue.
 */
export async function discoverTracksFromItunes(
  genres: string[],
  limit = 20,
): Promise<SpotifyTrack[]> {
  const safeLimit = Math.min(Math.max(1, limit), 50);

  const fetchGenre = async (genre: string): Promise<SpotifyTrack[]> => {
    const params = new URLSearchParams({
      term: genre,
      media: 'music',
      entity: 'song',
      limit: String(safeLimit),
    });

    try {
      const res = await queuedFetch(`${ITUNES_BASE}/search?${params.toString()}`);
      if (!res.ok) {
        console.warn(`[itunes] genre="${genre}" status=${res.status}`);
        return [];
      }
      const data: ItunesSearchResult = await res.json();
      const tracks = data.results
        .filter((r) => r.kind === 'song' && !!r.previewUrl)
        .map(mapToSpotifyTrack);
      console.log(`[itunes] genre="${genre}" total=${data.resultCount} withPreview=${tracks.length}`);
      return tracks;
    } catch (err) {
      console.warn(`[itunes] genre="${genre}" failed:`, err);
      return [];
    }
  };

  // Sequential — the global queue already serialises, but explicit sequencing
  // keeps the interleave logic predictable.
  const batches: SpotifyTrack[][] = [];
  for (const genre of genres) {
    batches.push(await fetchGenre(genre));
  }

  // Interleave results so the feed alternates genres
  const combined: SpotifyTrack[] = [];
  const max = Math.max(...batches.map((b) => b.length), 0);
  for (let i = 0; i < max; i++) {
    for (const batch of batches) {
      if (batch[i]) combined.push(batch[i]);
    }
  }
  return combined;
}

// ─── Artist view search ───────────────────────────────────────────────────────

/**
 * Process raw iTunes results for an artist view: filter by artist match,
 * deduplicate by track name + duration, sort primary artist first.
 * Exported so the prefetch service can reuse the same logic without going
 * through the global rate-limiter queue.
 */
export function processArtistViewResults(
  results: ItunesTrack[],
  artistName: string,
): SpotifyTrack[] {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const needle = normalize(artistName);

  const filtered = results.filter((r) => {
    if (r.kind !== 'song' || !r.previewUrl) return false;
    const hay = normalize(r.artistName);
    return hay.includes(needle) || needle.includes(hay);
  });

  const seen = new Set<string>();
  const deduped = filtered.filter((r) => {
    const key = normalize(r.trackName) + '_' + r.trackTimeMillis;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const sorted = [...deduped].sort((a, b) => {
    const aIsPrimary = normalize(a.artistName) === needle ? 0 : 1;
    const bIsPrimary = normalize(b.artistName) === needle ? 0 : 1;
    return aIsPrimary - bIsPrimary;
  });

  return sorted.map(mapToSpotifyTrack);
}

/**
 * Fetch up to 50 tracks for an artist, deduplicated and sorted by popularity.
 * Primary artist tracks come first, followed by features.
 * Used by the artist detail screen.
 */
export async function searchArtistTracksForView(
  artistName: string,
): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({
    term: artistName,
    media: 'music',
    entity: 'song',
    attribute: 'artistTerm',
    limit: '50',
  });

  try {
    const res = await queuedFetch(`${ITUNES_BASE}/search?${params.toString()}`);
    if (!res.ok) {
      console.warn(`[itunes] artist view="${artistName}" status=${res.status}`);
      return [];
    }
    const data: ItunesSearchResult = await res.json();
    const tracks = processArtistViewResults(data.results, artistName);
    console.log(
      `[artist] Fetched ${data.results.length} results → ${tracks.length} unique tracks for "${artistName}"`,
    );
    return tracks;
  } catch (err) {
    console.warn(`[itunes] artist view="${artistName}" failed:`, err);
    return [];
  }
}

// ─── Track name search ────────────────────────────────────────────────────────

/**
 * Search iTunes for a specific track by name + artist.
 * Used by the mission pool for gold/silver tier items sourced from Spotify
 * playlist data — finds the exact song that real users curated for the activity.
 *
 * More precise than artist search: we know the track name, so we can find it
 * directly rather than fetching all of an artist's tracks and hoping the right
 * one appears.
 */
export async function searchTrackByName(
  trackName: string,
  artistName: string,
  limit = 3,
): Promise<SpotifyTrack[]> {
  const term = `${trackName} ${artistName}`;
  const params = new URLSearchParams({
    term,
    media: 'music',
    entity: 'song',
    limit: String(Math.min(Math.max(1, limit), 10)),
  });

  try {
    const res = await queuedFetch(`${ITUNES_BASE}/search?${params.toString()}`);
    if (!res.ok) {
      console.warn(`[itunes] track search="${trackName}" artist="${artistName}" status=${res.status}`);
      return [];
    }
    const data: ItunesSearchResult = await res.json();
    // Normalize for loose artist matching (handles "feat." variants etc.)
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const needle = normalize(artistName);
    return data.results
      .filter((r) => {
        if (r.kind !== 'song' || !r.previewUrl) return false;
        const hay = normalize(r.artistName);
        return hay.includes(needle) || needle.includes(hay);
      })
      .slice(0, limit)
      .map(mapToSpotifyTrack);
  } catch (err) {
    console.warn(`[itunes] track search="${trackName}" failed:`, err);
    return [];
  }
}

// ─── Era-filtered search ──────────────────────────────────────────────────────

/**
 * Search iTunes for an artist's tracks and filter by release year range.
 * yearStart and yearEnd are INCLUSIVE with ±3 year relaxation already applied by caller.
 * Tracks with no releaseDate are passed through (don't exclude on missing data).
 */
export async function searchTracksByArtistInRange(
  artist: string,
  limit: number,
  yearStart: number,
  yearEnd: number,
): Promise<SpotifyTrack[]> {
  const tracks = await searchTracksByArtist(artist, limit);
  return tracks.filter((t) => {
    if (t.releaseYear === undefined) return true; // pass through missing metadata
    return t.releaseYear >= yearStart && t.releaseYear <= yearEnd;
  });
}

/**
 * Search iTunes by a term and filter by release year range.
 * Tracks with no releaseDate are passed through.
 */
export async function searchByTermInRange(
  term: string,
  limit: number,
  yearStart: number,
  yearEnd: number,
): Promise<SpotifyTrack[]> {
  const tracks = await searchByTerm(term, limit);
  return tracks.filter((t) => {
    if (t.releaseYear === undefined) return true;
    return t.releaseYear >= yearStart && t.releaseYear <= yearEnd;
  });
}
