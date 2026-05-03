-- ─── Mission activity track cache ────────────────────────────────────────────
-- Crowd-sourced track curation via Last.fm activity tags.
-- The refresh-mission-playlists Edge Function calls tag.getTopTracks for tags
-- like "running", "workout", "cardio" and accumulates a tag_count for each
-- track — the same crowd-curation signal as playlist_count, without Spotify.
--
-- Populated weekly by: supabase/functions/refresh-mission-playlists
-- Read by: src/services/missionDiscovery.ts → src/hooks/useMission.ts

-- ─── mission_playlist_tracks ─────────────────────────────────────────────────
-- One row per unique track per mission type.
-- tag_count  = how many distinct activity tags reference this track (quality signal).
-- listeners  = Last.fm listener count (popularity proxy).

CREATE TABLE mission_playlist_tracks (
  id            UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  mission_type  TEXT         NOT NULL,  -- 'running', 'gym', 'study', 'roadtrip', 'party', 'chill'
  track_name    TEXT         NOT NULL,
  artist_name   TEXT         NOT NULL,
  lastfm_url    TEXT,                   -- Last.fm track page (for dedup key, not playback)
  tag_count     INTEGER      DEFAULT 0, -- how many activity tags reference this track
  listeners     INTEGER      DEFAULT 0, -- Last.fm listener count
  updated_at    TIMESTAMPTZ  DEFAULT NOW(),

  UNIQUE(mission_type, track_name, artist_name)
);

-- Fast lookup by mission type, ordered by tag signal then listener count
CREATE INDEX idx_mission_playlist_type
  ON mission_playlist_tracks(mission_type);
CREATE INDEX idx_mission_playlist_type_ranked
  ON mission_playlist_tracks(mission_type, tag_count DESC, listeners DESC);

ALTER TABLE mission_playlist_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON mission_playlist_tracks FOR SELECT USING (true);

-- ─── mission_cache_metadata ───────────────────────────────────────────────────

CREATE TABLE mission_cache_metadata (
  mission_type   TEXT        PRIMARY KEY,
  last_refreshed TIMESTAMPTZ DEFAULT NOW(),
  track_count    INTEGER,
  tags_queried   INTEGER     -- how many tag×page combinations were fetched
);

ALTER TABLE mission_cache_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON mission_cache_metadata FOR SELECT USING (true);
