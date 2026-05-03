// ─── resolve-festival-itunes ──────────────────────────────────────────────────
// Supabase Edge Function: resolves iTunes preview URLs for tracks already stored
// in festival_artist_tracks. Processes in batches with a time budget so it never
// times out. Run repeatedly until all tracks are resolved.
//
// Run AFTER populate-festival-tracks has cached the Last.fm track catalogs.
//
// Usage:
//   curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/resolve-festival-itunes
//
// Optional query params:
//   ?limit=10        — max artists to process per invocation (default 10)
//   ?max_tracks=20   — max tracks to resolve per artist (default 20, max 50)
//
// Schedule (pg_cron — run after populate-festival-tracks):
//   SELECT cron.schedule(
//     'resolve-festival-itunes',
//     '*/5 4-5 * * 0',  -- Every 5 min between 4-5 AM UTC on Sundays
//     $$SELECT net.http_post(
//         url := 'https://YOUR_PROJECT.supabase.co/functions/v1/resolve-festival-itunes',
//         headers := '{}'::jsonb,
//         body := '{}'::jsonb
//     )$$
//   );

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// iTunes rate limiting — conservative for server-side
const ITUNES_DELAY_MS = 1500; // 2 req/sec (slower than app, we're not in a hurry)
const MAX_EXECUTION_MS = 45_000; // Stop after 45s to stay under Edge Function timeout

interface iTunesResult {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName: string;
  previewUrl: string;
  artworkUrl100: string;
  releaseDate: string;
}

async function searchItunes(
  query: string,
  attribute: string,
  limit: number = 3
): Promise<iTunesResult[]> {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&attribute=${attribute}&limit=${limit}`;
    const response = await fetch(url);

    if (response.status === 403 || response.status === 429) {
      console.warn(`[resolve-itunes] iTunes rate limited (${response.status})`);
      // Wait extra on rate limit
      await new Promise((r) => setTimeout(r, 3000));
      return [];
    }

    if (!response.ok) {
      console.warn(`[resolve-itunes] iTunes error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return (data.results || []) as iTunesResult[];
  } catch (err) {
    console.error(`[resolve-itunes] fetch failed:`, err);
    return [];
  }
}

function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

function findBestMatch(
  results: iTunesResult[],
  artistName: string,
  trackName: string
): iTunesResult | null {
  const normArtist = normalizeForMatch(artistName);
  const normTrack = normalizeForMatch(trackName);

  // Priority 1: exact artist + track match
  for (const r of results) {
    if (
      normalizeForMatch(r.artistName).includes(normArtist) &&
      normalizeForMatch(r.trackName).includes(normTrack)
    ) {
      return r;
    }
  }

  // Priority 2: artist match only (track name might differ slightly)
  for (const r of results) {
    if (normalizeForMatch(r.artistName).includes(normArtist)) {
      return r;
    }
  }

  return null;
}

Deno.serve(async (req) => {
  const startTime = Date.now();

  try {
    const url = new URL(req.url);
    const artistLimit = parseInt(url.searchParams.get("limit") || "10");
    const maxTracksPerArtist = Math.min(
      parseInt(url.searchParams.get("max_tracks") || "20"),
      50
    );

    // ── 1. Find artists with unresolved tracks ──
    // Get distinct artists that have at least one track without iTunes data
    const { data: unresolvedArtists, error: queryError } = await supabase
      .from("festival_artist_tracks")
      .select("artist_name")
      .is("itunes_resolved_at", null)
      .order("artist_name")
      .limit(1000);

    if (queryError) {
      console.error("[resolve-itunes] Query error:", queryError);
      return new Response(JSON.stringify({ error: queryError.message }), {
        status: 500,
      });
    }

    // Dedupe to unique artist names
    const uniqueArtists = [
      ...new Set((unresolvedArtists || []).map((r: any) => r.artist_name)),
    ].slice(0, artistLimit);

    if (uniqueArtists.length === 0) {
      console.log("[resolve-itunes] All tracks already resolved!");
      return new Response(
        JSON.stringify({ message: "All tracks resolved", processed: 0 }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(
      `[resolve-itunes] Processing ${uniqueArtists.length} artists (limit=${artistLimit})`
    );

    // ── 2. Process each artist ──
    let totalResolved = 0;
    let totalFailed = 0;
    let artistsProcessed = 0;

    for (const artistName of uniqueArtists) {
      // Time budget check
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        console.log(
          `[resolve-itunes] Time budget hit after ${artistsProcessed} artists`
        );
        break;
      }

      // Get unresolved tracks for this artist (limited to top N by rank)
      const { data: tracks } = await supabase
        .from("festival_artist_tracks")
        .select("id, artist_name, track_name, track_rank")
        .eq("artist_name", artistName)
        .is("itunes_resolved_at", null)
        .order("track_rank", { ascending: true })
        .limit(maxTracksPerArtist);

      if (!tracks || tracks.length === 0) continue;

      console.log(
        `[resolve-itunes] ${artistName}: resolving ${tracks.length} tracks`
      );

      for (const track of tracks) {
        // Time budget check
        if (Date.now() - startTime > MAX_EXECUTION_MS) break;

        // Search iTunes by song name + artist (precise match)
        const results = await searchItunes(
          `${track.track_name} ${track.artist_name}`,
          "songTerm",
          5
        );

        const match = findBestMatch(results, track.artist_name, track.track_name);

        if (match && match.previewUrl) {
          // ✓ Resolved — store iTunes data
          const { error: updateError } = await supabase
            .from("festival_artist_tracks")
            .update({
              itunes_track_id: match.trackId,
              itunes_preview_url: match.previewUrl,
              itunes_artwork_url: match.artworkUrl100
                ? match.artworkUrl100.replace("100x100", "600x600")
                : null,
              itunes_artist_name: match.artistName,
              itunes_collection_name: match.collectionName,
              itunes_release_date: match.releaseDate,
              itunes_resolved_at: new Date().toISOString(),
            })
            .eq("id", track.id);

          if (updateError) {
            console.error(
              `[resolve-itunes]   ✗ Update failed for "${track.track_name}":`,
              updateError
            );
            totalFailed++;
          } else {
            totalResolved++;
          }
        } else {
          // ✗ No match — mark as resolved anyway so we don't retry forever
          await supabase
            .from("festival_artist_tracks")
            .update({
              itunes_resolved_at: new Date().toISOString(),
              // preview_url stays NULL — app will skip this track
            })
            .eq("id", track.id);

          totalFailed++;
        }

        await new Promise((r) => setTimeout(r, ITUNES_DELAY_MS));
      }

      artistsProcessed++;
      console.log(
        `[resolve-itunes] ✓ ${artistName} done (${totalResolved} resolved so far)`
      );
    }

    // ── 3. Check how many remain ──
    const { count: remaining } = await supabase
      .from("festival_artist_tracks")
      .select("id", { count: "exact", head: true })
      .is("itunes_resolved_at", null);

    const summary = {
      artistsProcessed,
      tracksResolved: totalResolved,
      tracksFailed: totalFailed,
      remainingUnresolved: remaining || 0,
      executionTimeMs: Date.now() - startTime,
      done: (remaining || 0) === 0,
    };

    console.log("[resolve-itunes] Summary:", summary);

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[resolve-itunes] Unhandled error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});