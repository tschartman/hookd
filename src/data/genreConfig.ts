// ─── genreConfig.ts ───────────────────────────────────────────────────────────
// Genre × Era configuration — NO hardcoded artist names.
// Artist discovery comes from Supabase (populated by Last.fm cache refresh).
// This file defines:
//   - Type exports shared across the app (Era, Genre, ERAS, GENRES, etc.)
//   - Last.fm tags used by the Edge Function to populate genre_era_artists
//   - iTunes search terms used for supplementary discovery + cold-start fallback

// ─── Types ────────────────────────────────────────────────────────────────────

export type Era = '50s' | '60s' | '70s' | '80s' | '90s' | '00s' | '10s' | '20s';

export type Genre =
  | 'Rock'
  | 'Pop'
  | 'Hip-Hop'
  | 'R&B'
  | 'Electronic'
  | 'Country'
  | 'Jazz'
  | 'Folk'
  | 'Latin'
  | 'Punk'
  | 'Metal';

// ─── Constants ────────────────────────────────────────────────────────────────

export const ERAS: Era[] = ['50s', '60s', '70s', '80s', '90s', '00s', '10s', '20s'];

export const GENRES: Genre[] = [
  'Rock', 'Pop', 'Hip-Hop', 'R&B', 'Electronic',
  'Country', 'Jazz', 'Folk', 'Latin', 'Punk', 'Metal',
];

export const GENRE_ICONS: Record<Genre, string> = {
  'Rock':       '🎸',
  'Pop':        '✨',
  'Hip-Hop':    '🎤',
  'R&B':        '🎶',
  'Electronic': '🎛️',
  'Country':    '🤠',
  'Jazz':       '🎷',
  'Folk':       '🪕',
  'Latin':      '💃',
  'Punk':       '🔥',
  'Metal':      '🤘',
};

export const ERA_YEAR_RANGES: Record<Era, { yearStart: number; yearEnd: number }> = {
  '50s': { yearStart: 1950, yearEnd: 1959 },
  '60s': { yearStart: 1960, yearEnd: 1969 },
  '70s': { yearStart: 1970, yearEnd: 1979 },
  '80s': { yearStart: 1980, yearEnd: 1989 },
  '90s': { yearStart: 1990, yearEnd: 1999 },
  '00s': { yearStart: 2000, yearEnd: 2009 },
  '10s': { yearStart: 2010, yearEnd: 2019 },
  '20s': { yearStart: 2020, yearEnd: 2029 },
};

// ─── Genre Config ─────────────────────────────────────────────────────────────

export interface GenreConfig {
  /** App-internal ID (lowercase, matches Supabase `genre` column) */
  id: string;
  /** Display label */
  label: Genre;
  /**
   * Last.fm tag names to query for this genre.
   * Primary tag first (used by Edge Function). The refresh job queries
   * compound era-specific tags first (e.g. "90s pop"), then falls back to
   * the primary tag for eras with sparse compound tag coverage.
   */
  lastfmTags: string[];
  /** Which eras have enough content to be useful */
  availableEras: Era[];
  /**
   * iTunes search terms per era for supplementary track discovery.
   * Used to supplement Supabase artist results AND as cold-start fallback
   * when Supabase cache is empty (first deploy / network issues).
   * These are search queries, NOT artist names.
   */
  eraSearchTerms: Partial<Record<Era, string[]>>;
}

