// supabase/functions/refresh-mission-playlists/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const LASTFM_API_KEY = Deno.env.get('LASTFM_API_KEY')!;
const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ONLY mainstream genre tags that have rich, high-quality data on Last.fm
// NO niche/activity tags (running, workout, cardio, pump up, etc.)
const MISSION_GENRE_TAGS: Record<string, string[]> = {
  running: [
    'pop',
    'electronic',
    'dance',
    'edm',
    'house',
    'hip-hop',
    'dance-pop',
    'electropop',
    'disco',
    'drum and bass',
  ],
  gym: [
    'hip-hop',
    'rap',
    'trap',
    'electronic',
    'edm',
    'metal',
    'hard rock',
    'dubstep',
    'grime',
    'rock',
  ],
  study: [
    'ambient',
    'lo-fi',
    'chillout',
    'downtempo',
    'jazz',
    'instrumental',
    'post-rock',
    'neo-classical',
    'trip-hop',
    'new age',
  ],
  roadtrip: [
    'rock',
    'pop',
    'classic rock',
    'indie',
    'indie rock',
    'folk rock',
    'pop rock',
    'americana',
    'alternative',
    'new wave',
  ],
  party: [
    'dance',
    'pop',
    'hip-hop',
    'edm',
    'house',
    'electronic',
    'disco',
    'funk',
    'reggaeton',
    'r&b',
  ],
  chill: [
    'chillout',
    'ambient',
    'lo-fi',
    'soul',
    'neo-soul',
    'r&b',
    'trip-hop',
    'downtempo',
    'jazz',
    'indie folk',
  ],
  morning: [
    'folk',
    'acoustic',
    'jazz',
    'singer-songwriter',
    'indie folk',
    'bossa nova',
    'soft rock',
    'ambient',
    'country',
    'neo-soul',
  ],
};

interface LastfmTrack {
  name: string;
  artist: { name: string };
  url: string;
  '@attr'?: { rank: string };
  duration?: string;
  listeners?: string;
}

