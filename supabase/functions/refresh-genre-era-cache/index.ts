// ─── refresh-genre-era-cache ──────────────────────────────────────────────────
// Supabase Edge Function: populates genre_era_artists from Last.fm's
// tag.getTopArtists API. Run once for initial population, then weekly via cron.
//
// Schedule (pg_cron — run in Supabase SQL editor):
//   SELECT cron.schedule(
//     'refresh-genre-era-cache',
//     '0 3 * * 0',   -- Every Sunday at 3 AM UTC
//     $$SELECT net.http_post(
//         url := 'https://YOUR_PROJECT.supabase.co/functions/v1/refresh-genre-era-cache',
//         headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
//         body := '{}'::jsonb
//     )$$
//   );
//
// Secrets required (set in Supabase Dashboard → Edge Functions → Secrets):
//   LASTFM_API_KEY   — free key from https://www.last.fm/api/account/create
//   SUPABASE_URL     — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const LASTFM_API_KEY = Deno.env.get('LASTFM_API_KEY') ?? '';
const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// ─── Genre × Era → Last.fm compound tag mapping ───────────────────────────────
// Strategy A (preferred): use decade-specific compound tags like "90s pop".
// These are user-applied tags on Last.fm and return era-authentic artists.
// Strategy B (fallback): base genre tag when compound tags return < 20 artists.

const GENRE_ERA_TAGS: Record<string, Partial<Record<string, string[]>>> = {
  rock: {
    '50s': ['50s rock', 'rockabilly', 'rock and roll'],
    '60s': ['60s rock', 'british invasion', 'psychedelic rock'],
    '70s': ['70s rock', 'classic rock', 'hard rock'],
    '80s': ['80s rock', 'arena rock', 'hair metal'],
    '90s': ['90s rock', 'grunge', 'alternative rock'],
    '00s': ['00s rock', 'indie rock', 'post-punk revival'],
    '10s': ['10s rock', 'indie rock', 'modern rock'],
    '20s': ['rock'],
  },
  pop: {
    '50s': ['50s pop', 'crooners'],
    '60s': ['60s pop', 'motown', 'sunshine pop'],
    '70s': ['70s pop', 'disco'],
    '80s': ['80s pop', 'synth-pop'],
    '90s': ['90s pop', 'teen pop'],
    '00s': ['00s pop', 'pop'],
    '10s': ['10s pop', 'pop'],
    '20s': ['pop'],
  },
  'hip-hop': {
    '80s': ['80s hip hop', 'old school hip hop'],
    '90s': ['90s hip hop', 'golden age hip hop'],
    '00s': ['00s hip hop', 'hip-hop'],
    '10s': ['10s hip hop', 'trap'],
    '20s': ['hip-hop', 'trap'],
  },
  'r&b': {
    '50s': ['50s soul', 'doo wop'],
    '60s': ['60s soul', 'motown soul'],
    '70s': ['70s soul', 'funk'],
    '80s': ['80s r&b', 'quiet storm'],
    '90s': ['90s r&b', 'neo soul'],
    '00s': ['00s r&b', 'r&b'],
    '10s': ['alternative r&b', 'r&b'],
    '20s': ['r&b', 'neo soul'],
  },
  electronic: {
    '70s': ['70s electronic', 'krautrock', 'ambient'],
    '80s': ['80s electronic', 'new wave', 'synthpop'],
    '90s': ['90s electronic', 'rave', 'big beat'],
    '00s': ['00s electronic', 'electronica'],
    '10s': ['edm', 'future bass', 'electronic'],
    '20s': ['electronic', 'house'],
  },
  country: {
    '50s': ['50s country', 'classic country'],
    '60s': ['60s country', 'honky tonk'],
    '70s': ['70s country', 'outlaw country'],
    '80s': ['80s country'],
    '90s': ['90s country', 'country pop'],
    '00s': ['00s country', 'country'],
    '10s': ['10s country', 'country'],
    '20s': ['country', 'americana'],
  },
  jazz: {
    '50s': ['50s jazz', 'cool jazz', 'bebop'],
    '60s': ['60s jazz', 'hard bop'],
    '70s': ['70s jazz', 'jazz fusion'],
    '80s': ['80s jazz', 'smooth jazz'],
    '90s': ['90s jazz', 'acid jazz'],
    '00s': ['00s jazz', 'nu jazz'],
    '10s': ['contemporary jazz', 'jazz'],
    '20s': ['jazz', 'contemporary jazz'],
  },
  folk: {
    '50s': ['50s folk', 'folk revival'],
    '60s': ['60s folk', 'protest folk'],
    '70s': ['70s folk', 'singer-songwriter'],
    '80s': ['80s folk', 'folk pop'],
    '90s': ['90s folk', 'alternative folk'],
    '00s': ['indie folk', 'freak folk'],
    '10s': ['indie folk', 'folk pop'],
    '20s': ['folk', 'indie folk'],
  },
  latin: {
    '60s': ['60s latin', 'salsa', 'latin jazz'],
    '70s': ['70s latin', 'salsa'],
    '80s': ['80s latin', 'latin pop'],
    '90s': ['90s latin', 'latin pop'],
    '00s': ['reggaeton', 'latin pop'],
    '10s': ['latin trap', 'reggaeton'],
    '20s': ['reggaeton', 'latin'],
  },
  punk: {
    '70s': ['70s punk', 'punk rock'],
    '80s': ['80s punk', 'hardcore punk'],
    '90s': ['90s punk', 'pop punk'],
    '00s': ['00s punk', 'pop punk', 'emo'],
    '10s': ['10s punk', 'post-punk'],
    '20s': ['punk', 'post-punk'],
  },
  metal: {
    '70s': ['70s metal', 'heavy metal'],
    '80s': ['80s metal', 'thrash metal'],
    '90s': ['90s metal', 'alternative metal'],
    '00s': ['00s metal', 'metalcore', 'nu metal'],
    '10s': ['10s metal', 'progressive metal'],
    '20s': ['metal', 'heavy metal'],
  },
};

