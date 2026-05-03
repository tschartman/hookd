// ─── FestivalFeedMode.tsx ──────────────────────────────────────────────────────
// Explore / Free Play mode toggle + live lineup progress bar.
// Sits between the Popular↔Discovery slider and the feed cards.
//
//  Explore mode:
//    [🧭 Exploring lineup · 8 of 30 artists         🎵 Free Play]
//    [████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
//
//  Free Play mode:
//    [🎵 Free Play                                  🧭 Explore]
//    [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]  ← invisible spacer

import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FeedMode = 'explore' | 'freeplay';

type Props = {
  mode: FeedMode;
  /** Number of unique primary artists heard this session (from artistPlayCount.size). */
  artistsExplored: number;
  /** Total unique primary artists with playable tracks for this festival. */
  totalArtists: number;
  onToggleMode: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function FestivalFeedMode({
  mode,
  artistsExplored,
  totalArtists,
  onToggleMode,
}: Props) {
  const fillProgress = useSharedValue(0);

  // Animate bar fill whenever explored count changes (explore mode only)
  useEffect(() => {
    const target = totalArtists > 0 ? artistsExplored / totalArtists : 0;
    fillProgress.value = withSpring(target, { damping: 18, stiffness: 130 });
  }, [artistsExplored, totalArtists]);

  const fillStyle = useAnimatedStyle(() => ({
    // Use a proportional width; parent bar is 100% wide
    width: `${Math.min(fillProgress.value, 1) * 100}%`,
  }));

  const handleToggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onToggleMode();
  };

  const isComplete = totalArtists > 0 && artistsExplored >= totalArtists;

  // ── Label text ──────────────────────────────────────────────────────────────
  const leftLabel =
    mode === 'freeplay'
      ? '🎵 Free Play'
      : isComplete
        ? `🎉 Full lineup explored! ${totalArtists} of ${totalArtists}`
        : `🧭 Exploring lineup · ${artistsExplored} of ${totalArtists} artists`;

  const rightLabel = mode === 'freeplay' ? '🧭 Explore' : '🎵 Free Play';

  // ── Bar colour ──────────────────────────────────────────────────────────────
  const barColor = isComplete ? '#FFD700' : '#1DB954';

  return (
    <View style={styles.container}>
      {/* Mode row */}
      <View style={styles.row}>
        <Text
          style={[styles.modeLabel, isComplete && styles.completedLabel]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {leftLabel}
        </Text>

        <Pressable onPress={handleToggle} hitSlop={8} style={styles.toggleBtn}>
          <Text style={styles.toggleText}>{rightLabel}</Text>
        </Pressable>
      </View>

      {/* Progress bar — always rendered to keep layout height stable.
          Invisible (opacity 0) in Free Play mode so it acts as a spacer. */}
      <View style={[styles.track, mode === 'freeplay' && styles.trackHidden]}>
        <Animated.View style={[styles.fill, { backgroundColor: barColor }, fillStyle]} />
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modeLabel: {
    flex: 1,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontFamily: 'SpaceMono',
    marginRight: 8,
  },
  completedLabel: {
    color: '#FFD700',
  },
  toggleBtn: {
    flexShrink: 0,
  },
  toggleText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    fontFamily: 'SpaceMono',
  },
  track: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  trackHidden: {
    opacity: 0,
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
});
