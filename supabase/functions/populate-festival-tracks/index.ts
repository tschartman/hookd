// ─── populate-festival-tracks ─────────────────────────────────────────────────
// Supabase Edge Function: populates festival_artist_tracks from Last.fm's
// artist.getTopTracks API for every artist in the festival_artists table.
// Run once for initial population, then weekly via cron.
//
// Schedule (pg_cron — run in Supabase SQL editor):
//   SELECT cron.schedule(
//     'populate-festival-tracks',
//     '0 4 * * 0',   -- Every Sunday at 4 AM UTC (1 hour after genre-era refresh)
//     $$SELECT net.http_post(
//         url := 'https://YOUR_PROJECT.supabase.co/functions/v1/populate-festival-tracks',
//         headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
//         body := '{}'::jsonb
//     )$$
//   );
//
// Secrets required (set in Supabase Dashboard → Edge Functions → Secrets):
//   LASTFM_API_KEY            — free key from https://www.last.fm/api/account/create
//   SUPABASE_URL              — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LASTFM_API_KEY = Deno.env.get("LASTFM_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const LASTFM_DELAY_MS = 220; // 5 req/sec rate limit
const STALE_DAYS = 7;
const TOP_TRACKS_LIMIT = 50;

async function fetchTopTracks(artistName: string): Promise<any[] | null> {
  try {
    const url = `http://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist=${encodeURIComponent(artistName)}&api_key=${LASTFM_API_KEY}&format=json&limit=${TOP_TRACKS_LIMIT}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`[populate-festival-tracks] Last.fm API error for "${artistName}": ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.error) {
      console.warn(`[populate-festival-tracks] Last.fm error for "${artistName}": ${data.message}`);
      return null;
    }

    if (!data.toptracks?.track?.length) {
      console.warn(`[populate-festival-tracks] No tracks found for "${artistName}"`);
      return null;
    }

    return data.toptracks.track;
  } catch (err) {
    console.error(`[populate-festival-tracks] fetch failed for "${artistName}":`, err);
    return null;
  }
}

Deno.serve(async (_req) => {
  try {
    // 1. Get all distinct artist names from festival_artists (column is "name")
    const { data: artistRows, error: artistError } = await supabase
      .from("festival_artists")
      .select("name");

    if (artistError) {
      console.error("[populate-festival-tracks] Failed to fetch festival artists:", artistError);
      return new Response(JSON.stringify({ error: artistError.message }), { status: 500 });
    }

    const allArtists = [...new Set(artistRows.map((a: any) => a.name))];
    console.log(`[populate-festival-tracks] Found ${allArtists.length} unique festival artists`);

    // 2. Check which artists already have fresh data
    // festival_artist_tracks uses "artist_name" column
    const staleThreshold = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: freshRows } = await supabase
      .from("festival_artist_tracks")
      .select("artist_name, updated_at")
      .gt("updated_at", staleThreshold);

    const freshArtists = new Set((freshRows || []).map((r: any) => r.artist_name));

    const staleArtists = allArtists.filter((a) => !freshArtists.has(a));
    console.log(
      `[populate-festival-tracks] ${freshArtists.size} fresh, ${staleArtists.length} need refresh`
    );

    // 3. Fetch and upsert tracks for each stale artist
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const artistName of staleArtists) {
      const rawTracks = await fetchTopTracks(artistName);

      if (!rawTracks) {
        skipCount++;
        await new Promise((r) => setTimeout(r, LASTFM_DELAY_MS));
        continue;
      }

      // Map and dedupe — Last.fm can return duplicate track names (remixes, versions)
      const seen = new Set<string>();
      const tracks = rawTracks
        .map((t: any, i: number) => ({
          artist_name: artistName,
          track_name: t.name,
          album_name: t.album?.title || null,
          lastfm_listeners: parseInt(t.listeners) || 0,
          lastfm_playcount: parseInt(t.playcount) || 0,
          track_rank: i + 1,
          updated_at: new Date().toISOString(),
        }))
        .filter((t: any) => {
          const key = `${t.artist_name}::${t.track_name}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

      const { error: upsertError } = await supabase
        .from("festival_artist_tracks")
        .upsert(tracks, { onConflict: "artist_name,track_name" });

      if (upsertError) {
        console.error(
          `[populate-festival-tracks] upsert failed for "${artistName}":`,
          upsertError
        );
        errorCount++;
      } else {
        console.log(
          `[populate-festival-tracks] ✓ ${artistName}: ${tracks.length} tracks`
        );
        successCount++;
      }

      await new Promise((r) => setTimeout(r, LASTFM_DELAY_MS));
    }

    const summary = {
      total: allArtists.length,
      alreadyFresh: freshArtists.size,
      refreshed: successCount,
      skipped: skipCount,
      errors: errorCount,
    };

    console.log("[populate-festival-tracks] Done:", summary);

    return new Response(JSON.stringify(summary), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[populate-festival-tracks] Unhandled error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});