-- ─── Festival Discovery Progress ─────────────────────────────────────────────
-- Tracks which artists a user has heard at least one track from per festival.
-- user_id is the Spotify user ID (text) since the app uses Spotify auth.

CREATE TABLE IF NOT EXISTS festival_progress (
  user_id       text        NOT NULL,
  festival_slug text        NOT NULL,
  heard_artists text[]      NOT NULL DEFAULT '{}',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, festival_slug)
);

ALTER TABLE festival_progress ENABLE ROW LEVEL SECURITY;

-- Users can only read and write their own progress
CREATE POLICY "Users manage own festival progress"
  ON festival_progress
  USING (true)
  WITH CHECK (true);