// ─── Last.fm fetch helpers ────────────────────────────────────────────────────

async function fetchTopArtists(
  tag: string,
  page = 1,
): Promise<Array<{ name: string; listeners: number }>> {
  const url =
    `${LASTFM_BASE}?method=tag.gettopartists` +
    `&tag=${encodeURIComponent(tag)}` +
    `&api_key=${LASTFM_API_KEY}` +
    `&format=json&limit=50&page=${page}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[refresh] Last.fm HTTP ${res.status} tag="${tag}" page=${page}`);
      return [];
    }
    const data = await res.json();
    const artists = data?.topartists?.artist ?? [];
    return artists.map((a: { name: string; listeners?: string }) => ({
      name: a.name,
      listeners: parseInt(a.listeners ?? '0', 10),
    }));
  } catch (err) {
    console.warn(`[refresh] Last.fm fetch error tag="${tag}":`, err);
    return [];
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Core refresh for one genre × era ────────────────────────────────────────

async function refreshGenreEra(genre: string, era: string): Promise<void> {
  const tags = GENRE_ERA_TAGS[genre]?.[era];
  if (!tags?.length) {
    console.log(`[refresh] No tags configured for ${genre}/${era} — skipping`);
    return;
  }

  const artistMap = new Map<string, { name: string; listeners: number }>();

  for (const tag of tags) {
    // Fetch pages 1–3 per tag (up to 150 artists per tag, ~450 total)
    for (let page = 1; page <= 3; page++) {
      const artists = await fetchTopArtists(tag, page);
      for (const a of artists) {
        const key = a.name.toLowerCase();
        const existing = artistMap.get(key);
        if (!existing || a.listeners > existing.listeners) {
          artistMap.set(key, a);
        }
      }
      // Last.fm rate limit: max 5 req/sec — 220ms gives comfortable margin
      await sleep(220);
    }
  }

  if (artistMap.size === 0) {
    console.warn(`[refresh] No artists found for ${genre}/${era}`);
    return;
  }

  // Sort by listeners descending, assign rank
  const sorted = [...artistMap.values()].sort((a, b) => b.listeners - a.listeners);

  const rows = sorted.map((a, i) => ({
    genre,
    era,
    artist_name: a.name,
    lastfm_listeners: a.listeners,
    rank: i + 1,
    updated_at: new Date().toISOString(),
  }));

  // Batch upsert in chunks of 200
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('genre_era_artists')
      .upsert(chunk, { onConflict: 'genre,era,artist_name' });
    if (error) {
      console.error(`[refresh] Upsert error ${genre}/${era}:`, error.message);
    }
  }

  // Update cache metadata
  await supabase
    .from('lastfm_cache_metadata')
    .upsert(
      { genre, era, last_refreshed: new Date().toISOString(), artist_count: rows.length },
      { onConflict: 'genre,era' },
    );

  console.log(`[refresh] ${genre}/${era}: ${rows.length} artists cached`);
}

