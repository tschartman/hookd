import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect } from 'react';
import { Dimensions, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import ActionBar from '@/src/components/ActionBar';
import WaveformViz from '@/src/components/WaveformViz';
import type { SpotifyAudioFeatures, SpotifyTrack } from '@/src/services/spotify';
import { usePlayerStore } from '@/src/stores/playerStore';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  track: SpotifyTrack;
  audioFeatures?: SpotifyAudioFeatures;
  isActive: boolean;
  isSaved: boolean;
  onSave: () => void;
  onExpand: () => void;
  onAddToPlaylist?: () => void;
  onTogglePlay: () => void;
  /** Height this card should fill (screen height minus tab bar and any top offset). */
  height: number;
  /** Extra bottom padding to keep action buttons clear of the screen edge. */
  bottomPadding?: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Static color palette ─────────────────────────────────────────────────────
// react-native-image-colors requires a native build (not available in Expo Go).
// Until the app is built with EAS, we derive a consistent accent color from the
// track ID so every card still has a unique, deterministic color theme.

const ACCENT_PALETTE = [
  '#1DB954', // Spotify green
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

// ─── Component ────────────────────────────────────────────────────────────────

const HookCard = ({
  track,
  audioFeatures,
  isActive,
  isSaved,
  onSave,
  onExpand,
  onAddToPlaylist,
  onTogglePlay,
  height,
  bottomPadding = 0,
}: Props) => {
  const albumArt = track.album.images[0]?.url;
  const artistName = track.artists.map((a) => a.name).join(', ');
  const bpm = audioFeatures ? Math.round(audioFeatures.tempo) : null;
  const energy = audioFeatures?.energy ?? 0.6;

  const accentColor = accentFromTrackId(track.id);
  const gradientColors: [string, string] = [accentColor + '44', '#0A0A0A'];

  // Subscribe directly to the store for playback state.
  // Selectors return a constant for inactive cards so only the active card
  // re-renders on progress / isPlaying ticks.
  const progress = usePlayerStore((s) => isActive ? s.progress : 0);
  const isPlaying = usePlayerStore((s) => isActive ? s.isPlaying : false);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const isLoadingAudio = usePlayerStore((s) => isActive ? s.isLoadingAudio : false);
  const handleSeek = isActive ? seekTo : undefined;

  // ── Pulsing "live" dot ────────────────────────────────────────────────────
  const dotOpacity = useSharedValue(1);
  useEffect(() => {
    if (isActive) {
      dotOpacity.value = withRepeat(
        withSequence(withTiming(0.2, { duration: 600 }), withTiming(1, { duration: 600 })),
        -1,
        false,
      );
    } else {
      dotOpacity.value = withTiming(0.3, { duration: 200 });
    }
  }, [isActive]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value }));

  // ── Save bounce ───────────────────────────────────────────────────────────
  const artScale = useSharedValue(1);
  const savedOverlayOpacity = useSharedValue(0);

  const triggerSaveBounce = useCallback(() => {
    artScale.value = withSequence(
      withSpring(1.08, { damping: 6, stiffness: 300 }),
      withSpring(1, { damping: 12 }),
    );
    savedOverlayOpacity.value = withSequence(
      withTiming(1, { duration: 150 }),
      withTiming(0, { duration: 600 }),
    );
  }, []);

  const handleSave = useCallback(() => {
    triggerSaveBounce();
    onSave();
  }, [onSave, triggerSaveBounce]);

  // ── Double-tap anywhere on card to save ───────────────────────────────────
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(300)
    .onEnd(() => {
      runOnJS(handleSave)();
    });

  const artAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: artScale.value }],
  }));
  const overlayAnimStyle = useAnimatedStyle(() => ({
    opacity: savedOverlayOpacity.value,
  }));

  // ── Progress display ──────────────────────────────────────────────────────
  const currentSec = Math.round(progress * 30);
  const progressText = `${formatSeconds(currentSec)} / 0:30`;

  return (
    <GestureDetector gesture={doubleTap}>
      <View style={[styles.container, { height, paddingBottom: bottomPadding }]}>
        {/* Background gradient from album art colors */}
        <LinearGradient
          colors={gradientColors}
          locations={[0, 0.85]}
          style={StyleSheet.absoluteFill}
        />

        {/* Album art — tap to play/pause */}
        <Pressable onPress={onTogglePlay} style={styles.artWrapper}>
          <Animated.View style={artAnimStyle}>
            {albumArt ? (
              <Image source={{ uri: albumArt }} style={styles.albumArt} resizeMode="cover" />
            ) : (
              <View style={[styles.albumArt, styles.artPlaceholder]} />
            )}

            {/* ♥ flash overlay on double-tap save */}
            <Animated.View style={[styles.saveOverlay, overlayAnimStyle]} pointerEvents="none">
              <Text style={styles.saveOverlayHeart}>♥</Text>
            </Animated.View>

            {/* Pause indicator — visible when active but paused */}
            {isActive && !isPlaying && (
              <View style={styles.pauseOverlay} pointerEvents="none">
                <Text style={styles.pauseIcon}>⏸</Text>
              </View>
            )}
          </Animated.View>
        </Pressable>

        {/* Metadata */}
        <View style={styles.metaSection}>
          <Text style={styles.songTitle} numberOfLines={1}>
            {track.name}
          </Text>
          <Pressable onPress={onExpand} hitSlop={8}>
            <Text style={styles.artistName} numberOfLines={1}>
              {artistName}
            </Text>
          </Pressable>

          {/* Pills row */}
          <View style={styles.pillsRow}>
            {bpm !== null && (
              <View style={styles.pill}>
                <Text style={styles.pillText}>{bpm} BPM</Text>
              </View>
            )}
            {audioFeatures && (
              <View style={[styles.pill, { backgroundColor: accentColor + '33' }]}>
                <Text style={[styles.pillText, { color: accentColor }]}>
                  {energyLabel(audioFeatures.energy)}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Waveform + progress indicator */}
        <View style={styles.waveformSection}>
          <View style={styles.hookIndicator}>
            <Animated.View style={[styles.dot, { backgroundColor: accentColor }, dotStyle]} />
            <Text style={styles.hookText}>
              {isActive ? `Playing the hook · ${progressText}` : 'Paused'}
            </Text>
          </View>

          <WaveformViz
            progress={isActive ? progress : 0}
            energy={energy}
            color={accentColor}
            onSeek={handleSeek}
            isLoading={isActive && isLoadingAudio}
          />
        </View>

        {/* Action bar */}
        <View style={styles.actionSection}>
          <ActionBar
            isSaved={isSaved}
            onSave={handleSave}
            onExpand={onExpand}
            onAddToPlaylist={onAddToPlaylist}
            trackUrl={track.external_urls.spotify}
            accentColor={accentColor}
          />
        </View>
      </View>
    </GestureDetector>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function energyLabel(energy: number): string {
  if (energy >= 0.8) return 'High Energy';
  if (energy >= 0.5) return 'Mid Energy';
  return 'Chill';
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ART_SIZE = Math.round(Dimensions.get('window').width * 0.82);

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 14,
    overflow: 'hidden',
  },

  // Album art
  artWrapper: {
    position: 'relative',
  },
  albumArt: {
    width: ART_SIZE,
    height: ART_SIZE,
    borderRadius: 16,
  },
  artPlaceholder: {
    backgroundColor: '#1A1A1A',
  },
  saveOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  saveOverlayHeart: {
    fontSize: 72,
    color: '#ff4d6d',
  },
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  pauseIcon: {
    fontSize: 48,
    color: 'rgba(255,255,255,0.9)',
  },

  // Metadata
  metaSection: {
    width: '100%',
    gap: 6,
  },
  songTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  artistName: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 15,
    fontWeight: '500',
  },
  pillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
  },

  // Waveform
  waveformSection: {
    width: '100%',
    gap: 10,
  },
  hookIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  hookText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontFamily: 'SpaceMono',
    letterSpacing: 0.2,
  },

  // Action bar
  actionSection: {
    width: '100%',
  },
});

// Non-active cards only re-render when their own track or saved state changes.
// The active card's fine-grained updates (progress, isPlaying) come from store
// subscriptions inside the component, not from parent re-renders.
export default React.memo(HookCard, (prev, next) => {
  if (prev.isActive !== next.isActive) return false; // activation changed → re-render
  if (!prev.isActive) {
    // Inactive cards: skip re-render unless track identity or save state changed
    return (
      prev.track.id === next.track.id &&
      prev.isSaved === next.isSaved &&
      prev.height === next.height &&
      prev.bottomPadding === next.bottomPadding &&
      prev.onAddToPlaylist === next.onAddToPlaylist
    );
  }
  // Active card: let the store subscriptions drive re-renders
  return false;
});
