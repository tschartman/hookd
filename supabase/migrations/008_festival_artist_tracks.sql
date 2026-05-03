-- ─── Festival artist track catalog ────────────────────────────────────────────
-- Pre-cached top tracks per festival artist, sourced from Last.fm
-- artist.getTopTracks. Shared across festivals — keyed by artist name, not
-- festival. An artist at both Coachella and Bonnaroo has one set of tracks.
--
-- Populated weekly by: supabase/functions/populate-festival-tracks
-- Read by: app/festival/[slug].tsx (track selection from catalog)
--
-- track_rank: 1 = most played (biggest hit), 50 = deepest cut.
-- Slider at 0 (Popular) favors rank 1–10; slider at 1 (Discovery) favors 10–50.

CREATE TABLE IF NOT EXISTS festival_artist_tracks (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_name         text        NOT NULL,
  track_name          text        NOT NULL,
  album_name          text,
  lastfm_listeners    integer     DEFAULT 0,
  lastfm_playcount    integer     DEFAULT 0,
  track_rank          integer     NOT NULL,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),

  UNIQUE (artist_name, track_name)
);

-- Fast lookup by artist
CREATE INDEX idx_festival_artist_tracks_artist
  ON festival_artist_tracks (artist_name);

-- Sorting by rank within an artist (Popular ↔ Discovery slider)
CREATE INDEX idx_festival_artist_tracks_rank
  ON festival_artist_tracks (artist_name, track_rank);

ALTER TABLE festival_artist_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON festival_artist_tracks FOR SELECT USING (true);
