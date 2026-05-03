import { supabase } from '@/src/services/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type SwipeAction = 'save' | 'skip' | 'expand';

type SwipeEventPayload = {
  spotify_user_id: string;
  track_id: string;
  action: SwipeAction;
  time_listened_ms: number;
};

type SavedHookPayload = {
  spotify_user_id: string;
  track_id: string;
  artist_id: string;
};

// ─── Fire-and-forget helper ───────────────────────────────────────────────────
// Swallows errors so analytics never throw into UI code.

function fireAndForget(promise: Promise<unknown>): void {
  promise.catch((err) => {
    if (__DEV__) {
      console.warn('[analytics]', err);
    }
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record a swipe interaction. Call this whenever the user saves, skips,
 * or expands a track card. Never awaited — UI is never blocked.
 */
export function trackSwipe(payload: SwipeEventPayload): void {
  fireAndForget(
    supabase.from('swipe_events').insert({
      spotify_user_id: payload.spotify_user_id,
      track_id: payload.track_id,
      action: payload.action,
      time_listened_ms: payload.time_listened_ms,
    }),
  );
}

/**
 * Record a save action and persist the hook to saved_hooks.
 * Also increments the user's save_count in user_preferences.
 */
export function trackSave(payload: SavedHookPayload): void {
  // Insert into saved_hooks (ignore conflict if already saved)
  fireAndForget(
    supabase
      .from('saved_hooks')
      .upsert(
        {
          spotify_user_id: payload.spotify_user_id,
          track_id: payload.track_id,
          artist_id: payload.artist_id,
        },
        { onConflict: 'spotify_user_id,track_id', ignoreDuplicates: true },
      ),
  );

  // Increment save_count
  fireAndForget(
    supabase.rpc('increment_save_count', { uid: payload.spotify_user_id }),
  );

  // Also log as a swipe event
  trackSwipe({
    spotify_user_id: payload.spotify_user_id,
    track_id: payload.track_id,
    action: 'save',
    time_listened_ms: 0,
  });
}

/**
 * Record a skip action. Pass time_listened_ms to capture how much
 * of the preview the user heard before skipping.
 */
export function trackSkip({
  spotify_user_id,
  track_id,
  time_listened_ms,
}: {
  spotify_user_id: string;
  track_id: string;
  time_listened_ms: number;
}): void {
  trackSwipe({ spotify_user_id, track_id, action: 'skip', time_listened_ms });

  // Increment discovery_count on skip (user is browsing)
  fireAndForget(
    supabase.rpc('increment_discovery_count', { uid: spotify_user_id }),
  );
}

/**
 * Record an expand action (user tapped to open artist panel).
 */
export function trackExpand({
  spotify_user_id,
  track_id,
  time_listened_ms,
}: {
  spotify_user_id: string;
  track_id: string;
  time_listened_ms: number;
}): void {
  trackSwipe({ spotify_user_id, track_id, action: 'expand', time_listened_ms });
}

/**
 * Upsert user preferences row on first login / genre update.
 */
export function upsertUserPreferences({
  spotify_user_id,
  favorite_genres,
}: {
  spotify_user_id: string;
  favorite_genres?: string[];
}): void {
  fireAndForget(
    supabase.from('user_preferences').upsert(
      {
        spotify_user_id,
        ...(favorite_genres !== undefined && { favorite_genres }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'spotify_user_id' },
    ),
  );
}
