// ─── VibePill ─────────────────────────────────────────────────────────────────
// Shown when vibeStage === 'forming' or 'locked'. Positioned top-right of feed.
// Forming: "Sounding like... [label]" with a gentle fade-in.
// Locked:  "Your vibe: [label]" with solid appearance.
// Label changes crossfade smoothly.

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { VibeStage } from '@/src/stores/sessionStore';

type Props = {
  stage: VibeStage;
  label: string;
};

const VibePill = ({ stage, label }: Props) => {
  // ── Crossfade between label changes ────────────────────────────────────────
  const [displayedLabel, setDisplayedLabel] = useState(label);
  const labelOpacity = useSharedValue(1);
  const prevLabel = useRef(label);

  useEffect(() => {
    if (label === prevLabel.current) return;
    // Fade out → swap text → fade in
    labelOpacity.value = withTiming(0, { duration: 180 }, (done) => {
      if (done) {
        // Run on JS thread via setState after animation completes
      }
    });
    const timer = setTimeout(() => {
      setDisplayedLabel(label);
      labelOpacity.value = withTiming(1, { duration: 250 });
      prevLabel.current = label;
    }, 180);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);

  // ── Pill mount fade-in ──────────────────────────────────────────────────────
  const pillOpacity = useSharedValue(0);
  useEffect(() => {
    pillOpacity.value = withTiming(1, { duration: 350 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pillStyle  = useAnimatedStyle(() => ({ opacity: pillOpacity.value }));
  const textStyle  = useAnimatedStyle(() => ({ opacity: labelOpacity.value }));

  const isLocked = stage === 'locked';
  const prefix   = isLocked ? 'Your vibe' : 'Sounding like...';

  return (
    <Animated.View style={[styles.pill, isLocked && styles.pillLocked, pillStyle]}>
      <View style={styles.dot} />
      <Animated.View style={textStyle}>
        <Text style={styles.prefix}>{prefix}</Text>
        <Text style={[styles.label, isLocked && styles.labelLocked]} numberOfLines={1}>
          {displayedLabel}
        </Text>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(15, 15, 15, 0.80)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 12,
    maxWidth: 220,
  },
  pillLocked: {
    borderColor: 'rgba(29, 185, 84, 0.35)',
    backgroundColor: 'rgba(10, 10, 10, 0.88)',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#1DB954',
    flexShrink: 0,
  },
  prefix: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontFamily: 'SpaceMono',
    letterSpacing: 0.3,
    lineHeight: 14,
  },
  label: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
    lineHeight: 18,
  },
  labelLocked: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});

export default VibePill;
