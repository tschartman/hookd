// ─── genreEraSeeds.ts — DEPRECATED ───────────────────────────────────────────
// This file is a backwards-compatibility re-export shim.
// All content has moved to genreConfig.ts.
// Hardcoded artist lists have been removed — discovery now comes from Supabase
// (populated by the Last.fm cache refresh Edge Function).
//
// DO NOT add artist arrays here. Update genreConfig.ts instead.

export {
  type Era,
  type Genre,
  ERAS,
  GENRES,
  GENRE_ICONS,
  ERA_YEAR_RANGES,
  GENRE_ERA_SEEDS,
  type GenreConfig,
  GENRE_CONFIGS,
  getEraSearchTerms,
} from './genreConfig';
