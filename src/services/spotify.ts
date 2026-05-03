import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';

// ─── Constants ───────────────────────────────────────────────────────────────

const CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '';

const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-library-modify',
  'user-library-read',
  'user-top-read',
  'playlist-modify-private',
  'playlist-modify-public',
];

const SECURE_STORE_KEYS = {
  ACCESS_TOKEN: 'spotify_access_token',
  REFRESH_TOKEN: 'spotify_refresh_token',
  EXPIRES_AT: 'spotify_expires_at',
} as const;

const API_BASE = 'https://api.spotify.com/v1';

// ─── Token Storage ────────────────────────────────────────────────────────────

export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
};

async function saveTokens(tokens: TokenSet): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(SECURE_STORE_KEYS.ACCESS_TOKEN, tokens.accessToken),
    SecureStore.setItemAsync(SECURE_STORE_KEYS.REFRESH_TOKEN, tokens.refreshToken),
    SecureStore.setItemAsync(SECURE_STORE_KEYS.EXPIRES_AT, String(tokens.expiresAt)),
  ]);
}

export async function loadStoredTokens(): Promise<TokenSet | null> {
  const [accessToken, refreshToken, expiresAtStr] = await Promise.all([
    SecureStore.getItemAsync(SECURE_STORE_KEYS.ACCESS_TOKEN),
    SecureStore.getItemAsync(SECURE_STORE_KEYS.REFRESH_TOKEN),
    SecureStore.getItemAsync(SECURE_STORE_KEYS.EXPIRES_AT),
  ]);

  if (!accessToken || !refreshToken || !expiresAtStr) return null;

  return {
    accessToken,
    refreshToken,
    expiresAt: Number(expiresAtStr),
  };
}

export async function clearStoredTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SECURE_STORE_KEYS.ACCESS_TOKEN),
    SecureStore.deleteItemAsync(SECURE_STORE_KEYS.REFRESH_TOKEN),
    SecureStore.deleteItemAsync(SECURE_STORE_KEYS.EXPIRES_AT),
  ]);
}

// ─── Token Refresh ────────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  const response = await fetch(DISCOVERY.tokenEndpoint!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data = await response.json();

  const tokens: TokenSet = {
    accessToken: data.access_token,
    // Spotify may not return a new refresh token; keep the existing one
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  await saveTokens(tokens);
  return tokens;
}

// ─── Active Token Management ──────────────────────────────────────────────────

// In-memory cache — avoids repeated SecureStore reads in a session
let _tokens: TokenSet | null = null;

/** Returns a valid access token, refreshing if within 60 s of expiry. */
export async function getValidAccessToken(): Promise<string> {
  if (!_tokens) {
    _tokens = await loadStoredTokens();
  }

  if (!_tokens) {
    throw new Error('Not authenticated. Please log in with Spotify.');
  }

  const bufferMs = 60_000; // refresh 60 s before expiry
  if (Date.now() >= _tokens.expiresAt - bufferMs) {
    _tokens = await refreshAccessToken(_tokens.refreshToken);
  }

  return _tokens.accessToken;
}

export function setInMemoryTokens(tokens: TokenSet): void {
  _tokens = tokens;
}

export function clearInMemoryTokens(): void {
  _tokens = null;
}

// ─── PKCE Auth Flow ───────────────────────────────────────────────────────────

export function makeRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: 'hookd',
    path: 'auth-callback',
  });
}

/**
 * Exchanges the authorization code returned by Spotify for access + refresh tokens.
 * Called after the PKCE redirect completes.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const response = await fetch(DISCOVERY.tokenEndpoint!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Code exchange failed: ${response.status} — ${text}`);
  }

  const data = await response.json();

  const tokens: TokenSet = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  await saveTokens(tokens);
  setInMemoryTokens(tokens);
  return tokens;
}

export { DISCOVERY, SCOPES };

// ─── Typed API Fetch Helper ───────────────────────────────────────────────────

async function spotifyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getValidAccessToken();

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Spotify API error ${response.status}: ${path} — ${body}`);
  }

  // 204 No Content (e.g. saveTrack) has no body
  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}

// ─── Spotify Types ────────────────────────────────────────────────────────────

export type SpotifyImage = { url: string; width: number | null; height: number | null };

export type SpotifyArtist = {
  id: string;
  name: string;
  images: SpotifyImage[];
  genres: string[];
};

export type SpotifyTrack = {
  id: string;
  name: string;
  preview_url: string | null;
  duration_ms: number;
  artists: Pick<SpotifyArtist, 'id' | 'name'>[];
  album: {
    id: string;
    name: string;
    images: SpotifyImage[];
  };
  external_urls: { spotify: string };
  /** Primary genre from iTunes (e.g. "Hip-Hop/Rap", "Electronic", "Alternative"). */
  primaryGenreName?: string;
  /** Festival metadata — populated when the track is sourced from a festival feed. */
  tier?: 'headliner' | 'midtier' | 'opener';
  /** 1-indexed position in the iTunes search results for this artist (1 = most popular). */
  popularity?: number;
  /** Genre tags inherited from the FestivalArtist entry. */
  genres?: string[];
  /** Release year extracted from iTunes releaseDate. Used for era filtering. */
  releaseYear?: number;
};

export type SpotifyAudioFeatures = {
  id: string;
  tempo: number;
  energy: number;
  danceability: number;
  valence: number;
  acousticness: number;
  instrumentalness: number;
  key: number;
  mode: number;
};

export type SpotifyUserProfile = {
  id: string;
  display_name: string | null;
  email: string;
  images: SpotifyImage[];
  country: string;
  product: 'free' | 'premium' | 'open';
};

