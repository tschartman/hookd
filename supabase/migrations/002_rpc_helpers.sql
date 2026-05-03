-- ─── increment_save_count ─────────────────────────────────────────────────────
-- Called fire-and-forget from the client on every save action.
-- Upserts the user row so it's safe to call before the row exists.

create or replace function increment_save_count(uid text)
returns void
language sql
security definer
as $$
  insert into user_preferences (spotify_user_id, save_count)
  values (uid, 1)
  on conflict (spotify_user_id)
  do update set
    save_count = user_preferences.save_count + 1,
    updated_at = now();
$$;

-- ─── increment_discovery_count ────────────────────────────────────────────────
-- Called fire-and-forget from the client on every skip action.

create or replace function increment_discovery_count(uid text)
returns void
language sql
security definer
as $$
  insert into user_preferences (spotify_user_id, discovery_count)
  values (uid, 1)
  on conflict (spotify_user_id)
  do update set
    discovery_count = user_preferences.discovery_count + 1,
    updated_at = now();
$$;
