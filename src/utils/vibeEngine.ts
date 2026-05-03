// ─── Vibe Engine ──────────────────────────────────────────────────────────────
// Pure functions. No side effects. sessionStore calls these and manages morphing.

import { VIBE_RULES } from '@/src/data/vibeRules';
import type { SpotifyTrack } from '@/src/services/spotify';

// ─── Genre distribution ───────────────────────────────────────────────────────

/**
 * Build a normalized genre distribution from an array of saved tracks.
 * Returns Record<genreName, percentage> where values sum to 1.0.
 * Uses primaryGenreName from each track (from iTunes).
 */
export function computeGenreDistribution(tracks: SpotifyTrack[]): Record<string, number> {
  if (!tracks.length) return {};

  const counts: Record<string, number> = {};
  for (const track of tracks) {
    const genre = track.primaryGenreName?.trim();
    if (genre) {
      counts[genre] = (counts[genre] ?? 0) + 1;
    }
  }

  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (total === 0) return {};

  const dist: Record<string, number> = {};
  for (const [genre, count] of Object.entries(counts)) {
    dist[genre] = count / total;
  }
  return dist;
}

// ─── Energy proxy ─────────────────────────────────────────────────────────────

/**
 * Derive a 0–1 energy score from genre distribution.
 * High-energy genres push toward 1.0, mellow genres toward 0.0, neutral → 0.5.
 */
export function computeEnergyLevel(dist: Record<string, number>): number {
  let high = 0;
  let low = 0;

  for (const [genre, pct] of Object.entries(dist)) {
    const g = genre.toLowerCase();

    const isHigh =
      g.includes('hip-hop') || g.includes('hip hop') || g.includes('rap') ||
      g.includes('dance') || g.includes('house') || g.includes('electronic') ||
      g.includes('metal') || g.includes('punk') || g.includes('drum and bass') ||
      g.includes('trance') || g.includes('edm') || g.includes('techno') ||
      (g.includes('rock') && !g.includes('folk rock') && !g.includes('soft rock'));

    const isLow =
      g.includes('folk') || g.includes('acoustic') || g.includes('jazz') ||
      g.includes('lo-fi') || g.includes('lofi') || g.includes('ambient') ||
      g.includes('classical') || g.includes('singer/songwriter') ||
      g.includes('singer-songwriter') || g.includes('chillwave');

    if (isHigh) high += pct;
    else if (isLow) low += pct;
  }

  if (high + low === 0) return 0.5;
  // Scale: all-high → 1.0, all-low → 0.0, equal mix → 0.5
  return Math.max(0, Math.min(1, (high - low) / (high + low) * 0.5 + 0.5));
}

// ─── Rule matching ────────────────────────────────────────────────────────────

export type VibeMatch = {
  label: string;
  keywords: string[];
  matchedRuleId: string;
};

/**
 * Run all vibe rules against the current session and return the first match.
 * Rules are sorted by priority (ascending). Returns null if no saves yet.
 */
export function analyzeSession(
  saves: SpotifyTrack[],
  _skips: SpotifyTrack[],
): VibeMatch | null {
  if (!saves.length) return null;

  const dist = computeGenreDistribution(saves);
  const energy = computeEnergyLevel(dist);

  const sorted = [...VIBE_RULES].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (rule.match(dist, energy)) {
      return { label: rule.label, keywords: rule.keywords, matchedRuleId: rule.id };
    }
  }

  // Safety fallback — Genre Hopper always matches
  const fallback = sorted[sorted.length - 1];
  return { label: fallback.label, keywords: fallback.keywords, matchedRuleId: fallback.id };
}

// ─── Morph detection ─────────────────────────────────────────────────────────

/**
 * Returns true if there's a significant secondary genre cluster (>30% of saves)
 * in addition to the dominant one. Used to trigger label morphing.
 */
export function hasSignificantSecondary(dist: Record<string, number>): boolean {
  const values = Object.values(dist);
  if (values.length < 2) return false;
  const sorted = [...values].sort((a, b) => b - a);
  return sorted[1] > 0.30;
}
