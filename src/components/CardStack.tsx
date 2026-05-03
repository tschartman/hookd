import { Dimensions, Image, StyleSheet, Text, View } from 'react-native';
import { useEffect, useRef } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import MissionCard from '@/src/components/MissionCard';
import type { SpotifyTrack } from '@/src/services/spotify';
import type { SwipeDirection } from '@/src/hooks/useMission';

// ─── Constants ────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/** Card dimensions — leave 24px margin on each side. */
export const CARD_WIDTH = SCREEN_WIDTH - 48;
export const CARD_HEIGHT = CARD_WIDTH * 1.52;

/** Fraction of screen width needed to trigger a swipe-away. */
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.38;

/** Minimum gesture velocity (px/s) that also triggers a swipe-away. */
const VELOCITY_THRESHOLD = 700;

/** Background card visual offsets — creates the "stack" depth effect. */
const NEXT_SCALE = 0.94;
const SECOND_SCALE = 0.88;
const NEXT_OFFSET_Y = 14;
const SECOND_OFFSET_Y = 24;

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  cards: SpotifyTrack[];
  currentIndex: number;
  onSwipe: (direction: SwipeDirection) => void;
  audioProgress: number;
  onSeek?: (fraction: number) => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function CardStack({ cards, currentIndex, onSwipe, audioProgress, onSeek }: Props) {
  const translateX = useSharedValue(0);

  const topCard = cards[currentIndex];
  const nextCard = cards[currentIndex + 1];
  const thirdCard = cards[currentIndex + 2];

  // ── Promotion lock ────────────────────────────────────────────────────────
  // When a swipe completes the top card's fly-away animation, the next card is
  // already at scale 1.0 (translateX driven it there). We need to reset
  // translateX to 0 before the React re-render so the incoming top card starts
  // centered — but that reset would instantly snap nextCardStyle back to
  // NEXT_SCALE, causing the flash. The lock freezes the next card at scale 1.0
  // for the 1-2 frames between the translateX reset and the React re-render.
  const nextCardLocked = useSharedValue(false);

  // ── Departure cloak ───────────────────────────────────────────────────────
  // When the fly-away animation finishes we must reset translateX to 0 so the
  // incoming card starts centered — but that reset puts the departing card back
  // at position 0 for 1-2 frames before the React re-render removes it.
  // Setting isLeaving = true makes the top card opacity 0 before the reset,
  // hiding the flash entirely.
  const isLeaving = useSharedValue(false);

  const prevIndexRef = useRef(currentIndex);

  useEffect(() => {
    if (currentIndex !== prevIndexRef.current) {
      prevIndexRef.current = currentIndex;
      // Re-render complete — unlock both guards. The new top card starts with
      // translateX already at 0, so everything computes to correct values.
      nextCardLocked.value = false;
      isLeaving.value = false;
    }
  }, [currentIndex, nextCardLocked, isLeaving]);

  // ── Prefetch upcoming album art ───────────────────────────────────────────
  // Pre-loads images for cards 3–5 ahead so they're in the native image cache
  // before the card slot receives a new track prop. Eliminates the flash caused
  // by Android's default fadeDuration firing on a cache-miss image load.
  useEffect(() => {
    for (let i = currentIndex + 3; i <= currentIndex + 5; i++) {
      const url = cards[i]?.album?.images?.[0]?.url;
      if (url) Image.prefetch(url);
    }
  }, [currentIndex, cards]);

  // ── Pan gesture ───────────────────────────────────────────────────────────
  const pan = Gesture.Pan()
    .minDistance(4)
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      const tx = translateX.value;
      const vx = e.velocityX;

      const pastThreshold = Math.abs(tx) > SWIPE_THRESHOLD;
      const fastSwipe = Math.abs(vx) > VELOCITY_THRESHOLD;

      if (pastThreshold || fastSwipe) {
        // Determine direction from position; fall back to velocity
        const direction: SwipeDirection =
          tx > 0 || (tx === 0 && vx > 0) ? 'right' : 'left';
        const targetX = direction === 'right' ? SCREEN_WIDTH * 1.5 : -SCREEN_WIDTH * 1.5;

        translateX.value = withTiming(targetX, { duration: 220 }, (finished) => {
          if (finished) {
            // Cloak the departing card before resetting translateX. Without this,
            // the reset snaps it back to position 0 for 1-2 frames before the
            // React re-render removes it — the visible "pop-back" flash.
            isLeaving.value = true;
            // Lock the next card at scale 1.0 BEFORE resetting translateX.
            // Without this, nextCardStyle would instantly snap from 1.0 → NEXT_SCALE
            // when translateX hits 0, causing the visible flash. The lock holds
            // for ~1-2 frames until the React re-render fires and useEffect unlocks.
            nextCardLocked.value = true;
            translateX.value = 0;
            runOnJS(onSwipe)(direction);
          }
        });
      } else {
        // Snap back to center
        translateX.value = withSpring(0, { damping: 18, stiffness: 200 });
      }
    });

  // ── Animated styles ───────────────────────────────────────────────────────

  const topCardStyle = useAnimatedStyle(() => {
    const rotate = `${(translateX.value / SCREEN_WIDTH) * 14}deg`;
    return {
      transform: [{ translateX: translateX.value }, { rotate }],
      // Cloaked while leaving so the translateX reset (0) is invisible.
      opacity: isLeaving.value ? 0 : 1,
    };
  });

  /** Second card scales up as the top card moves away. */
  const nextCardStyle = useAnimatedStyle(() => {
    // While locked, hold scale 1.0 so the translateX reset doesn't cause a snap.
    // This window lasts only 1-2 frames until the React re-render fires and the
    // useEffect unlocks. After unlock, slot-1 holds the new card and translateX
    // is already 0, so it correctly computes NEXT_SCALE — no discontinuity.
    if (nextCardLocked.value) {
      return { transform: [{ scale: 1.0 }, { translateY: 0 }] };
    }
    const scale = interpolate(
      Math.abs(translateX.value),
      [0, SWIPE_THRESHOLD],
      [NEXT_SCALE, 1.0],
      Extrapolation.CLAMP,
    );
    const offsetY = interpolate(
      Math.abs(translateX.value),
      [0, SWIPE_THRESHOLD],
      [NEXT_OFFSET_Y, 0],
      Extrapolation.CLAMP,
    );
    return {
      transform: [{ scale }, { translateY: offsetY }],
    };
  });

  const secondNextCardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: SECOND_SCALE }, { translateY: SECOND_OFFSET_Y }],
  }));

  // ── Empty state ───────────────────────────────────────────────────────────

  if (!topCard) {
    return (
      <View style={[styles.stackContainer, styles.emptyState]}>
        <Text style={styles.emptyText}>All songs reviewed</Text>
        <Text style={styles.emptySubtext}>Tap Done to review your lineup</Text>
      </View>
    );
  }

  return (
    <View style={styles.stackContainer}>
      {/* Third card — deepest in the stack, static */}
      {thirdCard && (
        <Animated.View style={[styles.cardPosition, secondNextCardStyle]}>
          <MissionCard
            track={thirdCard}
            isActive={false}
            progress={0}
          />
        </Animated.View>
      )}

      {/* Second card — scales up as top card leaves */}
      {nextCard && (
        <Animated.View style={[styles.cardPosition, nextCardStyle]}>
          <MissionCard
            track={nextCard}
            isActive={false}
            progress={0}
          />
        </Animated.View>
      )}

      {/* Top card — has the pan gesture and shows glow/tint effects */}
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.cardPosition, topCardStyle]}>
          <MissionCard
            track={topCard}
            translateX={translateX}
            isActive
            progress={audioProgress}
            onSeek={onSeek}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  stackContainer: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    alignSelf: 'center',
  },

  cardPosition: {
    ...StyleSheet.absoluteFillObject,
  },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  emptySubtext: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
  },
});
