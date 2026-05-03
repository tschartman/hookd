// ─── Festival types ───────────────────────────────────────────────────────────

export type ArtistTier = 'headliner' | 'midtier' | 'opener';

/** How many iTunes tracks to fetch per tier. */
export const TIER_FETCH_LIMIT: Record<ArtistTier, number> = {
  headliner: 10,
  midtier:   5,
  opener:    3,
};

export type FestivalArtist = {
  name: string;
  tier: ArtistTier;
  genres?: string[];
};

export type Festival = {
  id: string;
  name: string;
  slug: string;
  dates: string;
  location: string;
  description: string;
  /** Primary genres for Fests tab filter chips. */
  genres: string[];
  /** For sorting by popularity. */
  estimatedAttendance: number;
  /** Gradient palette for the festival card (fallback when no poster). */
  imageColors: { primary: string; secondary: string };
  artists: FestivalArtist[];
  /** ISO date strings from Supabase (YYYY-MM-DD). */
  startDate?: string;
  endDate?: string;
  /** Public URL to the festival poster image. */
  posterUrl?: string;
};
