// ─── useSessionVibe ───────────────────────────────────────────────────────────
// Thin wrapper around sessionStore — the single import point for feed screens.

import { useSessionStore, type VibeStage } from '@/src/stores/sessionStore';
import type { SpotifyTrack } from '@/src/services/spotify';

export type { VibeStage };

export function useSessionVibe() {
  const {
    saves,
    vibeStage,
    vibeLabel,
    vibeKeywords,
    genreDistribution,
    playedTrackIds,
    exportReady,
    addSave,
    addSkip,
    resetSession,
  } = useSessionStore();

  return {
    vibeStage,
    vibeLabel,
    vibeKeywords,
    genreDistribution,
    playedTrackIds,
    saveCount: saves.length,
    exportReady,

    /** Call when user saves (hearts) a track. */
    addSave: (track: SpotifyTrack) => addSave(track),

    /** Call when user scrolls past a track without saving. */
    addSkip: (track: SpotifyTrack) => addSkip(track),

    /** Reset to blank slate (call before saving to Past Vibes). */
    resetSession,
  };
}
