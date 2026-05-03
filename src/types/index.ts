// ─── Shared application types ─────────────────────────────────────────────────

/**
 * A row from `festival_artist_tracks` that has been resolved by the
 * `resolve-festival-itunes` Edge Function.
 *
 * Only rows where `itunes_preview_url IS NOT NULL` should be queried — the
 * field is non-nullable here because the Supabase query always filters for it.
 */
export type ResolvedTrack = {
  artist_name: string;
  track_name: string;
  track_rank: number;
  lastfm_listeners: number | null;
  lastfm_playcount: number | null;
  itunes_track_id: number;
  itunes_preview_url: string;
  itunes_artwork_url: string | null;
  itunes_artist_name: string | null;
  itunes_collection_name: string | null;
  itunes_release_date: string | null;
};
