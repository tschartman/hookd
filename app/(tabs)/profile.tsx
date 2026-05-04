import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import CollectionCard from '@/src/components/CollectionCard';
import { useCollections } from '@/src/hooks/useCollections';
import {
  DISCOVERY,
  SCOPES,
  exchangeCodeForTokens,
  makeRedirectUri,
} from '@/src/services/spotify';
import { useUserStore } from '@/src/stores/userStore';
import type { YouTubeTokenSet } from '@/src/services/youtubeMusic';

// ─── Google OAuth credentials ─────────────────────────────────────────────────
// Evaluated once at module load so the sub-component below can check them
// before mounting without violating rules-of-hooks.

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

/** True only when the platform-appropriate Google client ID is configured. */
const YOUTUBE_AUTH_CONFIGURED =
  Platform.OS === 'ios' ? !!GOOGLE_IOS_CLIENT_ID : !!GOOGLE_ANDROID_CLIENT_ID;

// ─── YouTube Music connect button ─────────────────────────────────────────────
// Isolated into its own component because Google.useAuthRequest() throws an
// invariant if the platform-appropriate client ID is undefined. Keeping the
// hook here means it only runs when credentials are actually present.

function YouTubeMusicConnectButton({
  onSuccess,
}: {
  onSuccess: (tokens: YouTubeTokenSet) => void;
}) {
  const [ytRequest, ytResponse, ytPromptAsync] = Google.useAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    scopes: ['https://www.googleapis.com/auth/youtube'],
  });

  useEffect(() => {
    if (ytResponse?.type === 'success' && ytResponse.authentication) {
      const { accessToken, refreshToken, expiresIn } = ytResponse.authentication;
      onSuccess({
        accessToken,
        refreshToken: refreshToken ?? '',
        expiresAt: Date.now() + (expiresIn ?? 3600) * 1000,
      });
    }
  }, [ytResponse, onSuccess]);

  return (
    <Pressable
      onPress={() => ytPromptAsync()}
      disabled={!ytRequest}
      style={({ pressed }) => [
        styles.connectBtn,
        pressed && { opacity: 0.75 },
        !ytRequest && { opacity: 0.5 },
      ]}
    >
      <Text style={styles.connectBtnText}>Connect</Text>
    </Pressable>
  );
}

// ─── Discovery Library (authenticated view) ───────────────────────────────────

