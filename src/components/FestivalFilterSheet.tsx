// ─── FestivalFilterSheet ──────────────────────────────────────────────────────
// Popular↔Discovery slider + genre filter chips for festival feed.
// Slides up from the bottom as an overlay. Tapping the backdrop dismisses it.
// All changes apply immediately (parent reshuffles on state change).

import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

// ─── Slider ───────────────────────────────────────────────────────────────────

const THUMB_SIZE = 22;

type SliderProps = {
  value: number;
  onChangeEnd: (v: number) => void;
};

function FestivalSlider({ value, onChangeEnd }: SliderProps) {
  const trackWidth = useSharedValue(0);
  const offset = useSharedValue(value);
  const startOffset = useSharedValue(value);

  useEffect(() => {
    offset.value = withSpring(value, { damping: 20, stiffness: 300 });
  }, [value]);

  const pan = Gesture.Pan()
    .onBegin(() => {
      cancelAnimation(offset);
      startOffset.value = offset.value;
    })
    .onUpdate((e) => {
      if (trackWidth.value <= 0) return;
      const delta = e.translationX / trackWidth.value;
      offset.value = Math.max(0, Math.min(1, startOffset.value + delta));
    })
    .onEnd(() => {
      runOnJS(onChangeEnd)(offset.value);
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value * Math.max(0, trackWidth.value - THUMB_SIZE) }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    width: offset.value * trackWidth.value,
  }));

  return (
    <GestureDetector gesture={pan}>
      <View
        style={sliderStyles.track}
        onLayout={(e) => {
          trackWidth.value = e.nativeEvent.layout.width;
          offset.value = value;
        }}
      >
        <Animated.View style={[sliderStyles.fill, fillStyle]} />
        <Animated.View style={[sliderStyles.thumb, thumbStyle]} />
      </View>
    </GestureDetector>
  );
}

const sliderStyles = StyleSheet.create({
  track: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    height: 3,
    backgroundColor: '#1DB954',
    borderRadius: 2,
    left: 0,
  },
  thumb: {
    position: 'absolute',
    top: -(THUMB_SIZE / 2 - 1.5),
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
  },
});

// ─── Main component ───────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  sliderValue: number;
  onSliderChange: (v: number) => void;
  genres: string[];
  activeGenres: Set<string> | null;
  onGenreToggle: (genre: string) => void;
  onAllGenres: () => void;
  onClose: () => void;
  onResetProgress?: () => void;
  canResetProgress?: boolean;
};

export default function FestivalFilterSheet({
  visible,
  sliderValue,
  onSliderChange,
  genres,
  activeGenres,
  onGenreToggle,
  onAllGenres,
  onClose,
  onResetProgress,
  canResetProgress = false,
}: Props) {
  const translateY = useSharedValue(600);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      backdropOpacity.value = withTiming(1, { duration: 250 });
      translateY.value = withSpring(0, { damping: 22, stiffness: 280 });
    } else {
      backdropOpacity.value = withTiming(0, { duration: 200 });
      translateY.value = withTiming(600, { duration: 220 });
    }
  }, [visible]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  if (!visible) return null;

  const hasActiveFilter = activeGenres !== null || Math.abs(sliderValue - 0.25) > 0.01;

  const handleClear = () => {
    onAllGenres();
    onSliderChange(0.25);
    Haptics.selectionAsync();
  };

  const handleResetProgress = () => {
    onResetProgress?.();
    onClose();
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View style={[styles.sheet, sheetStyle]}>
        {/* Handle bar */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Lineup Filters</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.closeX}>✕</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Artist mix slider */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Artist Mix</Text>
            <View style={styles.sliderRow}>
              <Pressable onPress={() => onSliderChange(0)} hitSlop={10}>
                <Text style={[styles.sliderEnd, sliderValue < 0.25 && styles.sliderEndActive]}>
                  Popular
                </Text>
              </Pressable>
              <View style={styles.sliderWrapper}>
                <FestivalSlider value={sliderValue} onChangeEnd={onSliderChange} />
              </View>
              <Pressable onPress={() => onSliderChange(1)} hitSlop={10}>
                <Text style={[styles.sliderEnd, styles.sliderEndRight, sliderValue > 0.75 && styles.sliderEndActive]}>
                  Discovery
                </Text>
              </Pressable>
            </View>
            <Text style={styles.sliderHint}>
              {sliderValue < 0.25
                ? 'More headliners and big names'
                : sliderValue > 0.75
                  ? 'More openers and hidden gems'
                  : 'Balanced mix of all tiers'}
            </Text>
          </View>

          {/* Genre chips */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Genres</Text>
            <View style={styles.chipGrid}>
              <Pressable
                onPress={onAllGenres}
                style={[styles.chip, activeGenres === null && styles.chipActive]}
              >
                <Text style={[styles.chipText, activeGenres === null && styles.chipTextActive]}>
                  All
                </Text>
              </Pressable>
              {genres.map((genre) => {
                const isActive = activeGenres !== null && activeGenres.has(genre);
                return (
                  <Pressable
                    key={genre}
                    onPress={() => onGenreToggle(genre)}
                    style={[styles.chip, isActive && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                      {genre}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ height: 8 }} />
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable style={styles.doneButton} onPress={onClose}>
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>

          <View style={styles.footerLinks}>
            {hasActiveFilter && (
              <Pressable onPress={handleClear} style={styles.footerLink}>
                <Text style={styles.footerLinkText}>Clear filters</Text>
              </Pressable>
            )}
            {canResetProgress && onResetProgress && (
              <Pressable onPress={handleResetProgress} style={styles.footerLink}>
                <Text style={[styles.footerLinkText, styles.resetText]}>Reset discovery progress</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ACCENT = '#1DB954';
const ACCENT_DIM = 'rgba(29,185,84,0.15)';
const BORDER = 'rgba(255,255,255,0.1)';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },

  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#111111',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },

  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  closeX: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 16,
    fontWeight: '600',
  },

  content: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },

  section: {
    marginBottom: 24,
    gap: 10,
  },
  sectionLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // Slider
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sliderEnd: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    fontFamily: 'SpaceMono',
    minWidth: 52,
  },
  sliderEndRight: {
    textAlign: 'right',
  },
  sliderEndActive: {
    color: ACCENT,
  },
  sliderWrapper: {
    flex: 1,
    paddingVertical: 10,
  },
  sliderHint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 11,
    fontFamily: 'SpaceMono',
    textAlign: 'center',
  },

  // Genre chips
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BORDER,
  },
  chipActive: {
    backgroundColor: ACCENT_DIM,
    borderColor: ACCENT,
  },
  chipText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: ACCENT,
  },

  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  doneButton: {
    width: '100%',
    height: 50,
    borderRadius: 25,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  footerLinks: {
    flexDirection: 'row',
    gap: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerLink: {
    paddingVertical: 4,
  },
  footerLinkText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
  },
  resetText: {
    color: 'rgba(255,80,80,0.6)',
  },
});
