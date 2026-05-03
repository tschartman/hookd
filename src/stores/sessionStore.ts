import { create } from 'zustand';

import type { SpotifyTrack } from '@/src/services/spotify';
import {
  analyzeSession,
  computeGenreDistribution,
  hasSignificantSecondary,
} from '@/src/utils/vibeEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VibeStage = 'fresh' | 'building' | 'forming' | 'locked';

function saveCountToStage(count: number): VibeStage {
  if (count === 0) return 'fresh';
  if (count < 5) return 'building';
  if (count < 10) return 'forming';
  return 'locked';
}

function freshState() {
  return {
    sessionId: Math.random().toString(36).slice(2),
    startedAt: new Date(),
    saves: [] as SpotifyTrack[],
    skips: [] as SpotifyTrack[],
    genreDistribution: {} as Record<string, number>,
    vibeLabel: null as string | null,
    vibeKeywords: [] as string[],
    vibeStage: 'fresh' as VibeStage,
    exportReady: false,
    /** All track IDs the user has heard this session (saves + skips). Used to
     *  prevent re-showing a track across queue refills. */
    playedTrackIds: [] as string[],
    // Morphing state — internal
    _firstVibeLabel: null as string | null,
    _firstRuleId: null as string | null,
    _hasMorphed: false,
  };
}

type SessionState = ReturnType<typeof freshState>;

// ─── Actions ──────────────────────────────────────────────────────────────────

type SessionActions = {
  addSave: (track: SpotifyTrack) => void;
  addSkip: (track: SpotifyTrack) => void;
  resetSession: () => void;
  /** Seed a session from a previously saved vibe (e.g. "start from this vibe"). */
  setVibeFromPast: (
    label: string,
    keywords: string[],
    genres: Record<string, number>,
  ) => void;
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSessionStore = create<SessionState & SessionActions>((set, get) => ({
  ...freshState(),

  addSave: (track) => {
    set((s) => {
      const newSaves = [...s.saves, track];
      const newDist = computeGenreDistribution(newSaves);
      const saveCount = newSaves.length;
      const stage = saveCountToStage(saveCount);

      // Run vibe engine
      const match = analyzeSession(newSaves, s.skips);
      if (!match) {
        return {
          saves: newSaves,
          genreDistribution: newDist,
          vibeStage: stage,
          playedTrackIds: [...s.playedTrackIds, track.id],
        };
      }

      // ── Morphing logic ────────────────────────────────────────────────────
      let { _firstVibeLabel, _firstRuleId, _hasMorphed } = s;
      let finalLabel = match.label;

      if (!_hasMorphed) {
        if (!_firstVibeLabel) {
          // First vibe label ever in this session
          _firstVibeLabel = match.label;
          _firstRuleId = match.matchedRuleId;
        } else if (match.matchedRuleId !== _firstRuleId) {
          // A different rule matched — check if secondary genre is significant
          if (hasSignificantSecondary(newDist)) {
            finalLabel = `${_firstVibeLabel} meets ${match.label}`;
            _hasMorphed = true;
          }
          // If secondary not significant enough, just use the new dominant label
        }
      }
      // After morphing, stick with whatever was last set (don't morph again)

      return {
        saves: newSaves,
        genreDistribution: newDist,
        vibeLabel: finalLabel,
        vibeKeywords: match.keywords,
        vibeStage: stage,
        exportReady: saveCount >= 10,
        playedTrackIds: [...s.playedTrackIds, track.id],
        _firstVibeLabel,
        _firstRuleId,
        _hasMorphed,
      };
    });
  },

  addSkip: (track) => {
    set((s) => ({
      skips: [...s.skips, track],
      playedTrackIds: [...s.playedTrackIds, track.id],
    }));
  },

  resetSession: () => {
    set(freshState());
  },

  setVibeFromPast: (label, keywords, genres) => {
    set((s) => ({
      ...s,
      vibeLabel: label,
      vibeKeywords: keywords,
      genreDistribution: genres,
      _firstVibeLabel: label,
      _firstRuleId: null,
      _hasMorphed: false,
    }));
  },
}));
