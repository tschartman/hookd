-- ─── festivals ────────────────────────────────────────────────────────────────
-- One row per festival. Managed via the seed script; updated remotely without
-- requiring an app update.

CREATE TABLE festivals (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text        NOT NULL,
  slug                    text        UNIQUE NOT NULL,
  dates                   text,
  location                text,
  description             text,
  genre_tags              text[]      NOT NULL DEFAULT '{}',
  estimated_attendance    int         NOT NULL DEFAULT 0,
  image_color_primary     text        NOT NULL DEFAULT '#1DB954',
  image_color_secondary   text        NOT NULL DEFAULT '#0A0A0A',
  year                    int,
  active                  boolean     NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX festivals_slug_idx    ON festivals (slug);
CREATE INDEX festivals_active_idx  ON festivals (active) WHERE active = true;

-- ─── festival_artists ─────────────────────────────────────────────────────────
-- One row per artist per festival. Duplicates across festivals are allowed
-- (same artist can appear in multiple festivals).

CREATE TABLE festival_artists (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id  uuid        NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  tier         text        NOT NULL CHECK (tier IN ('headliner', 'midtier', 'opener')),
  genres       text[]      NOT NULL DEFAULT '{}',

  UNIQUE (festival_id, name)
);

CREATE INDEX festival_artists_festival_idx ON festival_artists (festival_id);
CREATE INDEX festival_artists_tier_idx     ON festival_artists (festival_id, tier);

-- ─── Row Level Security ────────────────────────────────────────────────────────
-- Festival data is public (read) and admin-only (write).
-- For now, open full access via anon key — same pattern as collections.

ALTER TABLE festivals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE festival_artists  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read festivals"
  ON festivals FOR SELECT
  USING (true);

CREATE POLICY "public read festival_artists"
  ON festival_artists FOR SELECT
  USING (true);

-- Seed / admin writes require the service role key (bypasses RLS).
-- The seed script should be run with SUPABASE_SERVICE_KEY, not the anon key.
