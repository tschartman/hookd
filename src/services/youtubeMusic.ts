import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// ─── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/youtube/v3';

const KEYS = {
  ACCESS_TOKEN: 'yt_access_token',
  REFRESH_TOKEN: 'yt_refresh_token',
  EXPIRES_AT: 'yt_expires_at',
} as const;

// ─── Token Types ──────────────────────────────────────────────────────────────

export type YouTubeTokenSet = {
  accessToken: string;
  /** May be empty if Google didn't issue a refresh token (subsequent authorizations). */
  refreshToken: string;
  expiresAt: number; // unix ms
};

// ─── Token Storage ────────────────────────────────────────────────────────────

export async function saveYouTubeTokens(tokens: YouTubeTokenSet): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, tokens.accessToken),
    SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, tokens.refreshToken),
    SecureStore.setItemAsync(KEYS.EXPIRES_AT, String(tokens.expiresAt)),
  ]);
}

export async function loadYouTubeTokens(): Promise<YouTubeTokenSet | null> {
  const [accessToken, refreshToken, expiresAtStr] = await Promise.all([
    SecureStore.getItemAsync(KEYS.ACCESS_TOKEN),
    SecureStore.getItemAsync(KEYS.REFRESH_TOKEN),
    SecureStore.getItemAsync(KEYS.EXPIRES_AT),
  ]);
  if (!accessToken || !expiresAtStr) return null;
  return { accessToken, refreshToken: refreshToken ?? '', expiresAt: Number(expiresAtStr) };
}

export async function clearYouTubeTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN),
    SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN),
    SecureStore.deleteItemAsync(KEYS.EXPIRES_AT),
  ]);
}

// ─── In-Memory Cache ─────────────────────────────────────────────────────────

let _ytTokens: YouTubeTokenSet | null = null;

export function setInMemoryYouTubeTokens(tokens: YouTubeTokenSet): void {
  _ytTokens = tokens;
}

export function clearInMemoryYouTubeTokens(): void {
  _ytTokens = null;
}

// ─── Token Refresh ────────────────────────────────────────────────────────────

async function refreshYouTubeToken(refreshToken: string): Promise<YouTubeTokenSet> {
  // Use platform-appropriate client ID for installed-app OAuth refresh
  const clientId =
    Platform.OS === 'ios'
      ? (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '')
      : (process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? '');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) throw new Error(`YouTube token refresh failed: ${res.status}`);

  const data = await res.json();
  const tokens: YouTubeTokenSet = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  await saveYouTubeTokens(tokens);
  return tokens;
}

// ─── Active Token ─────────────────────────────────────────────────────────────

/** Returns a valid access token, refreshing it if within 60 s of expiry. */
export async function getValidYouTubeToken(): Promise<string> {
  if (!_ytTokens) {
    _ytTokens = await loadYouTubeTokens();
  }
  if (!_ytTokens) throw new Error('YouTube Music not connected');

  if (Date.now() >= _ytTokens.expiresAt - 60_000) {
    if (!_ytTokens.refreshToken) throw new Error('YouTube Music session expired. Please reconnect.');
    _ytTokens = await refreshYouTubeToken(_ytTokens.refreshToken);
  }

  return _ytTokens.accessToken;
}

// ─── Fetch Helper ─────────────────────────────────────────────────────────────

async function youtubeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getValidYouTubeToken();

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`YouTube API ${res.status}: ${path} — ${text}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Track Matching ───────────────────────────────────────────────────────────

/** Returns the YouTube video ID on success, or null if not found. */
export async function matchYouTubeTrack(
  trackName: string,
  artistName: string,
): Promise<string | null> {
  // Adding "official audio" improves precision for music search.
  // videoCategoryId=10 restricts to Music category.
  const query = encodeURIComponent(`${trackName} ${artistName} official audio`);
  try {
    const data = await youtubeFetch<Record<string, any>>(
      `/search?part=snippet&q=${query}&type=video&videoCategoryId=10&maxResults=1`,
    );
    return (data.items as any[])?.[0]?.id?.videoId ?? null;
  } catch {
    return null;
  }
}

// ─── Playlist Creation ────────────────────────────────────────────────────────

/** Step 1 of 2: create an empty private playlist, returns the playlist ID. */
export async function createYouTubePlaylist(name: string, description: string): Promise<string> {
  const data = await youtubeFetch<Record<string, any>>('/playlists?part=snippet,status', {
    method: 'POST',
    body: JSON.stringify({
      snippet: { title: name, description },
      status: { privacyStatus: 'private' },
    }),
  });
  return data.id as string;
}

/**
 * Step 2 of 2: add a single video to a playlist.
 * YouTube requires one request per item — callers must loop and rate-limit.
 */
export async function addVideoToYouTubePlaylist(
  playlistId: string,
  videoId: string,
): Promise<void> {
  await youtubeFetch<void>('/playlistItems?part=snippet', {
    method: 'POST',
    body: JSON.stringify({
      snippet: {
        playlistId,
        resourceId: { kind: 'youtube#video', videoId },
      },
    }),
  });
}
