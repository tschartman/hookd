import { getCachedArtist, setCachedArtist } from '../stores/artistCacheStore';
import { hasQueuedRequests, processArtistViewResults } from './itunes';
import type { ItunesTrack } from './itunes';

// ─── Artist track prefetcher ───────────────────────────────────────────────────
// Prefetches artist tracks in the background while the user is listening so that
// tapping an artist name results in an instant cache HIT instead of a loading state.
//
// CRITICAL: prefetches bypass the global iTunes rate-limiter queue in itunes.ts
// so they never eat the active feed's rate budget. Instead they use a direct
// fetch() and silently discard the result on any non-200 response (including 403).
// The artist view falls back to a normal queued fetch on a cache miss.

const ITUNES_BASE = 'https://itunes.apple.com';

let _activePrefetch: AbortController | null = null;

/**
 * Fetch + process + cache tracks for an artist, bypassing the global rate limiter.
 * Fire-and-forget. Silently discards errors (403, network failure, abort).
 */
export async function prefetchArtistTracks(
  artistName: string,
  artistId: string,
): Promise<void> {
  // Already cached? Nothing to do.
  if (getCachedArtist(artistName)) return;

  // Cancel any previous prefetch — only one at a time, low priority.
  if (_activePrefetch) {
    _activePrefetch.abort();
  }
  _activePrefetch = new AbortController();
  const { signal } = _activePrefetch;

  try {
    const params = new URLSearchParams({
      term: artistName,
      media: 'music',
      entity: 'song',
      attribute: 'artistTerm',
      limit: '50',
    });
    const url = `${ITUNES_BASE}/search?${params.toString()}`;

    const res = await fetch(url, { signal });

    // Non-200 (including 403) → silently discard. The artist view will fetch
    // on demand through the normal rate limiter if the user actually taps.
    if (!res.ok) {
      console.log(`[prefetch] ${artistName}: skipped (status=${res.status})`);
      return;
    }

    if (signal.aborted) return;

    const data = await res.json() as { resultCount: number; results: ItunesTrack[] };
    const tracks = processArtistViewResults(data.results, artistName);

    if (signal.aborted) return;

    setCachedArtist({ artistName, artistId, tracks, fetchedAt: Date.now() });
    console.log(`[prefetch] Cached ${artistName}: ${tracks.length} tracks`);
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') return; // expected on card change
    console.log(`[prefetch] Failed for ${artistName}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Prefetch only when the global iTunes rate limiter is idle — avoids competing
 * with the active feed for Apple's rate budget.
 *
 * - Skips entirely if the queue has pending requests at call time.
 * - Waits 500 ms then re-checks before firing to let any in-flight request
 *   complete and give the feed a chance to queue the next batch first.
 */
export function prefetchIfIdle(artistName: string, artistId: string): void {
  // Already cached — nothing to do.
  if (getCachedArtist(artistName)) return;

  // Don't compete with an active feed.
  if (hasQueuedRequests()) return;

  // Delay slightly so card-change event settling happens first.
  setTimeout(() => {
    // Re-check after delay — feed may have queued new requests.
    if (hasQueuedRequests()) return;
    void prefetchArtistTracks(artistName, artistId);
  }, 500);
}