export type RecommendationsParams = {
  seed_tracks?: string[];
  seed_artists?: string[];
  seed_genres?: string[];
  limit?: number;
  target_energy?: number;
  target_danceability?: number;
  target_valence?: number;
};

// ─── API Methods ──────────────────────────────────────────────────────────────

export async function getCurrentUserProfile(): Promise<SpotifyUserProfile> {
  return spotifyFetch<SpotifyUserProfile>('/me');
}

export async function getRecommendations(
  params: RecommendationsParams,
): Promise<{ tracks: SpotifyTrack[] }> {
  const query = new URLSearchParams();

  if (params.seed_tracks?.length) query.set('seed_tracks', params.seed_tracks.join(','));
  if (params.seed_artists?.length) query.set('seed_artists', params.seed_artists.join(','));
  if (params.seed_genres?.length) query.set('seed_genres', params.seed_genres.join(','));
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.target_energy !== undefined) query.set('target_energy', String(params.target_energy));
  if (params.target_danceability !== undefined)
    query.set('target_danceability', String(params.target_danceability));
  if (params.target_valence !== undefined)
    query.set('target_valence', String(params.target_valence));

  return spotifyFetch(`/recommendations?${query.toString()}`);
}

export async function getTrack(id: string): Promise<SpotifyTrack> {
  return spotifyFetch<SpotifyTrack>(`/tracks/${id}`);
}

export async function getAudioFeatures(id: string): Promise<SpotifyAudioFeatures> {
  return spotifyFetch<SpotifyAudioFeatures>(`/audio-features/${id}`);
}

export async function searchTracks(
  query: string,
  limit = 10,
): Promise<{ tracks: { items: SpotifyTrack[] } }> {
  // Feb 2026: Spotify search max limit is 10 per item type.
  const safeLimit = Math.min(Math.max(1, limit), 10);
  const params = new URLSearchParams({ q: query, type: 'track', limit: String(safeLimit) });
  return spotifyFetch(`/search?${params.toString()}`);
}

export async function getArtistTopTracks(
  artistId: string,
  market = 'US',
): Promise<{ tracks: SpotifyTrack[] }> {
  return spotifyFetch(`/artists/${artistId}/top-tracks?market=${market}`);
}

/** Save items to the user's Spotify library (Feb 2026 API). */
export async function saveTrack(trackId: string): Promise<void> {
  await spotifyFetch<void>('/me/library', {
    method: 'PUT',
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
  });
}

/** Remove items from the user's Spotify library (Feb 2026 API). */
export async function removeSavedTrack(trackId: string): Promise<void> {
  await spotifyFetch<void>('/me/library', {
    method: 'DELETE',
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
  });
}

/** Check if tracks are saved in the user's library (Feb 2026 API). */
export async function checkSavedTracks(trackIds: string[]): Promise<boolean[]> {
  const uris = trackIds.map((id) => `spotify:track:${id}`).join(',');
  return spotifyFetch<boolean[]>(`/me/library/contains?uris=${encodeURIComponent(uris)}`);
}

/** Create a playlist for the current user (Feb 2026 API). */
export async function createPlaylist(
  name: string,
  description?: string,
): Promise<{ id: string; external_urls: { spotify: string } }> {
  return spotifyFetch('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name, description: description ?? '', public: false }),
  });
}

/** Add items to a playlist. Batches automatically at 100 per request (Feb 2026 API). */
export async function addTracksToPlaylist(
  playlistId: string,
  uris: string[],
): Promise<void> {
  for (let i = 0; i < uris.length; i += 100) {
    await spotifyFetch<void>(`/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
    });
  }
}

export async function getUserTopTracks(
  limit = 20,
  timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term',
): Promise<{ items: SpotifyTrack[] }> {
  return spotifyFetch(`/me/top/tracks?limit=${limit}&time_range=${timeRange}`);
}

/**
 * Discovery feed replacement for the deprecated /recommendations endpoint.
 *
 * Searches by genre using a random offset so repeated calls return fresh
 * results. Filters out tracks with null preview_url before returning.
 */
export async function discoverTracks(
  genres: string[],
  limit = 20,
): Promise<SpotifyTrack[]> {
  // Spotify search limit is 0–10 per item type per the current API spec.
  const safeLimit = Math.min(Math.max(1, limit), 10);

  // Shuffle genres and pick enough to cover the requested limit.
  // We fetch 3 genres in parallel; each can contribute up to safeLimit tracks.
  const shuffled = [...genres].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 3);

  const fetchGenre = async (genre: string) => {
    // Random offset gives variety across repeated calls
    const offset = Math.floor(Math.random() * 50) * safeLimit;
    const url =
      `/search?q=${encodeURIComponent(genre)}&type=track&limit=${safeLimit}&offset=${offset}`;
    try {
      const result = await spotifyFetch<{ tracks: { items: SpotifyTrack[] } }>(url);
      const all = result.tracks.items;
      const withPreview = all.filter((t) => !!t.preview_url);
      console.log(`[discover] genre="${genre}" total=${all.length} withPreview=${withPreview.length}`);
      return withPreview;
    } catch (err) {
      console.warn(`[discover] genre="${genre}" fetch failed:`, err);
      return [];
    }
  };

  const batches = await Promise.all(selected.map(fetchGenre));

  // Interleave so the feed alternates genres
  const combined: SpotifyTrack[] = [];
  const max = Math.max(...batches.map((b) => b.length));
  for (let i = 0; i < max; i++) {
    for (const batch of batches) {
      if (batch[i]) combined.push(batch[i]);
    }
  }
  return combined;
}
