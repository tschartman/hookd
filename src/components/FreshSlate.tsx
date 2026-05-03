// ─── FreshSlate ───────────────────────────────────────────────────────────────
// Shown when vibeStage === 'fresh' (0 saves). Fades in immediately, fades out
// on first save. Large centered text + subtle pulsing ring animation.

import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  /** Whether the component is actively visible (controls fade-out). */
  visible: boolean;
};

const FreshSlate = ({ visible }: Props) => {
  const opacity = useSharedValue(0);
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0.25);

  // Fade the whole panel in/out
  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: 400 });
  }, [visible, opacity]);

  // Slow breathing pulse on the ring — runs forever
  useEffect(() => {
    ringScale.value = withRepeat(
      withSequence(
        withTiming(1.18, { duration: 2000 }),
        withTiming(1.0, { duration: 2000 }),
      ),
      -1,
      true,
    );
    ringOpacity.value = withRepeat(
      withSequence(
        withTiming(0.5, { duration: 2000 }),
        withTiming(0.2, { duration: 2000 }),
      ),
      -1,
      true,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const panelStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const ringStyle  = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  if (!visible) return null;

  return (
    <Animated.View style={[styles.overlay, panelStyle]} pointerEvents="none">
      {/* Pulsing outer ring */}
      <Animated.View style={[styles.ring, ringStyle]} />

      {/* Inner ring (static) */}
      <View style={styles.ringInner} />

      {/* Text */}
      <View style={styles.textBlock}>
        <Text style={styles.headline}>Fresh session</Text>
        <Text style={styles.subtitle}>Start swiping to discover your vibe</Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    // Translucent dark scrim so the card underneath is still visible
    backgroundColor: 'rgba(10, 10, 10, 0.55)',
  },
  ring: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  ringInner: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  textBlock: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 40,
  },
  headline: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
});

export default FreshSlate;
