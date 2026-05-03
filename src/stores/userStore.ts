import { create } from 'zustand';
import {
  clearInMemoryTokens,
  clearStoredTokens,
  getCurrentUserProfile,
  loadStoredTokens,
  setInMemoryTokens,
  type SpotifyUserProfile,
  type TokenSet,
} from '@/src/services/spotify';
import {
  authorizeAppleMusic,
  clearAppleMusicTokens,
  loadMusicUserToken,
  saveMusicUserToken,
} from '@/src/services/appleMusic';
import {
  clearInMemoryYouTubeTokens,
  clearYouTubeTokens,
  loadYouTubeTokens,
  saveYouTubeTokens,
  setInMemoryYouTubeTokens,
  type YouTubeTokenSet,
} from '@/src/services/youtubeMusic';

// ─── State Shape ──────────────────────────────────────────────────────────────

type UserState = {
  // Spotify
  isAuthenticated: boolean;
  isLoading: boolean;
  /** True while restoring sessions from SecureStore on app launch. */
  isRestoringSession: boolean;
  profile: SpotifyUserProfile | null;
  error: string | null;

  // Apple Music
  appleMusicConnected: boolean;
  appleMusicConnecting: boolean;

  // YouTube Music
  youtubeMusicConnected: boolean;
};

type UserActions = {
  // Spotify
  onAuthSuccess: (tokens: TokenSet) => Promise<void>;
  restoreSession: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;

  // Apple Music
  connectAppleMusic: () => Promise<void>;
  disconnectAppleMusic: () => Promise<void>;

  // YouTube Music
  onYouTubeAuthSuccess: (tokens: YouTubeTokenSet) => Promise<void>;
  disconnectYouTubeMusic: () => Promise<void>;
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useUserStore = create<UserState & UserActions>((set, get) => ({
  // ── Spotify ────────────────────────────────────────────────────────────────
  isAuthenticated: false,
  isLoading: false,
  isRestoringSession: true,
  profile: null,
  error: null,

  onAuthSuccess: async (tokens) => {
    set({ isLoading: true, error: null });
    try {
      setInMemoryTokens(tokens);
      const profile = await getCurrentUserProfile();
      set({ isAuthenticated: true, profile, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load profile',
      });
    }
  },

  restoreSession: async () => {
    set({ isRestoringSession: true });
    try {
      // Restore Spotify
      const stored = await loadStoredTokens();
      if (stored) {
        setInMemoryTokens(stored);
        const profile = await getCurrentUserProfile();
        set({ isAuthenticated: true, profile });
      }
    } catch {
      await clearStoredTokens();
      clearInMemoryTokens();
    }

    // Restore Apple Music (token present = connected)
    try {
      const mut = await loadMusicUserToken();
      if (mut) set({ appleMusicConnected: true });
    } catch {
      // Ignore — token missing or corrupt
    }

    // Restore YouTube Music (tokens present = connected)
    try {
      const ytTokens = await loadYouTubeTokens();
      if (ytTokens) {
        setInMemoryYouTubeTokens(ytTokens);
        set({ youtubeMusicConnected: true });
      }
    } catch {
      // Ignore
    }

    set({ isRestoringSession: false });
  },

  logout: async () => {
    await clearStoredTokens();
    clearInMemoryTokens();
    set({ isAuthenticated: false, profile: null, error: null });
  },

  clearError: () => set({ error: null }),

  // ── Apple Music ────────────────────────────────────────────────────────────
  appleMusicConnected: false,
  appleMusicConnecting: false,

  connectAppleMusic: async () => {
    set({ appleMusicConnecting: true, error: null });
    try {
      console.log('[UserStore] connectAppleMusic: starting');
      const mut = await authorizeAppleMusic();
      console.log('[UserStore] connectAppleMusic: authorizeAppleMusic returned', mut ? 'a token' : 'null');
      if (mut) {
        await saveMusicUserToken(mut);
        set({ appleMusicConnected: true });
        console.log('[UserStore] connectAppleMusic: connected ✓');
      } else {
        console.warn('[UserStore] connectAppleMusic: no MUT returned — user likely cancelled or redirect failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Apple Music connection failed';
      console.error('[UserStore] connectAppleMusic: error —', msg);
      set({ error: msg });
    } finally {
      set({ appleMusicConnecting: false });
    }
  },

  disconnectAppleMusic: async () => {
    await clearAppleMusicTokens();
    set({ appleMusicConnected: false });
  },

  // ── YouTube Music ──────────────────────────────────────────────────────────
  youtubeMusicConnected: false,

  onYouTubeAuthSuccess: async (tokens) => {
    await saveYouTubeTokens(tokens);
    setInMemoryYouTubeTokens(tokens);
    set({ youtubeMusicConnected: true });
  },

  disconnectYouTubeMusic: async () => {
    await clearYouTubeTokens();
    clearInMemoryYouTubeTokens();
    set({ youtubeMusicConnected: false });
  },
}));