// ─── Seed search terms ────────────────────────────────────────────────────────
// Runs once; inserts era search terms from the genre config into Supabase.

async function seedSearchTerms(): Promise<void> {
  // Inline terms here rather than importing from app code (Deno edge function)
  const TERMS: Array<{ genre: string; era: string; term: string }> = [
    { genre: 'rock', era: '50s', term: '50s rock and roll' },
    { genre: 'rock', era: '50s', term: 'rockabilly' },
    { genre: 'rock', era: '60s', term: '60s rock' },
    { genre: 'rock', era: '60s', term: 'british invasion rock' },
    { genre: 'rock', era: '70s', term: '70s rock' },
    { genre: 'rock', era: '70s', term: 'classic rock 70s' },
    { genre: 'rock', era: '80s', term: '80s rock' },
    { genre: 'rock', era: '80s', term: 'arena rock 80s' },
    { genre: 'rock', era: '90s', term: '90s rock' },
    { genre: 'rock', era: '90s', term: 'grunge 90s' },
    { genre: 'rock', era: '00s', term: '2000s rock' },
    { genre: 'rock', era: '00s', term: 'indie rock 2000s' },
    { genre: 'rock', era: '10s', term: '2010s rock' },
    { genre: 'rock', era: '10s', term: 'indie rock 2010s' },
    { genre: 'rock', era: '20s', term: '2020s rock' },
    { genre: 'pop', era: '50s', term: '50s pop' },
    { genre: 'pop', era: '60s', term: '60s pop' },
    { genre: 'pop', era: '60s', term: 'Motown 1960s' },
    { genre: 'pop', era: '70s', term: '70s pop' },
    { genre: 'pop', era: '70s', term: 'disco pop 70s' },
    { genre: 'pop', era: '80s', term: '80s pop' },
    { genre: 'pop', era: '80s', term: 'synth pop 80s' },
    { genre: 'pop', era: '90s', term: '90s pop' },
    { genre: 'pop', era: '90s', term: 'pop hits 1990s' },
    { genre: 'pop', era: '00s', term: '2000s pop' },
    { genre: 'pop', era: '10s', term: '2010s pop' },
    { genre: 'pop', era: '20s', term: '2020s pop' },
    { genre: 'hip-hop', era: '80s', term: '80s hip hop' },
    { genre: 'hip-hop', era: '90s', term: '90s hip hop' },
    { genre: 'hip-hop', era: '00s', term: '2000s hip hop' },
    { genre: 'hip-hop', era: '10s', term: 'trap music 2010s' },
    { genre: 'hip-hop', era: '20s', term: '2020s hip hop' },
    { genre: 'r&b', era: '50s', term: '50s soul' },
    { genre: 'r&b', era: '60s', term: '60s soul' },
    { genre: 'r&b', era: '70s', term: '70s soul' },
    { genre: 'r&b', era: '80s', term: '80s r&b' },
    { genre: 'r&b', era: '90s', term: '90s r&b' },
    { genre: 'r&b', era: '00s', term: '2000s r&b' },
    { genre: 'r&b', era: '10s', term: 'alternative r&b 2010s' },
    { genre: 'r&b', era: '20s', term: '2020s r&b' },
    { genre: 'electronic', era: '70s', term: '70s electronic' },
    { genre: 'electronic', era: '80s', term: '80s electronic' },
    { genre: 'electronic', era: '90s', term: '90s electronic' },
    { genre: 'electronic', era: '00s', term: '2000s electronic' },
    { genre: 'electronic', era: '10s', term: '2010s electronic' },
    { genre: 'electronic', era: '20s', term: '2020s electronic' },
    { genre: 'country', era: '50s', term: '50s country' },
    { genre: 'country', era: '60s', term: '60s country' },
    { genre: 'country', era: '70s', term: 'outlaw country' },
    { genre: 'country', era: '80s', term: '80s country' },
    { genre: 'country', era: '90s', term: '90s country' },
    { genre: 'country', era: '00s', term: '2000s country' },
    { genre: 'country', era: '10s', term: '2010s country' },
    { genre: 'country', era: '20s', term: '2020s country' },
    { genre: 'jazz', era: '50s', term: '50s jazz' },
    { genre: 'jazz', era: '60s', term: '60s jazz' },
    { genre: 'jazz', era: '70s', term: 'jazz fusion 70s' },
    { genre: 'jazz', era: '80s', term: 'smooth jazz 80s' },
    { genre: 'jazz', era: '90s', term: '90s jazz' },
    { genre: 'jazz', era: '00s', term: 'nu jazz' },
    { genre: 'jazz', era: '10s', term: 'contemporary jazz 2010s' },
    { genre: 'jazz', era: '20s', term: 'contemporary jazz 2020s' },
    { genre: 'folk', era: '50s', term: '50s folk' },
    { genre: 'folk', era: '60s', term: '60s folk' },
    { genre: 'folk', era: '70s', term: 'singer songwriter 70s' },
    { genre: 'folk', era: '80s', term: '80s folk' },
    { genre: 'folk', era: '90s', term: '90s folk' },
    { genre: 'folk', era: '00s', term: 'indie folk 2000s' },
    { genre: 'folk', era: '10s', term: 'indie folk 2010s' },
    { genre: 'folk', era: '20s', term: 'indie folk 2020s' },
    { genre: 'latin', era: '60s', term: '60s Latin' },
    { genre: 'latin', era: '70s', term: 'salsa 70s' },
    { genre: 'latin', era: '80s', term: 'Latin pop 80s' },
    { genre: 'latin', era: '90s', term: '90s Latin' },
    { genre: 'latin', era: '00s', term: 'reggaeton 2000s' },
    { genre: 'latin', era: '10s', term: 'reggaeton 2010s' },
    { genre: 'latin', era: '20s', term: 'reggaeton 2020s' },
    { genre: 'punk', era: '70s', term: '70s punk' },
    { genre: 'punk', era: '80s', term: 'hardcore punk 80s' },
    { genre: 'punk', era: '90s', term: 'pop punk 90s' },
    { genre: 'punk', era: '00s', term: 'pop punk 2000s' },
    { genre: 'punk', era: '10s', term: 'punk revival 2010s' },
    { genre: 'punk', era: '20s', term: 'post-punk 2020s' },
    { genre: 'metal', era: '70s', term: 'heavy metal 70s' },
    { genre: 'metal', era: '80s', term: 'thrash metal' },
    { genre: 'metal', era: '90s', term: '90s metal' },
    { genre: 'metal', era: '00s', term: 'metalcore 2000s' },
    { genre: 'metal', era: '10s', term: 'progressive metal 2010s' },
    { genre: 'metal', era: '20s', term: 'metal 2020s' },
  ];

  const { error } = await supabase
    .from('genre_era_search_terms')
    .upsert(TERMS, { onConflict: 'genre,era,term' });

  if (error) {
    console.warn('[refresh] Search terms seed error:', error.message);
  } else {
    console.log(`[refresh] Seeded ${TERMS.length} search terms`);
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Optional: read a `force` flag to re-refresh even if recently updated
  const body = await req.json().catch(() => ({})) as { force?: boolean; genre?: string; era?: string };

  console.log('[refresh] Starting genre × era cache refresh…');

  // Seed search terms (idempotent upsert)
  await seedSearchTerms();

  // Determine which combos to refresh
  const combos: Array<{ genre: string; era: string }> = [];

  if (body.genre && body.era) {
    // Single combo mode (for testing)
    combos.push({ genre: body.genre, era: body.era });
  } else {
    // Full refresh: all configured combos
    for (const [genre, eras] of Object.entries(GENRE_ERA_TAGS)) {
      for (const era of Object.keys(eras)) {
        if (!body.force) {
          // Skip if refreshed within last 6 days
          const { data } = await supabase
            .from('lastfm_cache_metadata')
            .select('last_refreshed')
            .eq('genre', genre)
            .eq('era', era)
            .single();
          if (data?.last_refreshed) {
            const age = Date.now() - new Date(data.last_refreshed as string).getTime();
            if (age < 6 * 24 * 60 * 60 * 1000) {
              console.log(`[refresh] ${genre}/${era}: fresh, skipping`);
              continue;
            }
          }
        }
        combos.push({ genre, era });
      }
    }
  }

  console.log(`[refresh] Refreshing ${combos.length} combos…`);

  for (const { genre, era } of combos) {
    await refreshGenreEra(genre, era);
  }

  console.log('[refresh] Done.');
  return new Response(
    JSON.stringify({ status: 'ok', refreshed: combos.length }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
