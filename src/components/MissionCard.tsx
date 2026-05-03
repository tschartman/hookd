import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

import WaveformViz from '@/src/components/WaveformViz';
import type { SpotifyTrack } from '@/src/services/spotify';
import { usePlayerStore } from '@/src/stores/playerStore';

// ─── Constants ────────────────────────────────────────────────────────────────

const SWIPE_THRESHOLD = 120; // px at which glow reaches full intensity

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACCENT_PALETTE = [
  '#1DB954', // green
  '#E91E8C', // pink
  '#FF6B35', // orange
  '#7B2FBE', // purple
  '#00B4D8', // cyan
  '#F72585', // magenta
  '#3A86FF', // blue
  '#FFBE0B', // amber
];

function accentFromTrackId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return ACCENT_PALETTE[hash % ACCENT_PALETTE.length];
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  track: SpotifyTrack;
  /** Only passed for the top card — drives the edge glow & SAVE/SKIP labels. */
  translateX?: SharedValue<number>;
  isActive: boolean;
  progress: number;
  onSeek?: (fraction: number) => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function MissionCard({ track, translateX, isActive, progress, onSeek }: Props) {
  const albumArt = track.album?.images?.[0]?.url;
  const artistName = track.artists.map((a) => a.name).join(', ');
  const genre = track.primaryGenreName ?? track.genres?.[0] ?? '';
  const accentColor = accentFromTrackId(track.id);

  const isLoadingAudio = usePlayerStore((s) => s.isLoadingAudio);
  const handleSeek = isActive ? onSeek : undefined;

  // ── Right-swipe green glow (save) ────────────────────────────────────────
  const saveGlowStyle = useAnimatedStyle(() => {
    if (!translateX) return { opacity: 0 };
    return {
      opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
    };
  });

  // ── Left-swipe red tint (skip) ───────────────────────────────────────────
  const skipTintStyle = useAnimatedStyle(() => {
    if (!translateX) return { opacity: 0 };
    return {
      opacity: interpolate(
        translateX.value,
        [-SWIPE_THRESHOLD, 0],
        [1, 0],
        Extrapolation.CLAMP,
      ),
    };
  });

  // ── SAVE label opacity ───────────────────────────────────────────────────
  const saveLabelStyle = useAnimatedStyle(() => {
    if (!translateX) return { opacity: 0 };
    return {
      opacity: interpolate(
        translateX.value,
        [0, SWIPE_THRESHOLD * 0.4],
        [0, 1],
        Extrapolation.CLAMP,
      ),
    };
  });

  // ── SKIP label opacity ───────────────────────────────────────────────────
  const skipLabelStyle = useAnimatedStyle(() => {
    if (!translateX) return { opacity: 0 };
    return {
      opacity: interpolate(
        translateX.value,
        [-SWIPE_THRESHOLD * 0.4, 0],
        [1, 0],
        Extrapolation.CLAMP,
      ),
    };
  });

  return (
    <View style={styles.card}>
      {/* Background gradient derived from accent color */}
      <LinearGradient
        colors={[accentColor + '22', '#0F0F0F']}
        locations={[0, 0.6]}
        style={StyleSheet.absoluteFill}
      />

      {/* Album art */}
      <View style={styles.artContainer}>
        {albumArt ? (
          <Image
            source={{ uri: albumArt }}
            style={styles.albumArt}
            resizeMode="cover"
            fadeDuration={0}
          />
        ) : (
          <View style={[styles.albumArt, styles.artPlaceholder]} />
        )}
      </View>

      {/* Bottom metadata section */}
      <View style={styles.meta}>
        <Text style={styles.trackName} numberOfLines={2}>
          {track.name}
        </Text>
        <Text style={styles.artistName} numberOfLines={1}>
          {artistName}
        </Text>

        {genre ? (
          <View style={[styles.genrePill, { backgroundColor: accentColor + '33' }]}>
            <Text style={[styles.genreText, { color: accentColor }]}>
              {genre}
            </Text>
          </View>
        ) : null}

        {/* Waveform progress */}
        <View style={styles.waveformRow}>
          <Text style={styles.playIcon}>{isActive ? '▶' : '⏸'}</Text>
          <View style={styles.waveformWrapper}>
            <WaveformViz
              progress={isActive ? progress : 0}
              energy={0.6}
              color={accentColor}
              height={28}
              onSeek={handleSeek}
              isLoading={isActive && isLoadingAudio}
            />
          </View>
        </View>
      </View>

      {/* ── Overlay effects (top card only) ───────────────────────────────── */}

      {/* Green border glow — save direction */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.saveGlow, saveGlowStyle]}
        pointerEvents="none"
      />

      {/* Red tint — skip direction */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.skipTint, skipTintStyle]}
        pointerEvents="none"
      />

      {/* SAVE label */}
      <Animated.View style={[styles.saveLabel, saveLabelStyle]} pointerEvents="none">
        <Text style={styles.saveLabelText}>SAVE</Text>
      </Animated.View>

      {/* SKIP label */}
      <Animated.View style={[styles.skipLabel, skipLabelStyle]} pointerEvents="none">
        <Text style={styles.skipLabelText}>SKIP</Text>
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#141414',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 12,
  },

  artContainer: {
    flex: 1,
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  albumArt: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
  },
  artPlaceholder: {
    backgroundColor: '#2A2A2A',
    aspectRatio: 1,
    borderRadius: 12,
    width: '100%',
  },

  meta: {
    padding: 20,
    paddingTop: 14,
    gap: 4,
  },
  trackName: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 24,
  },
  artistName: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  genrePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 50,
    marginBottom: 8,
  },
  genreText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
    letterSpacing: 0.3,
  },
  waveformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  playIcon: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
  },
  waveformWrapper: {
    flex: 1,
  },

  // ── Overlays ────────────────────────────────────────────────────────────
  saveGlow: {
    borderRadius: 20,
    borderWidth: 3,
    borderColor: '#1DB954',
    backgroundColor: 'rgba(29, 185, 84, 0.08)',
  },
  skipTint: {
    borderRadius: 20,
    backgroundColor: 'rgba(200, 60, 60, 0.12)',
  },

  saveLabel: {
    position: 'absolute',
    top: 24,
    left: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#1DB954',
    backgroundColor: 'rgba(0,0,0,0.3)',
    transform: [{ rotate: '-20deg' }],
  },
  saveLabelText: {
    color: '#1DB954',
    fontSize: 15,
    fontWeight: '800',
    fontFamily: 'SpaceMono',
    letterSpacing: 1.5,
  },

  skipLabel: {
    position: 'absolute',
    top: 24,
    right: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FF4444',
    backgroundColor: 'rgba(0,0,0,0.3)',
    transform: [{ rotate: '20deg' }],
  },
  skipLabelText: {
    color: '#FF4444',
    fontSize: 15,
    fontWeight: '800',
    fontFamily: 'SpaceMono',
    letterSpacing: 1.5,
  },
});
