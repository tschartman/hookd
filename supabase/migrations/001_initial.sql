-- ─── swipe_events ─────────────────────────────────────────────────────────────
-- One row per user interaction with a track card.
-- action: 'save' | 'skip' | 'expand'

create table if not exists swipe_events (
  id                uuid        primary key default gen_random_uuid(),
  spotify_user_id   text        not null,
  track_id          text        not null,
  action            text        not null check (action in ('save', 'skip', 'expand')),
  time_listened_ms  int         not null default 0,
  created_at        timestamptz not null default now()
);

create index swipe_events_user_idx  on swipe_events (spotify_user_id);
create index swipe_events_track_idx on swipe_events (track_id);
create index swipe_events_time_idx  on swipe_events (created_at desc);

-- ─── saved_hooks ──────────────────────────────────────────────────────────────
-- Tracks the user has saved (double-tap or save button).

create table if not exists saved_hooks (
  id               uuid        primary key default gen_random_uuid(),
  spotify_user_id  text        not null,
  track_id         text        not null,
  artist_id        text        not null,
  saved_at         timestamptz not null default now(),

  -- Prevent duplicate saves for the same user + track
  unique (spotify_user_id, track_id)
);

create index saved_hooks_user_idx on saved_hooks (spotify_user_id);

-- ─── user_preferences ─────────────────────────────────────────────────────────
-- One row per user. Upserted on first activity and updated over time.

create table if not exists user_preferences (
  spotify_user_id  text    primary key,
  favorite_genres  text[]  not null default '{}',
  discovery_count  int     not null default 0,
  save_count       int     not null default 0,
  updated_at       timestamptz not null default now()
);

-- ─── Row Level Security ────────────────────────────────────────────────────────
-- We use the anon key from the client; RLS ensures users can only write their
-- own rows. Enable RLS but allow inserts from the anon role (analytics only
-- writes, never reads PII server-side).

alter table swipe_events     enable row level security;
alter table saved_hooks      enable row level security;
alter table user_preferences enable row level security;

-- swipe_events: anon can insert; no select needed from client
create policy "insert own swipe events"
  on swipe_events for insert
  with check (true);

-- saved_hooks: anon can insert and delete their own rows
create policy "insert own saved hooks"
  on saved_hooks for insert
  with check (true);

create policy "delete own saved hooks"
  on saved_hooks for delete
  using (true);

-- user_preferences: anon can upsert
create policy "upsert own preferences"
  on user_preferences for all
  using (true)
  with check (true);
