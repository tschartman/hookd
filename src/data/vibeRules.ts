// ─── Vibe Rules ───────────────────────────────────────────────────────────────
// ~20 rules checked in priority order. First match wins.
// genreDistribution: Record<genreName, percentage> where all values sum to 1.0
// energyLevel: 0.0 (mellow) → 1.0 (high energy), derived from genre mix

export type VibeRule = {
  id: string;
  label: string;
  keywords: string[];
  priority: number;
  match: (dist: Record<string, number>, energy: number) => boolean;
};

// ─── Genre group helpers ──────────────────────────────────────────────────────

/** Sum percentages for all genres matching any of the given patterns (case-insensitive). */
function groupPct(dist: Record<string, number>, ...patterns: string[]): number {
  return Object.entries(dist).reduce((sum, [genre, pct]) => {
    const g = genre.toLowerCase();
    return patterns.some((p) => g.includes(p.toLowerCase())) ? sum + pct : sum;
  }, 0);
}

const pop       = (d: Record<string, number>) => groupPct(d, 'pop') - groupPct(d, 'indie pop', 'indie-pop', 'k-pop', 'dream pop');
const hiphop    = (d: Record<string, number>) => groupPct(d, 'hip-hop', 'hip hop', 'rap');
const electronic= (d: Record<string, number>) => groupPct(d, 'electronic', 'electronica', 'edm', 'trance', 'techno', 'drum and bass');
const dance     = (d: Record<string, number>) => groupPct(d, 'dance', 'house', 'club');
const indie     = (d: Record<string, number>) => groupPct(d, 'indie', 'alternative', 'alt-');
const folk      = (d: Record<string, number>) => groupPct(d, 'folk', 'singer/songwriter', 'singer-songwriter', 'acoustic');
const jazz      = (d: Record<string, number>) => groupPct(d, 'jazz');
const rock      = (d: Record<string, number>) => groupPct(d, 'rock') - groupPct(d, 'punk', 'metal', 'hard rock', 'indie rock', 'folk rock', 'psych');
const punk      = (d: Record<string, number>) => groupPct(d, 'punk');
const metal     = (d: Record<string, number>) => groupPct(d, 'metal', 'hard rock');
const rb        = (d: Record<string, number>) => groupPct(d, 'r&b', 'soul', 'neo soul', 'rhythm and blues');
const country   = (d: Record<string, number>) => groupPct(d, 'country', 'americana', 'bluegrass');
const reggae    = (d: Record<string, number>) => groupPct(d, 'reggae', 'ska');
const lofi      = (d: Record<string, number>) => groupPct(d, 'lo-fi', 'lofi', 'chillwave', 'ambient', 'chill');
const psych     = (d: Record<string, number>) => groupPct(d, 'psychedelic', 'psych rock', 'experimental', 'prog');
const world     = (d: Record<string, number>) => groupPct(d, 'latin', 'world', 'afrobeat', 'reggaeton', 'cumbia', 'bossa', 'samba', 'flamenco');
const songwriter= (d: Record<string, number>) => groupPct(d, 'singer/songwriter', 'singer-songwriter', 'folk', 'acoustic');

// ─── Rules (checked in priority order — lower priority number = checked first) ─