// Normalize track names to catch duplicates like:
// "Levitating", "Levitating (feat. DaBaby)", "Levitating - Remix" → "levitating"
function normalizeTrackName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\(feat\.?[^)]*\)/gi, '')
    .replace(/\s*\(ft\.?[^)]*\)/gi, '')
    .replace(/\s*\(with[^)]*\)/gi, '')
    .replace(/\s*\(remix\)/gi, '')
    .replace(/\s*\(deluxe[^)]*\)/gi, '')
    .replace(/\s*\(live[^)]*\)/gi, '')
    .replace(/\s*\(remaster[^)]*\)/gi, '')
    .replace(/\s*\(acoustic[^)]*\)/gi, '')
    .replace(/\s*\(radio[^)]*\)/gi, '')
    .replace(/\s*\(original[^)]*\)/gi, '')
    .replace(/\s*[-–—]\s*(remix|remaster|live|acoustic|radio edit|deluxe|feat\.?|ft\.?).*$/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

function normalizeArtist(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

async function fetchTopTracks(tag: string, page: number = 1): Promise<LastfmTrack[]> {
  const url = `${LASTFM_BASE}?method=tag.gettoptracks&tag=${encodeURIComponent(tag)}&api_key=${LASTFM_API_KEY}&format=json&limit=100&page=${page}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[lastfm] tag.getTopTracks failed for "${tag}" page ${page}: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data?.tracks?.track || [];
  } catch (e) {
    console.warn(`[lastfm] Error fetching tag "${tag}":`, e);
    return [];
  }
}

async function fetchTrackInfo(trackName: string, artistName: string): Promise<{ listeners: number } | null> {
  const url = `${LASTFM_BASE}?method=track.getInfo&track=${encodeURIComponent(trackName)}&artist=${encodeURIComponent(artistName)}&api_key=${LASTFM_API_KEY}&format=json`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      listeners: parseInt(data?.track?.listeners || '0', 10),
    };
  } catch {
    return null;
  }
}

interface TrackEntry {
  track_name: string;
  artist_name: string;
  lastfm_url: string;
  tag_count: number;
  listeners: number;
  tags_matched: string[];
}

async function refreshMissionType(missionType: string) {
  const tags = MISSION_GENRE_TAGS[missionType];
  if (!tags) return;

  console.log(`[mission-cache] Starting ${missionType} with ${tags.length} genre tags...`);

  // Key: "normalizedTrack|||normalizedArtist" for robust dedup
  const trackMap = new Map<string, TrackEntry>();

  let tagsQueried = 0;

  for (const tag of tags) {
    // Fetch pages 1-4 per tag (400 tracks per tag)
    for (let page = 1; page <= 4; page++) {
      const tracks = await fetchTopTracks(tag, page);
      tagsQueried++;

      for (const t of tracks) {
        const normTrack = normalizeTrackName(t.name);
        const normArtist = normalizeArtist(t.artist?.name || '');
        const key = `${normTrack}|||${normArtist}`;

        const existing = trackMap.get(key);
        if (existing) {
          // Track appears under multiple genre tags — increase overlap score
          existing.tag_count++;
          existing.tags_matched.push(tag);
          // Keep highest listener count across entries
          const listeners = parseInt(t.listeners || '0', 10);
          if (listeners > existing.listeners) {
            existing.listeners = listeners;
          }
          // Keep the cleanest (shortest) track name version
          if (t.name.length < existing.track_name.length) {
            existing.track_name = t.name;
          }
        } else {
          trackMap.set(key, {
            track_name: t.name,
            artist_name: t.artist?.name || '',
            lastfm_url: t.url || '',
            tag_count: 1,
            listeners: parseInt(t.listeners || '0', 10),
            tags_matched: [tag],
          });
        }
      }

      // Last.fm rate limit: 5 req/sec max, be safe with 250ms spacing
      await new Promise(r => setTimeout(r, 250));
    }
  }

  // For high-overlap tracks (tag_count >= 3) with no listener data, enrich individually
  // Cap at 50 to avoid hammering the API
  const highOverlap = [...trackMap.values()].filter(t => t.tag_count >= 3 && t.listeners === 0);
  for (const entry of highOverlap.slice(0, 50)) {
    const info = await fetchTrackInfo(entry.track_name, entry.artist_name);
    if (info) {
      entry.listeners = info.listeners;
    }
    await new Promise(r => setTimeout(r, 250));
  }

  // Sort by overlap score (tag_count) first, then listeners
  const sorted = [...trackMap.values()]
    .sort((a, b) => {
      if (b.tag_count !== a.tag_count) return b.tag_count - a.tag_count;
      return b.listeners - a.listeners;
    });

  // Log overlap distribution for quality verification
  console.log(`[mission-cache] ${missionType} stats:`);
  console.log(`  Total unique tracks: ${sorted.length}`);
  console.log(`  Overlap 4+ tags: ${sorted.filter(r => r.tag_count >= 4).length}`);
  console.log(`  Overlap 3 tags: ${sorted.filter(r => r.tag_count === 3).length}`);
  console.log(`  Overlap 2 tags: ${sorted.filter(r => r.tag_count === 2).length}`);
  console.log(`  Single tag only: ${sorted.filter(r => r.tag_count === 1).length}`);

  const rows = sorted.map(t => ({
    mission_type: missionType,
    track_name: t.track_name,
    artist_name: t.artist_name,
    lastfm_url: t.lastfm_url,
    tag_count: t.tag_count,
    listeners: t.listeners,
    updated_at: new Date().toISOString(),
  }));

  // Clear old data and insert fresh
  await supabase
    .from('mission_playlist_tracks')
    .delete()
    .eq('mission_type', missionType);

  if (rows.length > 0) {
    // Batch insert in chunks of 500 (Supabase limit)
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase
        .from('mission_playlist_tracks')
        .insert(chunk);

      if (error) {
        console.error(`[mission-cache] Insert error for ${missionType} chunk ${i}:`, error);
      }
    }
  }

  // Update metadata
  await supabase
    .from('mission_cache_metadata')
    .upsert({
      mission_type: missionType,
      last_refreshed: new Date().toISOString(),
      track_count: rows.length,
      tags_queried: tagsQueried,
    }, { onConflict: 'mission_type' });

  console.log(`[mission-cache] ${missionType}: ${rows.length} tracks from ${tagsQueried} tag queries`);
}

// Main handler
Deno.serve(async (_req: Request) => {
  try {
    for (const missionType of Object.keys(MISSION_GENRE_TAGS)) {
      await refreshMissionType(missionType);
    }

    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[mission-cache] Fatal error:', e);
    return new Response(JSON.stringify({ status: 'error', message: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
