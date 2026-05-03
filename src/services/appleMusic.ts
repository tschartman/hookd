import { Linking } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const API_BASE = 'https://api.music.apple.com/v1';

const KEYS = {
  MUSIC_USER_TOKEN: 'apple_music_user_token',
  DEV_TOKEN: 'apple_music_dev_token',
  DEV_TOKEN_EXPIRES: 'apple_music_dev_token_exp',
} as const;

// ─── Token Storage ────────────────────────────────────────────────────────────

export async function saveMusicUserToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.MUSIC_USER_TOKEN, token);
}

export async function loadMusicUserToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.MUSIC_USER_TOKEN);
}

export async function clearAppleMusicTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.MUSIC_USER_TOKEN),
    SecureStore.deleteItemAsync(KEYS.DEV_TOKEN),
    SecureStore.deleteItemAsync(KEYS.DEV_TOKEN_EXPIRES),
  ]);
}

// ─── Developer Token (from Supabase Edge Function) ───────────────────────────

export async function getDeveloperToken(): Promise<string> {
  // Return cached token if still valid (with 60 s buffer)
  const [cached, expiresStr] = await Promise.all([
    SecureStore.getItemAsync(KEYS.DEV_TOKEN),
    SecureStore.getItemAsync(KEYS.DEV_TOKEN_EXPIRES),
  ]);
  if (cached && expiresStr && Date.now() < Number(expiresStr) - 60_000) {
    console.log('[AppleMusic] getDeveloperToken: returning cached token (expires', new Date(Number(expiresStr)).toISOString(), ')');
    return cached;
  }

  const url = `${SUPABASE_URL}/functions/v1/apple-music-token`;
  console.log('[AppleMusic] getDeveloperToken: fetching from', url);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  console.log('[AppleMusic] getDeveloperToken: response status', res.status);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[AppleMusic] getDeveloperToken: failed -', res.status, body);
    throw new Error(`Apple Music developer token fetch failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as { token?: string; expiresIn?: number };
  console.log('[AppleMusic] getDeveloperToken: response keys', Object.keys(json));

  const { token, expiresIn } = json;
  if (!token) {
    console.error('[AppleMusic] getDeveloperToken: response had no token field:', json);
    throw new Error('Apple Music developer token response missing "token" field');
  }

  const expiresAt = Date.now() + (expiresIn ?? 3600) * 1000;

  await Promise.all([
    SecureStore.setItemAsync(KEYS.DEV_TOKEN, token),
    SecureStore.setItemAsync(KEYS.DEV_TOKEN_EXPIRES, String(expiresAt)),
  ]);

  console.log('[AppleMusic] getDeveloperToken: new token cached, expires', new Date(expiresAt).toISOString());
  return token;
}

// ─── User Authorization ───────────────────────────────────────────────────────

/**
 * Opens Apple Music authorization via MusicKit JS in a plain SFSafariViewController.
 *
 * Why not openAuthSessionAsync (ASWebAuthenticationSession)?
 *   MusicKit JS's music.authorize() internally opens its own ASWebAuth-
 *   enticationSession for Apple's sign-in sheet. iOS forbids nesting two
 *   ASWebAuthenticationSessions → the outer one gets cancelled (error 1).
 *
 * Instead we use openBrowserAsync (plain SFSafariViewController), which CAN
 * host a nested ASWebAuthenticationSession. When MusicKit JS completes auth
 * it does window.location = appRedirectUri?music-token=MUT. SFSafariViewController
 * hands the custom scheme to iOS, which fires Linking's 'url' event in the app.
 */
export function authorizeAppleMusic(): Promise<string | null> {
  // Warm the local developer-token cache in parallel (needed for API calls later).
  getDeveloperToken().catch(() => {});

  const appRedirectUri = makeRedirectUri({
    scheme: 'hookd',
    path: 'apple-music-callback',
  });

  const authUrl =
    `https://tschartman.github.io/hookd-pages/apple-music-auth.html` +
    `?platform_redirect=${encodeURIComponent(appRedirectUri)}`;

  // Base URL to match (strip any query params from appRedirectUri for prefix check)
  const redirectBase = appRedirectUri.split('?')[0];

  console.log('[AppleMusic] authorizeAppleMusic: appRedirectUri =', appRedirectUri);
  console.log('[AppleMusic] authorizeAppleMusic: opening MusicKit auth page (SFSafariVC)...');

  return new Promise((resolve) => {
    let settled = false;

    const settle = (mut: string | null) => {
      if (settled) return;
      settled = true;
      linkingSub.remove();
      // Browser may already be gone (iOS dismissed it on deep-link open), but
      // calling dismissBrowser() is safe when there's nothing to dismiss.
      WebBrowser.dismissBrowser();
      resolve(mut);
    };

    // ── Listen for the deep-link redirect from MusicKit JS ───────────────────
    const linkingSub = Linking.addEventListener('url', ({ url }) => {
      if (!url.startsWith(redirectBase)) return;
      console.log('[AppleMusic] Linking: received redirect URL =', url);

      let mut: string | null = null;

      try {
        const parsed = new URL(url);

        const authError = parsed.searchParams.get('error');
        if (authError) {
          console.error('[AppleMusic] MusicKit auth page returned error:', authError);
          settle(null);
          return;
        }

        mut =
          parsed.searchParams.get('music-token') ??
          parsed.searchParams.get('mut') ??
          parsed.searchParams.get('music-user-token');

        if (!mut && parsed.hash) {
          const hashParams = new URLSearchParams(parsed.hash.slice(1));
          mut =
            hashParams.get('music-token') ??
            hashParams.get('mut') ??
            hashParams.get('music-user-token');
        }
      } catch {
        const match = url.match(/[?&#](?:music-token|mut|music-user-token)=([^&]+)/);
        mut = match ? decodeURIComponent(match[1]) : null;
      }

      console.log('[AppleMusic] parsed MUT =', mut ? `${mut.slice(0, 12)}…` : null);
      if (!mut) console.error('[AppleMusic] could not extract MUT from:', url);
      settle(mut);
    });

    // ── Open plain SFSafariViewController ────────────────────────────────────
    WebBrowser.openBrowserAsync(authUrl, {
      dismissButtonStyle: 'cancel',
    }).then(() => {
      // Resolves when the browser is dismissed (user tapped Cancel or it closed
      // after the deep-link redirect). If settle() already ran, this is a no-op.
      console.log('[AppleMusic] browser dismissed');
      settle(null);
    }).catch((err) => {
      console.error('[AppleMusic] openBrowserAsync error:', err);
      settle(null);
    });
  });
}

// ─── Storefront ───────────────────────────────────────────────────────────────

/** Derives the two-letter Apple Music storefront code from the device locale. */
export function getStorefront(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const region = locale.split('-')[1]?.toLowerCase();
    return region ?? 'us';
  } catch {
    return 'us';
  }
}

// ─── Fetch Helper ─────────────────────────────────────────────────────────────

async function appleMusicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const developerToken = await getDeveloperToken();
  const musicUserToken = await loadMusicUserToken();
  if (!musicUserToken) throw new Error('Apple Music not authorized');

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${developerToken}`,
      'Music-User-Token': musicUserToken,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Apple Music API ${res.status}: ${path} — ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─── Track Matching ───────────────────────────────────────────────────────────

/** Returns the catalog song ID on success, or null if not found. */
export async function matchAppleMusicTrack(
  trackName: string,
  artistName: string,
): Promise<string | null> {
  const storefront = getStorefront();
  const query = encodeURIComponent(`${trackName} ${artistName}`);
  try {
    const data = await appleMusicFetch<Record<string, any>>(
      `/catalog/${storefront}/search?term=${query}&types=songs&limit=1`,
    );
    return (data.results?.songs?.data as any[])?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ─── Playlist Creation ────────────────────────────────────────────────────────

/**
 * Creates a library playlist and adds all matched songs in a single request.
 * Returns a deep-link URL for opening the playlist in Apple Music.
 */
export async function createAppleMusicPlaylist(
  name: string,
  description: string,
  songIds: string[],
): Promise<string> {
  const body: Record<string, unknown> = {
    attributes: { name, description },
    ...(songIds.length > 0 && {
      relationships: {
        tracks: { data: songIds.map((id) => ({ id, type: 'songs' })) },
      },
    }),
  };

  const data = await appleMusicFetch<Record<string, any>>('/me/library/playlists', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const playlistId = (data.data as any[])?.[0]?.id;
  return `music://music.apple.com/library/playlist/${playlistId}`;
}