function DiscoveryLibrary({ onLogout }: { onLogout: () => void }) {
  const insets = useSafeAreaInsets();
  const profile = useUserStore((s) => s.profile)!;
  const { collections, isLoading } = useCollections();

  const collectionCount = collections.length;
  const avatarUrl = profile.images?.[0]?.url;

  // ── Apple Music ────────────────────────────────────────────────────────────
  const appleMusicConnected = useUserStore((s) => s.appleMusicConnected);
  const appleMusicConnecting = useUserStore((s) => s.appleMusicConnecting);
  const connectAppleMusic = useUserStore((s) => s.connectAppleMusic);
  const disconnectAppleMusic = useUserStore((s) => s.disconnectAppleMusic);

  // ── YouTube Music ──────────────────────────────────────────────────────────
  const youtubeMusicConnected = useUserStore((s) => s.youtubeMusicConnected);
  const onYouTubeAuthSuccess = useUserStore((s) => s.onYouTubeAuthSuccess);
  const disconnectYouTubeMusic = useUserStore((s) => s.disconnectYouTubeMusic);

  // ── Error (service connection failures) ───────────────────────────────────
  const error = useUserStore((s) => s.error);
  const clearError = useUserStore((s) => s.clearError);

  return (
    <ScrollView
      style={styles.libContainer}
      contentContainerStyle={[
        styles.libContent,
        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Screen title ──────────────────────────────────────────────────────── */}
      <Text style={styles.screenTitle}>Library</Text>

      {/* ── Error banner (service connection errors) ──────────────────────────── */}
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={clearError}>
            <Text style={styles.errorDismiss}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      {/* ── Account Header ────────────────────────────────────────────────────── */}
      <View style={styles.accountHeader}>
        <View style={styles.accountLeft}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.headerAvatar} />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder]}>
              <Text style={styles.headerAvatarInitial}>
                {(profile.display_name ?? profile.email ?? 'U')[0].toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.accountInfo}>
            <Text style={styles.accountName} numberOfLines={1}>
              {profile.display_name ?? 'Spotify User'}
            </Text>
            <View style={styles.connectedRow}>
              <View style={styles.connectedDot} />
              <Text style={styles.connectedText}>Spotify connected</Text>
            </View>
          </View>
        </View>

        <Pressable
          onPress={onLogout}
          style={({ pressed }) => [styles.signOutBtn, pressed && { opacity: 0.7 }]}
          hitSlop={8}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      {/* ── Your Collections ──────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>YOUR COLLECTIONS</Text>
          {collectionCount > 0 && (
            <Text style={styles.sectionCount}>{collectionCount}</Text>
          )}
        </View>

        {isLoading ? (
          <ActivityIndicator color={C.green} style={{ marginVertical: 24 }} />
        ) : collections.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              Start discovering music to build your collection.
            </Text>
          </View>
        ) : (
          <View style={styles.collectionList}>
            {collections.map((col) => (
              <CollectionCard key={col.slug} collection={col} />
            ))}
          </View>
        )}
      </View>

      {/* ── Connected Services ────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>CONNECTED SERVICES</Text>
        </View>

        <View style={styles.serviceList}>
          {/* Spotify — always connected when this view is shown */}
          <View style={styles.serviceRow}>
            <View style={[styles.serviceIcon, { backgroundColor: C.green }]}>
              <Text style={styles.serviceIconText}>♫</Text>
            </View>
            <Text style={styles.serviceName}>Spotify</Text>
            <View style={styles.connectedBadge}>
              <Text style={styles.connectedBadgeText}>Connected</Text>
            </View>
          </View>

          {/* Apple Music */}
          <View style={styles.serviceRow}>
            <View style={[styles.serviceIcon, { backgroundColor: '#FC3C44' }]}>
              <Text style={styles.serviceIconText}>♪</Text>
            </View>
            <Text style={styles.serviceName}>Apple Music</Text>
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonText}>Coming Soon</Text>
            </View>
          </View>

          {/* YouTube Music */}
          <View style={[styles.serviceRow, styles.serviceRowLast]}>
            <View style={[styles.serviceIcon, { backgroundColor: '#FF0000' }]}>
              <Text style={styles.serviceIconText}>▶</Text>
            </View>
            <Text style={styles.serviceName}>YouTube Music</Text>
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonText}>Coming Soon</Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

