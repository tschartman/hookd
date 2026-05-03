// ─── FestivalProgressBar.tsx ──────────────────────────────────────────────────
// Tiered segmented progress bar showing how much of each tier has been explored.
// Segments are proportional to artist count per tier; fill animates on discovery.

import { useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import type { Festival } from '@/src/data/festivals';

// ─── Constants ────────────────────────────────────────────────────────────────

const SPRING_CONFIG = { damping: 18, stiffness: 130 };

const TIER_COLORS = {
  headliner: { filled: '#FFD700', bg: '#3A3000' },
  midtier:   { filled: '#C0C0C0', bg: '#2A2A2A' },
  opener:    { filled: '#CD7F32', bg: '#2A1A00' },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  festival: Festival;
  heardArtists: Set<string>;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function FestivalProgressBar({ festival, heardArtists }: Props) {
  const [showDetail, setShowDetail] = useState(false);
  const [barWidth, setBarWidth]     = useState(0);

  // ── Per-tier counts ─────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const headliners = festival.artists.filter((a) => a.tier === 'headliner');
    const midtier    = festival.artists.filter((a) => a.tier === 'midtier');
    const openers    = festival.artists.filter((a) => a.tier === 'opener');

    return {
      headliner: {
        total: headliners.length,
        heard: headliners.filter((a) => heardArtists.has(a.name)).length,
      },
      midtier: {
        total: midtier.length,
        heard: midtier.filter((a) => heardArtists.has(a.name)).length,
      },
      opener: {
        total: openers.length,
        heard: openers.filter((a) => heardArtists.has(a.name)).length,
      },
      total: festival.artists.length,
      heard: heardArtists.size,
    };
  }, [festival.artists, heardArtists]);

  // ── Animated fill widths (pixels) ───────────────────────────────────────────
  const headlinerFill = useSharedValue(0);
  const midtierFill   = useSharedValue(0);
  const openerFill    = useSharedValue(0);

  useEffect(() => {
    if (!barWidth || !counts.total) return;

    // Pixel width of each segment (proportional to artist count)
    const headlinerSegW = (counts.headliner.total / counts.total) * barWidth;
    const midtierSegW   = (counts.midtier.total   / counts.total) * barWidth;
    const openerSegW    = (counts.opener.total    / counts.total) * barWidth;

    headlinerFill.value = withSpring(
      counts.headliner.total > 0
        ? (counts.headliner.heard / counts.headliner.total) * headlinerSegW
        : 0,
      SPRING_CONFIG,
    );
    midtierFill.value = withSpring(
      counts.midtier.total > 0
        ? (counts.midtier.heard / counts.midtier.total) * midtierSegW
        : 0,
      SPRING_CONFIG,
    );
    openerFill.value = withSpring(
      counts.opener.total > 0
        ? (counts.opener.heard / counts.opener.total) * openerSegW
        : 0,
      SPRING_CONFIG,
    );
  }, [counts, barWidth]);

  const headlinerFillStyle = useAnimatedStyle(() => ({ width: headlinerFill.value }));
  const midtierFillStyle   = useAnimatedStyle(() => ({ width: midtierFill.value }));
  const openerFillStyle    = useAnimatedStyle(() => ({ width: openerFill.value }));

  const handleBarLayout = (e: LayoutChangeEvent) => {
    setBarWidth(e.nativeEvent.layout.width);
  };

  if (!counts.total) return null;

  // Segment flex weights (proportional to artist count)
  const headlinerFlex = counts.headliner.total / counts.total;
  const midtierFlex   = counts.midtier.total   / counts.total;
  const openerFlex    = counts.opener.total    / counts.total;

  return (
    <View style={styles.container}>
      {/* Segmented bar */}
      <View style={styles.bar} onLayout={handleBarLayout}>
        {counts.headliner.total > 0 && (
          <>
            <View style={[styles.segment, { flex: headlinerFlex, backgroundColor: TIER_COLORS.headliner.bg }]}>
              <Animated.View
                style={[styles.fill, { backgroundColor: TIER_COLORS.headliner.filled }, headlinerFillStyle]}
              />
            </View>
            {(counts.midtier.total > 0 || counts.opener.total > 0) && (
              <View style={styles.divider} />
            )}
          </>
        )}
        {counts.midtier.total > 0 && (
          <>
            <View style={[styles.segment, { flex: midtierFlex, backgroundColor: TIER_COLORS.midtier.bg }]}>
              <Animated.View
                style={[styles.fill, { backgroundColor: TIER_COLORS.midtier.filled }, midtierFillStyle]}
              />
            </View>
            {counts.opener.total > 0 && <View style={styles.divider} />}
          </>
        )}
        {counts.opener.total > 0 && (
          <View style={[styles.segment, { flex: openerFlex, backgroundColor: TIER_COLORS.opener.bg }]}>
            <Animated.View
              style={[styles.fill, { backgroundColor: TIER_COLORS.opener.filled }, openerFillStyle]}
            />
          </View>
        )}
      </View>

      {/* Summary text — tap to toggle compact ↔ detailed */}
      <Pressable onPress={() => setShowDetail((v) => !v)} hitSlop={6}>
        <Text style={styles.label}>
          {showDetail
            ? [
                counts.headliner.total > 0 && `${counts.headliner.heard}/${counts.headliner.total} headliners`,
                counts.midtier.total > 0   && `${counts.midtier.heard}/${counts.midtier.total} midtier`,
                counts.opener.total > 0    && `${counts.opener.heard}/${counts.opener.total} openers`,
              ]
                .filter(Boolean)
                .join(' · ')
            : `${counts.heard} of ${counts.total} artists discovered`}
        </Text>
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 5,
  },
  bar: {
    height: 5,
    flexDirection: 'row',
    borderRadius: 3,
    overflow: 'hidden',
  },
  segment: {
    height: '100%',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
  divider: {
    width: 2,
    height: '100%',
    backgroundColor: '#0A0A0A',
  },
  label: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontFamily: 'SpaceMono',
    textAlign: 'center',
  },
});
