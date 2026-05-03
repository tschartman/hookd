// ─── seed-festival ───────────────────────────────────────────────────────────
// Supabase Edge Function: creates a festival and auto-tiers its artists using
// Last.fm listener data. Accepts a plain text list of artist names — no poster
// parsing needed.
//
// Usage (curl):
//   curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/seed-festival \
//     -H "Content-Type: application/json" \
//     -d '{
//       "name": "Lollapalooza 2026",
//       "slug": "lollapalooza-2026",
//       "dates": "July 30 - August 2, 2026",
//       "location": "Chicago, IL",
//       "year": 2026,
//       "artists": "Kendrick Lamar, Green Day, Charli XCX, Hozier, Reneé Rapp, Justice, Girl in Red"
//     }'
//
// What it does:
//   1. Creates (or updates) the festival in the `festivals` table
//   2. Looks up each artist on Last.fm for listener count + genre tags
//   3. Auto-tiers: top ~10% by listeners = headliner, next ~25% = midtier, rest = opener
//   4. Inserts all artists into `festival_artists` with tier + genres
//   5. Returns a summary so you can eyeball the tiering
//
// After running this, invoke `populate-festival-tracks` to cache the 50-track
// catalogs for each artist.
//
// Secrets required:
//   LASTFM_API_KEY            — free key from https://www.last.fm/api/account/create
//   SUPABASE_URL              — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LASTFM_API_KEY = Deno.env.get("LASTFM_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const LASTFM_DELAY_MS = 220; // 5 req/sec rate limit

interface ArtistInfo {
  name: string;
  listeners: number;
  genres: string[];
}

async function fetchArtistInfo(artistName: string): Promise<ArtistInfo | null> {
  try {
    const url = `http://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artistName)}&api_key=${LASTFM_API_KEY}&format=json`;
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`[seed-festival] Last.fm API error for "${artistName}": ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.error) {
      console.warn(`[seed-festival] Last.fm error for "${artistName}": ${data.message}`);
      return null;
    }

    const artist = data.artist;
    if (!artist) return null;

    // Extract top genre tags (Last.fm returns them sorted by relevance)
    const genres = (artist.tags?.tag || [])
      .slice(0, 5)
      .map((t: any) => t.name?.toLowerCase())
      .filter(Boolean);

    return {
      name: artist.name || artistName, // Use Last.fm's canonical spelling
      listeners: parseInt(artist.stats?.listeners) || 0,
      genres,
    };
  } catch (err) {
    console.error(`[seed-festival] fetch failed for "${artistName}":`, err);
    return null;
  }
}

function assignTier(
  rank: number,
  totalArtists: number,
  listeners: number
): "headliner" | "midtier" | "opener" {
  const percentile = rank / totalArtists;

  // Rank-based primary classification
  if (percentile <= 0.10) return "headliner";
  if (percentile <= 0.35) return "midtier";

  // Listener-based overrides for popular artists billed low
  if (listeners > 5_000_000) return "headliner";
  if (listeners > 2_000_000) return "midtier";

  return "opener";
}

function parseArtistList(input: string): string[] {
  // Handle newlines, commas, or both as separators
  return input
    .split(/[,\n]+/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST required" }), {
        status: 405,
      });
    }

    const body = await req.json();
    const { name, slug, dates, location, year, artists, description } = body;

    // ── Validate required fields ──
    if (!name || !slug || !artists) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: name, slug, artists",
        }),
        { status: 400 }
      );
    }

    const artistNames = parseArtistList(artists);
    if (artistNames.length === 0) {
      return new Response(
        JSON.stringify({ error: "No artist names parsed from input" }),
        { status: 400 }
      );
    }

    console.log(
      `[seed-festival] Seeding "${name}" with ${artistNames.length} artists`
    );

    // ── 1. Upsert the festival ──
    const { data: festival, error: festivalError } = await supabase
      .from("festivals")
      .upsert(
        {
          name,
          slug,
          dates: dates || null,
          location: location || null,
          description: description || null,
          year: year || new Date().getFullYear(),
          active: true,
        },
        { onConflict: "slug" }
      )
      .select("id")
      .single();

    if (festivalError) {
      console.error("[seed-festival] Failed to upsert festival:", festivalError);
      return new Response(
        JSON.stringify({ error: festivalError.message }),
        { status: 500 }
      );
    }

    const festivalId = festival.id;
    console.log(`[seed-festival] Festival ID: ${festivalId}`);

    // ── 2. Look up each artist on Last.fm ──
    const artistInfos: ArtistInfo[] = [];
    let lookupFailures = 0;

    for (const artistName of artistNames) {
      const info = await fetchArtistInfo(artistName);

      if (info) {
        artistInfos.push(info);
        console.log(
          `[seed-festival]   ✓ ${info.name}: ${info.listeners.toLocaleString()} listeners [${info.genres.slice(0, 3).join(", ")}]`
        );
      } else {
        // Still include the artist even if Last.fm doesn't know them
        artistInfos.push({
          name: artistName,
          listeners: 0,
          genres: [],
        });
        lookupFailures++;
        console.warn(
          `[seed-festival]   ✗ ${artistName}: not found on Last.fm (will be added as opener)`
        );
      }

      await new Promise((r) => setTimeout(r, LASTFM_DELAY_MS));
    }

    // ── 3. Sort by listeners and assign tiers ──
    const sorted = [...artistInfos].sort((a, b) => b.listeners - a.listeners);
    const totalArtists = sorted.length;

    const tieredArtists = sorted.map((artist, index) => ({
      festival_id: festivalId,
      name: artist.name,
      tier: assignTier(index, totalArtists, artist.listeners),
      genres: artist.genres.length > 0 ? artist.genres : null,
    }));

    // ── 4. Clear existing artists for this festival and insert fresh ──
    const { error: deleteError } = await supabase
      .from("festival_artists")
      .delete()
      .eq("festival_id", festivalId);

    if (deleteError) {
      console.error(
        "[seed-festival] Failed to clear existing artists:",
        deleteError
      );
    }

    // Insert in batches of 50 (Supabase limit)
    const BATCH_SIZE = 50;
    let insertedCount = 0;

    for (let i = 0; i < tieredArtists.length; i += BATCH_SIZE) {
      const batch = tieredArtists.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase
        .from("festival_artists")
        .insert(batch);

      if (insertError) {
        console.error(
          `[seed-festival] Insert batch failed at offset ${i}:`,
          insertError
        );
      } else {
        insertedCount += batch.length;
      }
    }

    // ── 5. Build summary ──
    const headliners = tieredArtists.filter((a) => a.tier === "headliner");
    const midtiers = tieredArtists.filter((a) => a.tier === "midtier");
    const openers = tieredArtists.filter((a) => a.tier === "opener");

    const summary = {
      festival: name,
      festivalId,
      totalArtists: tieredArtists.length,
      inserted: insertedCount,
      lookupFailures,
      tiers: {
        headliners: headliners.map((a) => a.name),
        midtier: midtiers.map((a) => a.name),
        openers: openers.map((a) => a.name),
      },
      nextStep:
        "Run populate-festival-tracks to cache track catalogs for these artists",
    };

    console.log("[seed-festival] Done:", JSON.stringify(summary, null, 2));

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[seed-festival] Unhandled error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});