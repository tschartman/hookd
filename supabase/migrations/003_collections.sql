-- ─── collections ─────────────────────────────────────────────────────────────
-- One row per discovery context (per-festival or main feed) per user.
-- Created automatically on first save; never manually created by users.

CREATE TABLE collections (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_user_id       text        NOT NULL,
  type                  text        NOT NULL CHECK (type IN ('festival', 'main_feed')),
  name                  text        NOT NULL,   -- "Lollapalooza 2026" or "Main Feed Discoveries"
  slug                  text        NOT NULL,   -- festival slug or "main-feed"
  exported_playlist_url text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_saved_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (spotify_user_id, slug)
);

CREATE INDEX collections_user_idx       ON collections (spotify_user_id);
CREATE INDEX collections_last_saved_idx ON collections (last_saved_at DESC);

-- ─── saved_tracks ─────────────────────────────────────────────────────────────
-- One row per saved track per collection. A track can appear in multiple
-- collections if discovered on both a festival feed and the main feed.

CREATE TABLE saved_tracks (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id    uuid        NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  spotify_user_id  text        NOT NULL,
  itunes_track_id  text        NOT NULL,
  track_name       text        NOT NULL,
  artist_name      text        NOT NULL,
  artwork_url      text,
  preview_url      text,
  genre            text,
  saved_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (collection_id, itunes_track_id)
);

CREATE INDEX saved_tracks_collection_idx ON saved_tracks (collection_id);
CREATE INDEX saved_tracks_user_idx       ON saved_tracks (spotify_user_id);
CREATE INDEX saved_tracks_saved_at_idx   ON saved_tracks (saved_at DESC);

-- ─── Row Level Security ────────────────────────────────────────────────────────
-- Using the anon key from the client. Allow full access for now — a future
-- iteration can scope these to the authenticated Spotify user_id header.

ALTER TABLE collections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all own collections"
  ON collections FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "all own saved_tracks"
  ON saved_tracks FOR ALL
  USING (true)
  WITH CHECK (true);
