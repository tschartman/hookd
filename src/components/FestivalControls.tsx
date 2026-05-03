import { useEffect } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

// ─── Slider ───────────────────────────────────────────────────────────────────

const THUMB_SIZE = 22;

type SliderProps = {
  value: number; // 0 = Popular, 1 = Discovery
  onChangeEnd: (v: number) => void;
};

const FestivalSlider = ({ value, onChangeEnd }: SliderProps) => {
  const trackWidth = useSharedValue(0);
  const offset = useSharedValue(value);
  const startOffset = useSharedValue(value);

  // Animate thumb when the controlled value is set externally (e.g., label tap)
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
    transform: [
      { translateX: offset.value * Math.max(0, trackWidth.value - THUMB_SIZE) },
    ],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: offset.value * trackWidth.value,
  }));

  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.sliderTrack}
        onLayout={(e) => {
          trackWidth.value = e.nativeEvent.layout.width;
          // Reposition thumb after layout is known
          offset.value = value;
        }}
      >
        <Animated.View style={[styles.sliderFill, fillStyle]} />
        <Animated.View style={[styles.sliderThumb, thumbStyle]} />
      </View>
    </GestureDetector>
  );
};

// ─── Controls panel ───────────────────────────────────────────────────────────

type Props = {
  sliderValue: number;
  onSliderChange: (v: number) => void;
  genres: string[];
  activeGenres: Set<string> | null; // null = all active
  onGenreToggle: (genre: string) => void;
  onAllGenres: () => void;
};

const FestivalControls = ({
  sliderValue,
  onSliderChange,
  genres,
  activeGenres,
  onGenreToggle,
  onAllGenres,
}: Props) => {
  return (
    <View style={styles.container}>
      {/* Popular ↔ Discovery slider */}
      <View style={styles.sliderRow}>
        <Pressable onPress={() => onSliderChange(0)} hitSlop={10}>
          <Text style={[styles.sliderLabel, sliderValue < 0.25 && styles.sliderLabelActive]}>
            Popular
          </Text>
        </Pressable>

        <View style={styles.sliderWrapper}>
          <FestivalSlider value={sliderValue} onChangeEnd={onSliderChange} />
        </View>

        <Pressable onPress={() => onSliderChange(1)} hitSlop={10}>
          <Text style={[styles.sliderLabel, styles.sliderLabelRight, sliderValue > 0.75 && styles.sliderLabelActive]}>
            Discovery
          </Text>
        </Pressable>
      </View>

      {/* Genre filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chipsContent}
      >
        {/* "All" chip */}
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
      </ScrollView>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(10,10,10,0.92)',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },

  // Slider
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sliderLabel: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    fontFamily: 'SpaceMono',
    minWidth: 46,
  },
  sliderLabelRight: {
    textAlign: 'right',
  },
  sliderLabelActive: {
    color: '#1DB954',
  },
  sliderWrapper: {
    flex: 1,
    paddingVertical: 10, // expand hit area
  },
  sliderTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    justifyContent: 'center',
  },
  sliderFill: {
    position: 'absolute',
    height: 3,
    backgroundColor: '#1DB954',
    borderRadius: 2,
    left: 0,
  },
  sliderThumb: {
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

  // Genre chips
  chipsScroll: {
    flexGrow: 0,
  },
  chipsContent: {
    gap: 6,
    paddingRight: 8,
  },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  chipActive: {
    backgroundColor: 'rgba(29,185,84,0.18)',
    borderColor: '#1DB954',
  },
  chipText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontFamily: 'SpaceMono',
  },
  chipTextActive: {
    color: '#1DB954',
  },
});

export default FestivalControls;
