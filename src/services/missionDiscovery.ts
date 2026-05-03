// ─── missionDiscovery.ts ──────────────────────────────────────────────────────
// Reads crowd-sourced mission activity tracks from Supabase.
// Populated by the refresh-mission-playlists Edge Function which calls
// Last.fm tag.getTopTracks for activity tags like "running", "workout", etc.
//
// tag_count = how many distinct Last.fm activity tags reference this track.
// listeners = Last.fm listener count (popularity proxy).
// Together these provide the same signal as playlist_count: tracks that real
// users associate with the activity appear at the top.

import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MissionPlaylistTrack {
  track_name: string;
  artist_name: string;
  /** How many distinct Last.fm activity tags reference this track. Primary quality signal. */
  tag_count: number;
  /** Last.fm listener count. Secondary signal when tag_count is tied. */
  listeners: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalize mission type IDs so the app's template IDs match the Edge Function's
 * storage keys. The Edge Function uses 'roadtrip' (no hyphen); the template
 * uses 'road-trip'. Strip hyphens before querying.
 */
function normalizeMissionType(missionType: string): string {
  return missionType.replace(/-/g, '');
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Get crowd-sourced activity tracks for a mission type.
 * Ordered by tag_count DESC (primary), then listeners DESC (secondary).
 *
 * Returns empty array (not an error) if the cache hasn't been populated yet —
 * useMission gracefully falls back to bronze-only (genre×era artists) in that case.
 *
 * @param missionType  Template ID: 'running', 'gym', 'study', 'road-trip', 'party', 'chill', 'morning'
 * @param options.limit  Max tracks to return (default 200)
 */
export async function getMissionPlaylistTracks(
  missionType: string,
  options?: { limit?: number },
): Promise<MissionPlaylistTrack[]> {
  const limit = options?.limit ?? 200;
  const normalizedType = normalizeMissionType(missionType);

  const { data, error } = await supabase
    .from('mission_playlist_tracks')
    .select('track_name, artist_name, tag_count, listeners')
    .eq('mission_type', normalizedType)
    .order('tag_count', { ascending: false })
    .order('listeners', { ascending: false })
    .limit(limit);

  if (error) {
    // Non-fatal: log and return empty so the hook falls back to bronze-only pool
    console.warn(`[missionDiscovery] getMissionPlaylistTracks error (${normalizedType}):`, error.message);
    return [];
  }

  return (data ?? []).map((r) => ({
    track_name: r.track_name as string,
    artist_name: r.artist_name as string,
    tag_count: (r.tag_count as number) ?? 1,
    listeners: (r.listeners as number) ?? 0,
  }));
}
