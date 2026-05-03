import * as Haptics from 'expo-haptics';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

// ─── Constants ────────────────────────────────────────────────────────────────

const BAR_COUNT = 48;
const BAR_GAP = 2;

// ─── Waveform generation ──────────────────────────────────────────────────────

/**
 * Generates a deterministic-looking waveform from a track's energy value.
 * Combines sine waves at different frequencies so it looks organic, not random.
 * Using energy as the amplitude baseline means energetic tracks have taller bars.
 */
function generateBars(energy: number): number[] {
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const t = i / BAR_COUNT;
    const base = energy * 0.55 + 0.2;
    const wave =
      Math.sin(t * Math.PI * 6) * 0.2 +
      Math.sin(t * Math.PI * 14 + 1.2) * 0.12 +
      Math.cos(t * Math.PI * 9 + 0.5) * 0.1;
    // Taper the edges slightly (real waveforms are quieter at start/end)
    const taper = Math.sin(t * Math.PI) * 0.15;
    return Math.max(0.08, Math.min(1, base + wave + taper));
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  /** Playback position 0–1. */
  progress: number;
  /** Track energy 0–1, from Spotify audio features. Defaults to 0.6. */
  energy?: number;
  /** Accent color for the played portion. */
  color?: string;
  height?: number;
  /** Called with a 0–1 fraction when the user taps or scrubs to seek. */
  onSeek?: (fraction: number) => void;
  /** When true, pulses the waveform to indicate buffering. */
  isLoading?: boolean;
};

const WaveformViz = ({ progress, energy = 0.6, color = '#1DB954', height = 40, onSeek, isLoading = false }: Props) => {
  const bars = useMemo(() => generateBars(energy), [energy]);

  // Animate the fill width smoothly between progress updates from the store.
  const fillProgress = useSharedValue(0);
  // Width of the container, measured via onLayout.
  const containerWidth = useSharedValue(0);
  // True while the user is actively dragging, suppresses store-driven animation.
  const isSeeking = useSharedValue(false);
  // Opacity for the loading pulse animation.
  const loadingOpacity = useSharedValue(1);

  useEffect(() => {
    // Don't override the visual while the user is scrubbing.
    if (!isSeeking.value) {
      fillProgress.value = withTiming(progress, { duration: 400 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  useEffect(() => {
    if (isLoading) {
      loadingOpacity.value = withRepeat(
        withSequence(
          withTiming(0.25, { duration: 500 }),
          withTiming(1, { duration: 500 }),
        ),
        -1,
        false,
      );
    } else {
      loadingOpacity.value = withTiming(1, { duration: 200 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const fireHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const fireSeek = (fraction: number) => {
    onSeek?.(fraction);
  };

  // Tap gesture — handles a quick press with no drag (seek to tapped position).
  // Needed because Pan.minDistance(0) inside a FlatList fails for pure taps:
  // the ScrollView captures the touch before Pan can activate.
  const tapGesture = Gesture.Tap()
    .onEnd((e) => {
      'worklet';
      if (containerWidth.value <= 0) return;
      const fraction = Math.max(0, Math.min(1, e.x / containerWidth.value));
      fillProgress.value = fraction;
      isSeeking.value = false;
      runOnJS(fireHaptic)();
      runOnJS(fireSeek)(fraction);
    });

  // Pan gesture — handles drag-to-scrub.
  // activeOffsetX / failOffsetY ensure only horizontal movement activates this
  // gesture, so the vertical FlatList scroll can still steal vertical movement.
  const panGesture = Gesture.Pan()
    .minDistance(0)
    .activeOffsetX([-5, 5])
    .failOffsetY([-5, 5])
    .onBegin((e) => {
      'worklet';
      if (containerWidth.value <= 0) return;
      isSeeking.value = true;
      const fraction = Math.max(0, Math.min(1, e.x / containerWidth.value));
      fillProgress.value = fraction;
      runOnJS(fireHaptic)();
    })
    .onUpdate((e) => {
      'worklet';
      if (containerWidth.value <= 0) return;
      const fraction = Math.max(0, Math.min(1, e.x / containerWidth.value));
      fillProgress.value = fraction;
    })
    .onFinalize((e) => {
      'worklet';
      if (containerWidth.value <= 0) return;
      const wasDragging = isSeeking.value;
      isSeeking.value = false;
      if (e.success) {
        // Pan completed cleanly — seek to the exact final position.
        const fraction = Math.max(0, Math.min(1, e.x / containerWidth.value));
        fillProgress.value = fraction;
        runOnJS(fireSeek)(fraction);
      } else if (wasDragging) {
        // Pan was interrupted (failOffsetY triggered by natural hand tremor,
        // or FlatList stole the gesture). Seek to the last position tracked
        // in onUpdate rather than discarding the whole drag.
        runOnJS(fireSeek)(fillProgress.value);
      }
      // If wasDragging is false the pan was cancelled before any movement
      // (tap won the Race for a quick press) — the tap gesture fires its own seek.
    });

  // Race: whichever gesture activates first wins. Tap wins for a quick press;
  // Pan wins once horizontal drag movement is detected.
  const gesture = Gesture.Race(tapGesture, panGesture);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fillProgress.value * 100}%`,
  }));

  const loadingStyle = useAnimatedStyle(() => ({
    opacity: loadingOpacity.value,
  }));

  return (
    <GestureDetector gesture={gesture}>
      {/*
       * The outer view is the touch target — 20px taller than the bars so fingers
       * don't have to be pixel-perfect. The inner view clips the bar layers.
       */}
      <Animated.View
        style={[styles.touchTarget, { height: height + 20 }, loadingStyle]}
        onLayout={(e) => { containerWidth.value = e.nativeEvent.layout.width; }}
      >
        <View style={[styles.container, { height }]} pointerEvents="none">
          {/* Unplayed bars (dim) */}
          <View style={StyleSheet.absoluteFill}>
            <BarLayer bars={bars} height={height} color="rgba(255,255,255,0.15)" />
          </View>

          {/* Played bars (colored, clipped by animated width) */}
          <Animated.View style={[StyleSheet.absoluteFill, styles.fillClip, fillStyle]}>
            <BarLayer bars={bars} height={height} color={color} />
          </Animated.View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
};

// ─── Internal bar layer ───────────────────────────────────────────────────────

const BarLayer = ({
  bars,
  height,
  color,
}: {
  bars: number[];
  height: number;
  color: string;
}) => (
  <View style={[styles.barRow, { height }]}>
    {bars.map((amplitude, i) => (
      <View
        key={i}
        style={[
          styles.bar,
          {
            height: amplitude * height,
            backgroundColor: color,
            marginHorizontal: BAR_GAP / 2,
          },
        ]}
      />
    ))}
  </View>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  touchTarget: {
    width: '100%',
    justifyContent: 'center',
  },
  container: {
    width: '100%',
    overflow: 'hidden',
  },
  fillClip: {
    overflow: 'hidden',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  bar: {
    flex: 1,
    borderRadius: 2,
    minWidth: 2,
  },
});

export default WaveformViz;
