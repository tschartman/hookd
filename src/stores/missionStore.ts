import { create } from 'zustand';

import type { SpotifyTrack } from '@/src/services/spotify';
import type { EnergyTarget } from '@/src/data/missionTemplates';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MissionTrack {
  itunesTrackId: string;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  previewUrl: string;
  genre: string;
  addedAt: Date;
  order: number;
}

/** Vibe selections from the vibe screen (Screen 2). */
export interface MissionVibeProfile {
  selectedGenres: string[];        // 1-5 genres the user picked
  selectedEras: string[];          // e.g. ['90s', '00s']; empty = "Any era"
  soundsLikeArtists: string[];     // 0-2 artist names
}

/**
 * Optional genre/era/sounds-like filter applied from the swipe screen.
 * null = no filter (default) → use pure activity-tagged tracks.
 * set  = use gold/silver/bronze tiering against these genres+eras.
 */
export interface MissionFilter {
  genres: string[];            // 1-5 genres (lowercase, matching genre_era_artists)
  eras: string[];              // e.g. ['90s', '00s']; empty = all eras
  soundsLikeArtists: string[]; // 0-2 artist names
}

export interface Mission {
  id: string;
  templateId: string;
  name: string;
  icon: string;
  /** Template's hard-exclude tags (never queried). */
  excludeTags: string[];
  /** Fallback seed artists used when user skips the vibe screen. */
  fallbackSeedArtists: string[];
  /** Fallback MB tags used when user skips the vibe screen. */
  fallbackMusicbrainzTags: string[];
  energyTarget: EnergyTarget;
  suggestedCount: number;
  /** Vibe selections — null means user tapped "Skip — surprise me". */
  vibeProfile: MissionVibeProfile | null;
  /**
   * Optional filter applied from the swipe screen filter sheet.
   * null = default (pure activity-tagged tracks, no genre constraint).
   */
  filter: MissionFilter | null;
  lineup: MissionTrack[];
  /** iTunes track IDs that were left-swiped. */
  skipped: string[];
  /** Normalized genre counts from right-swiped tracks. */
  genreDistribution: Record<string, number>;
  startedAt: Date;
  completedAt?: Date;
  exportedPlaylistUrl?: string;
  status: 'active' | 'completed' | 'exported';
}

// ─── State ────────────────────────────────────────────────────────────────────

type MissionState = {
  missions: Record<string, Mission>;
  activeMissionId: string | null;
};

type MissionActions = {
  createMission: (
    params: Omit<Mission, 'id' | 'lineup' | 'skipped' | 'genreDistribution' | 'startedAt' | 'status' | 'filter'>,
  ) => string;
  addToLineup: (missionId: string, track: SpotifyTrack) => void;
  addSkipped: (missionId: string, trackId: string) => void;
  removeFromLineup: (missionId: string, itunesTrackId: string) => void;
  reorderLineup: (missionId: string, lineup: MissionTrack[]) => void;
  completeMission: (missionId: string) => void;
  setExportedUrl: (missionId: string, url: string) => void;
  getMission: (id: string) => Mission | undefined;
  getActiveMission: () => Mission | undefined;
  setActiveMission: (id: string | null) => void;
  setMissionFilter: (missionId: string, filter: MissionFilter | null) => void;
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useMissionStore = create<MissionState & MissionActions>((set, get) => ({
  missions: {},
  activeMissionId: null,

  createMission: (params) => {
    const id = `mission_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const mission: Mission = {
      ...params,
      id,
      lineup: [],
      skipped: [],
      genreDistribution: {},
      filter: null,
      startedAt: new Date(),
      status: 'active',
    };
    set((s) => ({
      missions: { ...s.missions, [id]: mission },
      activeMissionId: id,
    }));
    return id;
  },

  addToLineup: (missionId, track) => {
    set((s) => {
      const mission = s.missions[missionId];
      if (!mission) return s;

      // No duplicates in lineup
      if (mission.lineup.some((t) => t.itunesTrackId === track.id)) return s;

      const missionTrack: MissionTrack = {
        itunesTrackId: track.id,
        trackName: track.name,
        artistName: track.artists[0]?.name ?? 'Unknown Artist',
        artworkUrl: track.album?.images?.[0]?.url ?? '',
        previewUrl: track.preview_url ?? '',
        genre: track.primaryGenreName ?? track.genres?.[0] ?? '',
        addedAt: new Date(),
        order: mission.lineup.length,
      };

      // Update genre distribution
      const genreKey = missionTrack.genre.toLowerCase();
      const dist = { ...mission.genreDistribution };
      dist[genreKey] = (dist[genreKey] ?? 0) + 1;

      return {
        missions: {
          ...s.missions,
          [missionId]: {
            ...mission,
            lineup: [...mission.lineup, missionTrack],
            genreDistribution: dist,
          },
        },
      };
    });
  },

  addSkipped: (missionId, trackId) => {
    set((s) => {
      const mission = s.missions[missionId];
      if (!mission) return s;
      return {
        missions: {
          ...s.missions,
          [missionId]: {
            ...mission,
            skipped: [...mission.skipped, trackId],
          },
        },
      };
    });
  },

  removeFromLineup: (missionId, itunesTrackId) => {
    set((s) => {
      const mission = s.missions[missionId];
      if (!mission) return s;
      const lineup = mission.lineup
        .filter((t) => t.itunesTrackId !== itunesTrackId)
        .map((t, i) => ({ ...t, order: i }));
      return {
        missions: {
          ...s.missions,
          [missionId]: { ...mission, lineup },
        },
      };
    });
  },

  reorderLineup: (missionId, lineup) => {
    set((s) => {
      const mission = s.missions[missionId];
      if (!mission) return s;
      return {
        missions: { ...s.missions, [missionId]: { ...mission, lineup } },
      };
    });
  },

  completeMission: (missionId) => {
    set((s) => {
      const mission = s.missions[missionId];
      if (!mission) return s;
      return {
        missions: {
          ...s.missions,
          [missionId]: { ...mission, status: 'completed', completedAt: new Date() },
        },
      };
    });
  },

  setExportedUrl: (missionId, url) => {
    set((s) => {
      const mission = s.missions[missionId];
      if (!mission) return s;
      return {
        missions: {
          ...s.missions,
          [missionId]: { ...mission, exportedPlaylistUrl: url, status: 'exported' },
        },
      };
    });
  },

  getMission: (id) => get().missions[id],

  getActiveMission: () => {
    const { activeMissionId, missions } = get();
    return activeMissionId ? missions[activeMissionId] : undefined;
  },

  setActiveMission: (id) => set({ activeMissionId: id }),

  setMissionFilter: (missionId, filter) => {
    set((s) => {
      const mission = s.missions[missionId];
      if (!mission) return s;
      return {
        missions: { ...s.missions, [missionId]: { ...mission, filter } },
      };
    });
  },
}));
