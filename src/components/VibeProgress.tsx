// ─── VibeProgress ─────────────────────────────────────────────────────────────
// Shown when vibeStage === 'building' (1–4 saves).
// Small pill at top of screen: "Building your vibe... 3/10"
// Animated bar fills as saves accumulate. Pulses on each new save.

import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const BAR_WIDTH = 80;

type Props = {
  saveCount: number;
  /** Total saves needed to reach 'locked'. */
  goal?: number;
};

const VibeProgress = ({ saveCount, goal = 10 }: Props) => {
  const progress = Math.min(saveCount / goal, 1);

  // Animated bar fill width
  const barWidth = useSharedValue(0);

  // Pulse scale on each new save
  const pillScale = useSharedValue(1);
  const prevSaveCount = useRef(saveCount);

  useEffect(() => {
    barWidth.value = withTiming(BAR_WIDTH * progress, { duration: 500 });

    if (saveCount > prevSaveCount.current) {
      pillScale.value = withSequence(
        withSpring(1.08, { damping: 6, stiffness: 300 }),
        withSpring(1.0,  { damping: 10, stiffness: 200 }),
      );
    }
    prevSaveCount.current = saveCount;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveCount, progress]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pillScale.value }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: barWidth.value,
  }));

  return (
    <Animated.View style={[styles.pill, pillStyle]}>
      {/* Progress bar */}
      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, fillStyle]} />
      </View>

      <Text style={styles.label}>
        Building your vibe...{' '}
        <Text style={styles.fraction}>{saveCount}/{goal}</Text>
      </Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(20, 20, 20, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  barTrack: {
    width: BAR_WIDTH,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#1DB954',
  },
  label: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontFamily: 'SpaceMono',
  },
  fraction: {
    color: '#1DB954',
  },
});

export default VibeProgress;