export const GENRE_CONFIGS: Record<Genre, GenreConfig> = {
  Rock: {
    id: 'rock',
    label: 'Rock',
    lastfmTags: ['rock', 'classic rock', 'alternative rock', 'indie rock'],
    availableEras: ['50s', '60s', '70s', '80s', '90s', '00s', '10s', '20s'],
    eraSearchTerms: {
      '50s': ['50s rock and roll', 'rockabilly', 'early rock'],
      '60s': ['60s rock', 'classic rock 1960s', 'british invasion rock'],
      '70s': ['70s rock', 'classic rock 70s', 'arena rock 1970s'],
      '80s': ['80s rock', 'arena rock 80s', 'new wave rock 80s'],
      '90s': ['90s rock', 'alternative rock 90s', 'grunge 90s'],
      '00s': ['2000s rock', 'indie rock 2000s', 'post-punk revival'],
      '10s': ['2010s rock', 'indie rock 2010s', 'psych rock 2010s'],
      '20s': ['2020s rock', 'indie rock 2020s', 'post-punk 2020s'],
    },
  },

  Pop: {
    id: 'pop',
    label: 'Pop',
    lastfmTags: ['pop', 'dance pop', 'synth-pop', 'pop rock'],
    availableEras: ['50s', '60s', '70s', '80s', '90s', '00s', '10s', '20s'],
    eraSearchTerms: {
      '50s': ['50s pop', '50s crooners', '50s standards'],
      '60s': ['60s pop', 'Motown 1960s', 'sunshine pop 60s'],
      '70s': ['70s pop', 'disco pop 70s', 'soft rock 70s'],
      '80s': ['80s pop', 'synth pop 80s', 'pop hits 1980s'],
      '90s': ['90s pop', 'bubblegum pop 90s', 'pop hits 1990s'],
      '00s': ['2000s pop', 'pop hits 2000s', 'teen pop 2000s'],
      '10s': ['2010s pop', 'pop hits 2010s', 'electropop 2010s'],
      '20s': ['2020s pop', 'pop hits 2020s', 'indie pop 2020s'],
    },
  },

  'Hip-Hop': {
    id: 'hip-hop',
    label: 'Hip-Hop',
    lastfmTags: ['hip-hop', 'hip hop', 'rap', 'trap'],
    availableEras: ['80s', '90s', '00s', '10s', '20s'],
    eraSearchTerms: {
      '80s': ['80s hip hop', 'old school rap', 'golden age hip hop 80s'],
      '90s': ['90s hip hop', 'golden age rap', 'gangsta rap 90s'],
      '00s': ['2000s hip hop', 'rap 2000s', 'crunk 2000s'],
      '10s': ['2010s hip hop', 'trap music 2010s', 'rap 2010s'],
      '20s': ['2020s hip hop', 'rap 2020s', 'underground rap 2020s'],
    },
  },

  'R&B': {
    id: 'r&b',
    label: 'R&B',
    lastfmTags: ['rnb', 'r&b', 'soul', 'neo-soul'],
    availableEras: ['50s', '60s', '70s', '80s', '90s', '00s', '10s', '20s'],
    eraSearchTerms: {
      '50s': ['50s soul', 'doo wop', 'early soul 50s'],
      '60s': ['60s soul', 'classic soul 60s', 'Motown soul'],
      '70s': ['70s soul', 'funk soul 70s', 'classic r&b 70s'],
      '80s': ['80s r&b', 'classic r&b 80s', 'quiet storm 80s'],
      '90s': ['90s r&b', 'neo soul 90s', 'r&b hits 1990s'],
      '00s': ['2000s r&b', 'r&b hits 2000s', 'contemporary r&b 2000s'],
      '10s': ['2010s r&b', 'alternative r&b 2010s', 'contemporary r&b 2010s'],
      '20s': ['2020s r&b', 'r&b 2020s', 'neo soul 2020s'],
    },
  },

  Electronic: {
    id: 'electronic',
    label: 'Electronic',
    lastfmTags: ['electronic', 'electronica', 'edm', 'synthwave'],
    availableEras: ['70s', '80s', '90s', '00s', '10s', '20s'],
    eraSearchTerms: {
      '70s': ['70s electronic', 'krautrock', 'kosmische musik'],
      '80s': ['80s electronic', 'synthwave 80s', 'synth pop 80s'],
      '90s': ['90s electronic', 'rave music 90s', 'big beat 90s'],
      '00s': ['2000s electronic', 'electronica 2000s', 'minimal techno 2000s'],
      '10s': ['2010s electronic', 'electronic 2010s', 'future bass 2010s'],
      '20s': ['2020s electronic', 'electronic 2020s', 'club music 2020s'],
    },
  },

  Country: {
    id: 'country',
    label: 'Country',
    lastfmTags: ['country', 'americana', 'country rock'],
    availableEras: ['50s', '60s', '70s', '80s', '90s', '00s', '10s', '20s'],
    eraSearchTerms: {
      '50s': ['50s country', 'classic country 1950s', 'honky tonk 50s'],
      '60s': ['60s country', 'classic country 60s', 'honky tonk 60s'],
      '70s': ['70s country', 'outlaw country', 'country 70s'],
      '80s': ['80s country', 'country hits 80s', 'neo-traditionalist country'],
      '90s': ['90s country', 'country hits 90s', 'country pop 90s'],
      '00s': ['2000s country', 'country hits 2000s', 'country pop 2000s'],
      '10s': ['2010s country', 'country hits 2010s', 'bro country 2010s'],
      '20s': ['2020s country', 'country hits 2020s', 'americana 2020s'],
    },
  },

  Jazz: {
    id: 'jazz',
    label: 'Jazz',
    lastfmTags: ['jazz', 'smooth jazz', 'jazz fusion', 'acid jazz'],
    availableEras: ['50s', '60s', '70s', '80s', '90s', '00s', '10s', '20s'],
    eraSearchTerms: {
      '50s': ['50s jazz', 'cool jazz', 'bebop'],
      '60s': ['60s jazz', 'cool jazz', 'hard bop 60s'],
      '70s': ['70s jazz', 'jazz fusion 70s', 'jazz rock 70s'],
      '80s': ['80s jazz', 'smooth jazz 80s', 'jazz fusion 80s'],
      '90s': ['90s jazz', 'contemporary jazz 90s', 'neo-bop 90s'],
      '00s': ['2000s jazz', 'nu jazz', 'jazz pop 2000s'],
      '10s': ['2010s jazz', 'jazz fusion 2010s', 'contemporary jazz 2010s'],
      '20s': ['2020s jazz', 'contemporary jazz 2020s', 'jazz soul 2020s'],
    },
  },

  Folk: {
    id: 'folk',
    label: 'Folk',
    lastfmTags: ['folk', 'indie folk', 'folk rock', 'singer-songwriter'],
    availableEras: ['50s', '60s', '70s', '80s', '90s', '00s', '10s', '20s'],
    eraSearchTerms: {
      '50s': ['50s folk', 'folk revival 1950s', 'acoustic folk 50s'],
      '60s': ['60s folk', 'folk revival 60s', 'acoustic folk 60s'],
      '70s': ['70s folk', 'singer songwriter 70s', 'acoustic rock 70s'],
      '80s': ['80s folk', 'folk pop 80s', 'singer songwriter 80s'],
      '90s': ['90s folk', 'folk 90s', 'acoustic singer songwriter 90s'],
      '00s': ['2000s indie folk', 'folk 2000s', 'freak folk'],
      '10s': ['2010s folk', 'indie folk 2010s', 'folk rock 2010s'],
      '20s': ['2020s folk', 'indie folk 2020s', 'folk pop 2020s'],
    },
  },

  Latin: {
    id: 'latin',
    label: 'Latin',
    lastfmTags: ['latin', 'reggaeton', 'latin pop'],
    availableEras: ['60s', '70s', '80s', '90s', '00s', '10s', '20s'],
    eraSearchTerms: {
      '60s': ['60s Latin', 'salsa clasica 60s', 'Latin jazz 60s'],
      '70s': ['70s Latin', 'salsa 70s', 'Latin rock 70s'],
      '80s': ['80s Latin', 'Latin pop 80s', 'salsa romantica'],
      '90s': ['90s Latin', 'Latin pop 90s', 'salsa pop 90s'],
      '00s': ['2000s Latin', 'reggaeton 2000s', 'Latin pop 2000s'],
      '10s': ['2010s Latin', 'Latin trap 2010s', 'reggaeton 2010s'],
      '20s': ['2020s Latin', 'reggaeton 2020s', 'Latin urbano 2020s'],
    },
  },

  Punk: {
    id: 'punk',
    label: 'Punk',
    lastfmTags: ['punk', 'punk rock', 'pop punk', 'hardcore'],
    availableEras: ['70s', '80s', '90s', '00s', '10s', '20s'],
    eraSearchTerms: {
      '70s': ['70s punk', 'punk rock 70s', 'first wave punk'],
      '80s': ['80s punk', 'hardcore punk 80s', 'punk hardcore'],
      '90s': ['90s punk', 'pop punk 90s', 'melodic hardcore 90s'],
      '00s': ['2000s punk', 'pop punk 2000s', 'emo punk 2000s'],
      '10s': ['2010s punk', 'punk revival 2010s', 'folk punk 2010s'],
      '20s': ['2020s punk', 'post-punk 2020s', 'punk revival 2020s'],
    },
  },

  Metal: {
    id: 'metal',
    label: 'Metal',
    lastfmTags: ['metal', 'heavy metal', 'metalcore', 'thrash metal'],
    availableEras: ['70s', '80s', '90s', '00s', '10s', '20s'],
    eraSearchTerms: {
      '70s': ['70s metal', 'heavy metal 70s', 'proto metal 70s'],
      '80s': ['80s metal', 'thrash metal', 'heavy metal 80s'],
      '90s': ['90s metal', 'heavy metal 90s', 'alternative metal 90s'],
      '00s': ['2000s metal', 'nu metal', 'metalcore 2000s'],
      '10s': ['2010s metal', 'heavy metal 2010s', 'progressive metal 2010s'],
      '20s': ['2020s metal', 'metal 2020s', 'heavy metal 2020s'],
    },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Get iTunes search terms for a genre × era combo (used as cold-start fallback). */
export function getEraSearchTerms(genre: Genre, era: Era): string[] {
  return GENRE_CONFIGS[genre]?.eraSearchTerms[era] ?? [];
}

// ─── Backward-compat shim ─────────────────────────────────────────────────────
// GenreEraDial and useGenreEra.randomize() only need `availableEras`.
// Keeping this export avoids touching those files.

export const GENRE_ERA_SEEDS: Record<Genre, { availableEras: Era[] }> =
  Object.fromEntries(
    GENRES.map((g) => [g, { availableEras: GENRE_CONFIGS[g].availableEras }]),
  ) as Record<Genre, { availableEras: Era[] }>;