export const VIBE_RULES: VibeRule[] = [
  // ── 1. Metal Mayhem — very specific, must come before generic Rock ──────
  {
    id: 'metal_mayhem',
    label: 'Metal Mayhem',
    keywords: ['heavy metal', 'hard rock', 'headbanger', 'shred'],
    priority: 1,
    match: (d) => metal(d) + punk(d) > 0.5,
  },

  // ── 2. Punk Rock Basement ────────────────────────────────────────────────
  {
    id: 'punk_rock_basement',
    label: 'Punk Rock Basement',
    keywords: ['punk rock', 'garage rock', 'indie punk', 'raw energy'],
    priority: 2,
    match: (d, e) => punk(d) + rock(d) > 0.5 && e > 0.6,
  },

  // ── 3. Lo-Fi Study Session ───────────────────────────────────────────────
  {
    id: 'lofi_study',
    label: 'Lo-Fi Study Session',
    keywords: ['lo-fi beats', 'study music', 'chill instrumental', 'ambient focus'],
    priority: 3,
    match: (d, e) => lofi(d) > 0.4 && e < 0.4,
  },

  // ── 4. Late Night Electronic ─────────────────────────────────────────────
  {
    id: 'late_night_electronic',
    label: 'Late Night Electronic',
    keywords: ['deep house', 'synthwave', 'late night beats', 'electronic'],
    priority: 4,
    match: (d) => electronic(d) + dance(d) > 0.5,
  },

  // ── 5. Pre-Game Hype — hip-hop + high energy ─────────────────────────────
  {
    id: 'pregame_hype',
    label: 'Pre-Game Hype',
    keywords: ['hype rap', 'trap bangers', 'drill', 'turn up'],
    priority: 5,
    match: (d, e) => hiphop(d) > 0.5 && e > 0.6,
  },

  // ── 6. Hip-Hop Underground — hip-hop, lower energy / discovery bend ───────
  {
    id: 'hiphop_underground',
    label: 'Hip-Hop Underground',
    keywords: ['underground rap', 'boom bap', 'conscious hip-hop', 'lyrical'],
    priority: 6,
    match: (d, e) => hiphop(d) > 0.5 && e <= 0.6,
  },

  // ── 7. Midnight R&B ──────────────────────────────────────────────────────
  {
    id: 'midnight_rnb',
    label: 'Midnight R&B',
    keywords: ['neo soul', 'midnight mood', 'silky r&b', 'late night r&b'],
    priority: 7,
    match: (d) => rb(d) > 0.5,
  },

  // ── 8. Country Roads ─────────────────────────────────────────────────────
  {
    id: 'country_roads',
    label: 'Country Roads',
    keywords: ['country pop', 'americana', 'folk country', 'rootsy'],
    priority: 8,
    match: (d) => country(d) > 0.5,
  },

  // ── 9. World Music Explorer ──────────────────────────────────────────────
  {
    id: 'world_music',
    label: 'World Music Explorer',
    keywords: ['afrobeats', 'reggaeton', 'global sounds', 'latin pop'],
    priority: 9,
    match: (d) => world(d) > 0.4,
  },

  // ── 10. Psychedelic Wander ───────────────────────────────────────────────
  {
    id: 'psychedelic_wander',
    label: 'Psychedelic Wander',
    keywords: ['psychedelic', 'experimental', 'trippy', 'mind-expanding'],
    priority: 10,
    match: (d) => psych(d) + electronic(d) + indie(d) > 0.5 && psych(d) > 0.15,
  },

  // ── 11. Rainy Day Acoustic ───────────────────────────────────────────────
  {
    id: 'rainy_acoustic',
    label: 'Rainy Day Acoustic',
    keywords: ['acoustic folk', 'mellow', 'rainy day playlist', 'unplugged'],
    priority: 11,
    match: (d, e) => folk(d) > 0.5 && e < 0.4,
  },

  // ── 12. Emotional Deep Dive ──────────────────────────────────────────────
  {
    id: 'emotional_deep_dive',
    label: 'Emotional Deep Dive',
    keywords: ['sad indie', 'melancholy', 'heartfelt', 'emotional'],
    priority: 12,
    match: (d, e) => songwriter(d) > 0.4 && e < 0.35,
  },

  // ── 13. Coffee Shop Drift — indie + jazz + folk low energy mix ────────────
  {
    id: 'coffee_shop',
    label: 'Coffee Shop Drift',
    keywords: ['coffee shop acoustic', 'indie folk', 'lo-fi indie', 'café vibes'],
    priority: 13,
    match: (d, e) => indie(d) + jazz(d) + folk(d) > 0.5 && e < 0.45,
  },

  // ── 14. Indie Daydream — indie/alt dominant, low-med energy ──────────────
  {
    id: 'indie_daydream',
    label: 'Indie Daydream',
    keywords: ['dreamy indie', 'bedroom pop', 'shoegaze', 'indie pop'],
    priority: 14,
    match: (d, e) => indie(d) > 0.5 && e < 0.65,
  },

  // ── 15. Pop Perfection — pop very dominant ────────────────────────────────
  {
    id: 'pop_perfection',
    label: 'Pop Perfection',
    keywords: ['catchy pop', 'viral pop', 'chart-topper', 'radio hit'],
    priority: 15,
    match: (d, e) => pop(d) > 0.6 && e > 0.5,
  },

  // ── 16. Main Stage Energy — pop + hiphop, high energy ─────────────────────
  {
    id: 'main_stage_energy',
    label: 'Main Stage Energy',
    keywords: ['festival anthem', 'pop hits', 'crowd pleaser', 'radio banger'],
    priority: 16,
    match: (d, e) => pop(d) + hiphop(d) > 0.5 && e > 0.55,
  },

  // ── 17. Summer Cruising — pop + rock + reggae, med energy ─────────────────
  {
    id: 'summer_cruising',
    label: 'Summer Cruising',
    keywords: ['summer hits', 'feel good', 'road trip', 'sunny vibes'],
    priority: 17,
    match: (d, e) => pop(d) + rock(d) + reggae(d) > 0.5 && e >= 0.4 && e <= 0.7,
  },

  // ── 18. Throwback Vibes — fallback for rock/pop with low indie/electronic ─
  {
    id: 'throwback_vibes',
    label: 'Throwback Vibes',
    keywords: ['nostalgia', 'classic hits', 'throwback', 'golden era'],
    priority: 18,
    match: (d) => rock(d) + pop(d) > 0.5 && electronic(d) < 0.1 && indie(d) < 0.2,
  },

  // ── 19. Festival Discovery — diverse mix in festival context ──────────────
  {
    id: 'festival_discovery',
    label: 'Festival Discovery',
    keywords: ['festival lineup', 'new music', 'live shows', 'emerging artists'],
    priority: 19,
    match: (d) => {
      // Triggers when no single genre dominates but the mix is eclectic (2+ genres >15%)
      const significant = Object.values(d).filter((pct) => pct > 0.15).length;
      return significant >= 3;
    },
  },

  // ── 20. Genre Hopper — fallback, no genre >35% ────────────────────────────
  {
    id: 'genre_hopper',
    label: 'Genre Hopper',
    keywords: ['eclectic mix', 'genre-defying', 'all over the map', 'varied'],
    priority: 20,
    match: (d) => Math.max(...Object.values(d), 0) < 0.35,
  },
];