// ─── Screen root ──────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const {
    isAuthenticated,
    isLoading,
    isRestoringSession,
    profile,
    error,
    onAuthSuccess,
    logout,
    clearError,
    restoreSession,
  } = useUserStore();

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  const redirectUri = makeRedirectUri();
  const codeVerifierRef = useRef<string>('');

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '',
      scopes: SCOPES,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
    },
    DISCOVERY,
  );

  useEffect(() => {
    if (response?.type === 'success') {
      const { code } = response.params;
      const codeVerifier = request?.codeVerifier ?? codeVerifierRef.current;
      if (!code || !codeVerifier) return;
      exchangeCodeForTokens(code, codeVerifier, redirectUri)
        .then((tokens) => onAuthSuccess(tokens))
        .catch((err) =>
          useUserStore.setState({
            error: err instanceof Error ? err.message : 'Authentication failed',
            isLoading: false,
          }),
        );
    }
    if (response?.type === 'error') {
      useUserStore.setState({
        error: response.error?.message ?? 'Authentication cancelled',
      });
    }
  }, [response]);

  if (isRestoringSession) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.green} />
      </View>
    );
  }

  if (isAuthenticated && profile) {
    return <DiscoveryLibrary onLogout={logout} />;
  }

  // ── Login screen ──────────────────────────────────────────────────────────
  return (
    <View style={styles.loginContainer}>
      <View style={styles.heroSection}>
        <Text style={styles.logo}>HOOKD</Text>
        <Text style={styles.tagline}>Discover your next favourite song.</Text>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={clearError}>
            <Text style={styles.errorDismiss}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.connectButton,
          pressed && styles.buttonPressed,
          (!request || isLoading) && styles.buttonDisabled,
        ]}
        onPress={() => promptAsync()}
        disabled={!request || isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.connectText}>Connect with Spotify</Text>
        )}
      </Pressable>

      <Text style={styles.disclaimer}>
        HOOKD uses Spotify to stream 30-second song previews. No Spotify Premium required.
      </Text>
    </View>
  );
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg: '#0A0A0A',
  surface: '#141414',
  border: 'rgba(255,255,255,0.07)',
  green: '#1DB954',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.45)',
  error: '#FF4D4D',
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Shared ────────────────────────────────────────────────────────────────
  centered: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Login screen ─────────────────────────────────────────────────────────
  loginContainer: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 24,
  },
  heroSection: {
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  logo: {
    fontFamily: 'SpaceMono',
    fontSize: 40,
    fontWeight: '700',
    color: C.green,
    letterSpacing: 4,
  },
  tagline: {
    fontSize: 16,
    color: C.muted,
    textAlign: 'center',
  },
  connectButton: {
    backgroundColor: C.green,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 50,
    width: '100%',
    alignItems: 'center',
  },
  connectText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  buttonPressed: { opacity: 0.75 },
  buttonDisabled: { opacity: 0.5 },
  disclaimer: {
    fontSize: 12,
    color: C.muted,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorBanner: {
    backgroundColor: '#2A0A0A',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  errorText: { color: C.error, fontSize: 13, flex: 1 },
  errorDismiss: { color: C.muted, fontSize: 13 },

  // Screen title
  screenTitle: {
    color: C.text,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 4,
  },

  // ── Discovery Library ─────────────────────────────────────────────────────
  libContainer: {
    flex: 1,
    backgroundColor: C.bg,
  },
  libContent: {
    paddingHorizontal: 16,
    gap: 32,
  },

  // Account header
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  accountLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  headerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    flexShrink: 0,
  },
  headerAvatarPlaceholder: {
    backgroundColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarInitial: {
    color: C.text,
    fontSize: 18,
    fontWeight: '700',
  },
  accountInfo: { flex: 1, minWidth: 0, gap: 3 },
  accountName: {
    color: C.text,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  connectedRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  connectedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.green,
  },
  connectedText: { color: C.green, fontSize: 12, fontWeight: '600' },
  signOutBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  signOutText: { color: C.muted, fontSize: 13 },

  // Sections
  section: { gap: 14 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: C.muted,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'SpaceMono',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sectionCount: {
    color: C.muted,
    fontSize: 14,
    fontFamily: 'SpaceMono',
  },

  // Empty state
  emptyState: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyText: {
    color: C.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },

  // Collections
  collectionList: { gap: 10 },

  // Services
  serviceList: { gap: 0 },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  serviceRowLast: {
    borderBottomWidth: 0,
  },
  serviceIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceIconText: { color: '#FFF', fontSize: 18 },
  serviceName: { flex: 1, color: C.text, fontSize: 15, fontWeight: '600' },
  connectedBadge: {
    backgroundColor: 'rgba(29,185,84,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  connectedBadgeText: { color: C.green, fontSize: 12, fontWeight: '700' },
  connectBtn: {
    backgroundColor: C.green,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    minWidth: 70,
    alignItems: 'center',
  },
  connectBtnText: { color: '#000', fontSize: 12, fontWeight: '700' },
  disconnectBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  disconnectBtnText: { color: C.muted, fontSize: 12, fontWeight: '600' },

  comingSoonBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  comingSoonText: { color: C.muted, fontSize: 12, fontWeight: '600' },
});
