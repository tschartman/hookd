-- ─── Last.fm artist discovery cache ─────────────────────────────────────────
-- Replaces genreEraSeeds.ts hardcoded artist lists.
-- Populated by the refresh-genre-era-cache Edge Function, refreshed weekly.
-- The app reads from these tables at runtime — it never calls Last.fm directly
-- (except getSimilarArtists cache misses).

-- ─── genre_era_artists ───────────────────────────────────────────────────────
-- Top artists per genre × era, ranked by Last.fm listener count.

CREATE TABLE genre_era_artists (
  id            UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  genre         TEXT         NOT NULL,   -- lowercase, e.g. 'pop', 'rock', 'hip-hop'
  era           TEXT         NOT NULL,   -- '60s', '70s', '80s', '90s', '00s', '10s', '20s'
  artist_name   TEXT         NOT NULL,
  lastfm_listeners INTEGER,             -- listener count (popularity signal)
  lastfm_url    TEXT,
  mbid          TEXT,                   -- MusicBrainz ID provided by Last.fm
  rank          INTEGER      NOT NULL,  -- 1 = most popular in this genre×era
  updated_at    TIMESTAMPTZ  DEFAULT NOW(),

  UNIQUE(genre, era, artist_name)
);

CREATE INDEX idx_genre_era            ON genre_era_artists(genre, era);
CREATE INDEX idx_genre_era_rank       ON genre_era_artists(genre, era, rank);

-- Allow anon reads (app reads without auth)
ALTER TABLE genre_era_artists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON genre_era_artists FOR SELECT USING (true);

-- ─── genre_era_search_terms ──────────────────────────────────────────────────
-- iTunes search terms per genre × era for supplementary track discovery.
-- Seeded once from genreConfig.ts; can be extended over time.

CREATE TABLE genre_era_search_terms (
  id     UUID  DEFAULT gen_random_uuid() PRIMARY KEY,
  genre  TEXT  NOT NULL,
  era    TEXT  NOT NULL,
  term   TEXT  NOT NULL,   -- e.g. '90s pop hits', 'grunge'

  UNIQUE(genre, era, term)
);

CREATE INDEX idx_search_terms ON genre_era_search_terms(genre, era);

ALTER TABLE genre_era_search_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON genre_era_search_terms FOR SELECT USING (true);

-- ─── lastfm_similar_artists ──────────────────────────────────────────────────
-- Cached artist similarity relationships from Last.fm artist.getSimilar.
-- Populated lazily: the app writes here on cache misses for "sounds like" artists.

CREATE TABLE lastfm_similar_artists (
  id             UUID   DEFAULT gen_random_uuid() PRIMARY KEY,
  source_artist  TEXT   NOT NULL,
  similar_artist TEXT   NOT NULL,
  match_score    FLOAT,                -- Last.fm similarity 0–1
  updated_at     TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(source_artist, similar_artist)
);

CREATE INDEX idx_similar_source ON lastfm_similar_artists(source_artist);

ALTER TABLE lastfm_similar_artists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read"   ON lastfm_similar_artists FOR SELECT USING (true);
CREATE POLICY "public insert" ON lastfm_similar_artists FOR INSERT WITH CHECK (true);
CREATE POLICY "public update" ON lastfm_similar_artists FOR UPDATE USING (true);

-- ─── lastfm_cache_metadata ───────────────────────────────────────────────────
-- Tracks when each genre × era combo was last refreshed.

CREATE TABLE lastfm_cache_metadata (
  genre           TEXT        NOT NULL,
  era             TEXT        NOT NULL,
  last_refreshed  TIMESTAMPTZ DEFAULT NOW(),
  artist_count    INTEGER,

  PRIMARY KEY (genre, era)
);

ALTER TABLE lastfm_cache_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON lastfm_cache_metadata FOR SELECT USING (true);
