import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  missionName: string;
  missionIcon: string;
  lineupCount: number;
  suggestedCount: number;
  isTuning?: boolean;
  isFilterActive?: boolean;
  onDone: () => void;
  onBack: () => void;
  onFilter?: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function MissionTopBar({
  missionName,
  missionIcon,
  lineupCount,
  suggestedCount,
  isTuning = false,
  isFilterActive = false,
  onDone,
  onBack,
  onFilter,
}: Props) {
  const isDone = lineupCount >= suggestedCount;

  // ── Pulse the counter on each new save ─────────────────────────────────
  const counterScale = useSharedValue(1);

  useEffect(() => {
    if (lineupCount > 0) {
      counterScale.value = withSequence(
        withSpring(1.35, { damping: 4, stiffness: 400 }),
        withSpring(1, { damping: 10 }),
      );
    }
  }, [lineupCount]);

  const counterStyle = useAnimatedStyle(() => ({
    transform: [{ scale: counterScale.value }],
  }));

  // ── "Tuning to your taste…" fade in/out ─────────────────────────────────
  const tuningOpacity = useSharedValue(0);

  useEffect(() => {
    tuningOpacity.value = withTiming(isTuning ? 1 : 0, { duration: 450 });
  }, [isTuning]);

  const tuningStyle = useAnimatedStyle(() => ({
    opacity: tuningOpacity.value,
  }));

  // Duration estimate: lineup × 3 min average
  const estimatedMin = lineupCount * 3;

  return (
    <View style={styles.container}>
      {/* Back arrow */}
      <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
        <Text style={styles.backIcon}>←</Text>
      </Pressable>

      {/* Filter icon — only rendered when onFilter is provided */}
      {onFilter ? (
        <Pressable onPress={onFilter} hitSlop={12} style={styles.filterButton}>
          <Text style={styles.filterIcon}>⊟</Text>
          {isFilterActive && <View style={styles.filterDot} />}
        </Pressable>
      ) : null}

      {/* Mission name + tuning indicator */}
      <View style={styles.center}>
        <Text style={styles.missionLabel} numberOfLines={1}>
          {missionIcon} {missionName}
        </Text>
        <Animated.Text style={[styles.tuningLabel, tuningStyle]} numberOfLines={1}>
          Tuning to your taste…
        </Animated.Text>
      </View>

      {/* Lineup counter + Done button */}
      <View style={styles.right}>
        <View style={styles.counterRow}>
          <Animated.View style={counterStyle}>
            <Text style={[styles.counterText, lineupCount > 0 && styles.counterActive]}>
              {lineupCount}
            </Text>
          </Animated.View>
          {lineupCount > 0 && (
            <Text style={styles.counterSuffix}>
              {' '}songs · ~{estimatedMin}m
            </Text>
          )}
        </View>

        <Pressable
          onPress={onDone}
          style={[styles.doneButton, isDone && styles.doneButtonFilled]}>
          <Text style={[styles.doneText, isDone && styles.doneTextFilled]}>
            Done
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },

  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },

  center: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  missionLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  tuningLabel: {
    color: '#1DB954',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
    letterSpacing: 0.2,
  },

  right: {
    alignItems: 'flex-end',
    gap: 4,
  },

  counterRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  counterText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'SpaceMono',
  },
  counterActive: {
    color: '#1DB954',
  },
  counterSuffix: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    fontFamily: 'SpaceMono',
  },

  doneButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  doneButtonFilled: {
    backgroundColor: '#1DB954',
    borderColor: '#1DB954',
  },
  doneText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '700',
  },
  doneTextFilled: {
    color: '#000000',
  },

  filterButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterIcon: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  filterDot: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1DB954',
  },
});
