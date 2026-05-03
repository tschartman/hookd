import { useUserStore } from '@/src/stores/userStore';
import {
  searchTracks,
  createPlaylist as spotifyCreatePlaylist,
  addTracksToPlaylist,
} from './spotify';
import { matchAppleMusicTrack, createAppleMusicPlaylist } from './appleMusic';
import {
  matchYouTubeTrack,
  createYouTubePlaylist,
  addVideoToYouTubePlaylist,
} from './youtubeMusic';

// ─── Interface ────────────────────────────────────────────────────────────────

export type ServiceId = 'spotify' | 'apple_music' | 'youtube_music';

export interface StreamingService {
  id: ServiceId;
  name: string;
  /** Brand color for UI. */
  color: string;
  isConnected: () => boolean;
  /**
   * Search for a track and return a service-specific opaque ID.
   * Returns null if not found or on network error.
   */
  matchTrack: (trackName: string, artistName: string) => Promise<string | null>;
  /**
   * Create a playlist containing the pre-matched IDs.
   * Returns a URL that can be opened with Linking.openURL.
   */
  createPlaylist: (name: string, description: string, matchedIds: string[]) => Promise<string>;
}

// ─── Spotify ──────────────────────────────────────────────────────────────────

const spotifyService: StreamingService = {
  id: 'spotify',
  name: 'Spotify',
  color: '#1DB954',
  isConnected: () => useUserStore.getState().isAuthenticated,
  matchTrack: async (trackName, artistName) => {
    try {
      const result = await searchTracks(`${trackName} ${artistName}`, 1);
      const hit = result.tracks.items[0];
      return hit ? `spotify:track:${hit.id}` : null;
    } catch {
      return null;
    }
  },
  createPlaylist: async (name, description, uris) => {
    const playlist = await spotifyCreatePlaylist(name, description);
    if (uris.length > 0) await addTracksToPlaylist(playlist.id, uris);
    return playlist.external_urls.spotify;
  },
};

// ─── Apple Music ──────────────────────────────────────────────────────────────

const appleMusicService: StreamingService = {
  id: 'apple_music',
  name: 'Apple Music',
  color: '#FC3C44',
  isConnected: () => useUserStore.getState().appleMusicConnected,
  matchTrack: matchAppleMusicTrack,
  createPlaylist: createAppleMusicPlaylist,
};

// ─── YouTube Music ────────────────────────────────────────────────────────────

const youtubeMusicService: StreamingService = {
  id: 'youtube_music',
  name: 'YouTube Music',
  color: '#FF0000',
  isConnected: () => useUserStore.getState().youtubeMusicConnected,
  matchTrack: matchYouTubeTrack,
  createPlaylist: async (name, description, videoIds) => {
    const playlistId = await createYouTubePlaylist(name, description);
    for (const videoId of videoIds) {
      await addVideoToYouTubePlaylist(playlistId, videoId);
      // YouTube requires one insert per item — 100 ms gap respects quota limits
      await new Promise((r) => setTimeout(r, 100));
    }
    return `https://music.youtube.com/playlist?list=${playlistId}`;
  },
};

// ─── Registry ─────────────────────────────────────────────────────────────────

const SERVICES: Record<ServiceId, StreamingService> = {
  spotify: spotifyService,
  apple_music: appleMusicService,
  youtube_music: youtubeMusicService,
};

export function getService(id: ServiceId): StreamingService {
  return SERVICES[id];
}

/** Returns all services that currently report isConnected() === true. */
export function getConnectedServices(): StreamingService[] {
  return Object.values(SERVICES).filter((s) => s.isConnected());
}
