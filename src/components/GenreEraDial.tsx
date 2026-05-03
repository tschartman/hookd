// ─── GenreEraDial ─────────────────────────────────────────────────────────────
// Collapsed pill showing current genre × era. Expands into an overlay selector.

import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ERAS,
  GENRE_ERA_SEEDS,
  GENRE_ICONS,
  GENRES,
  type Era,
  type Genre,
} from '@/src/data/genreEraSeeds';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  currentEra: Era;
  currentGenre: Genre;
  isLoading: boolean;
  onEraChange: (era: Era) => void;
  onGenreChange: (genre: Genre) => void;
  onRandomize: () => void;
  /**
   * Increment this value to programmatically open the dial from the parent
   * (e.g. from the feed-exhaustion completion card's "Spin the Dial" button).
   * Uses a counter rather than a boolean so re-pressing the button always fires.
   */
  openTrigger?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GenreEraDial({
  currentEra,
  currentGenre,
  isLoading,
  onEraChange,
  onGenreChange,
  onRandomize,
  openTrigger,
}: Props) {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);

  // Overlay animation
  const overlayOpacity = useSharedValue(0);
  const overlayScale = useSharedValue(0.95);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
    transform: [{ scale: overlayScale.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const expand = useCallback(() => {
    setExpanded(true);
    overlayOpacity.value = withTiming(1, { duration: 180 });
    overlayScale.value = withTiming(1, { duration: 180 });
  }, [overlayOpacity, overlayScale]);

  const collapse = useCallback(() => {
    overlayOpacity.value = withTiming(0, { duration: 150 });
    overlayScale.value = withTiming(0.95, { duration: 150 });
    setTimeout(() => setExpanded(false), 160);
  }, [overlayOpacity, overlayScale]);

  // Open the dial when the parent increments openTrigger
  useEffect(() => {
    if (openTrigger && openTrigger > 0) expand();
  // expand is stable (useCallback with no deps) so it's safe to omit here
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTrigger]);

  // Era tap: update era but keep dial open so user can also pick a genre
  const handleEraSelect = useCallback((era: Era) => {
    onEraChange(era);
    // intentionally do NOT collapse — user selects genre next (or taps outside)
  }, [onEraChange]);

  const handleGenreSelect = useCallback((genre: Genre) => {
    onGenreChange(genre);
    collapse();
  }, [onGenreChange, collapse]);

  const handleRandomize = useCallback(() => {
    onRandomize();
    collapse();
  }, [onRandomize, collapse]);

  const availableEras = GENRE_ERA_SEEDS[currentGenre].availableEras;

  return (
    <>
      {/* ── Collapsed pill ───────────────────────────────────────────────── */}
      <View style={[styles.pillRow, { top: insets.top + 8 }]} pointerEvents="box-none">
      <TouchableOpacity
        onPress={expand}
        style={styles.pill}
        activeOpacity={0.75}
      >
        <Text style={styles.pillText}>
          {currentEra} · {currentGenre}
        </Text>
        {isLoading ? (
          <View style={styles.loadingDot} />
        ) : (
          <Text style={styles.chevron}>▾</Text>
        )}
      </TouchableOpacity>
      </View>

      {/* ── Expanded overlay ─────────────────────────────────────────────── */}
      {expanded && (
        <>
          {/* Backdrop — tap to close */}
          <Animated.View
            style={[styles.backdrop, backdropStyle]}
            pointerEvents="auto"
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={collapse} />
          </Animated.View>

          {/* Selector panel */}
          <Animated.View
            style={[styles.panel, { top: insets.top + 4 }, overlayStyle]}
            pointerEvents="auto"
          >
            {/* ── Era row ────────────────────────────────────────────────── */}
            <Text style={styles.sectionLabel}>ERA</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.eraRow}
            >
              {ERAS.map((era) => {
                const available = availableEras.includes(era);
                const selected = era === currentEra;
                return (
                  <TouchableOpacity
                    key={era}
                    onPress={() => available && handleEraSelect(era)}
                    style={[
                      styles.eraChip,
                      selected && styles.eraChipSelected,
                      !available && styles.eraChipUnavailable,
                    ]}
                    activeOpacity={available ? 0.7 : 1}
                  >
                    <Text
                      style={[
                        styles.eraChipText,
                        selected && styles.eraChipTextSelected,
                        !available && styles.eraChipTextUnavailable,
                      ]}
                    >
                      {era}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* ── Genre grid ─────────────────────────────────────────────── */}
            <Text style={[styles.sectionLabel, { marginTop: 16 }]}>GENRE</Text>
            <View style={styles.genreGrid}>
              {GENRES.map((genre) => {
                const selected = genre === currentGenre;
                return (
                  <TouchableOpacity
                    key={genre}
                    onPress={() => handleGenreSelect(genre)}
                    style={[styles.genreChip, selected && styles.genreChipSelected]}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.genreIcon}>{GENRE_ICONS[genre]}</Text>
                    <Text
                      style={[
                        styles.genreChipText,
                        selected && styles.genreChipTextSelected,
                      ]}
                    >
                      {genre}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── Surprise Me ────────────────────────────────────────────── */}
            <TouchableOpacity
              onPress={handleRandomize}
              style={styles.surpriseBtn}
              activeOpacity={0.8}
            >
              <Text style={styles.surpriseBtnText}>🎲 Surprise Me</Text>
            </TouchableOpacity>
          </Animated.View>
        </>
      )}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Collapsed pill — pillRow centers it, pill is the visual button
  pillRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chevron: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 14,
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  loadingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1DB954',
  },

  // Backdrop
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
    zIndex: 20,
  },

  // Selector panel
  panel: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    padding: 20,
    zIndex: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  sectionLabel: {
    color: '#666',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 10,
  },

  // Era row
  eraRow: {
    gap: 8,
    paddingRight: 8,
  },
  eraChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#2A2A2A',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  eraChipSelected: {
    backgroundColor: '#1DB954',
    borderColor: '#1DB954',
  },
  eraChipUnavailable: {
    opacity: 0.3,
  },
  eraChipText: {
    color: '#CCC',
    fontSize: 14,
    fontWeight: '600',
  },
  eraChipTextSelected: {
    color: '#000',
  },
  eraChipTextUnavailable: {
    color: '#555',
  },

  // Genre grid
  genreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#2A2A2A',
  },
  genreChipSelected: {
    backgroundColor: '#1DB954',
  },
  genreIcon: {
    fontSize: 13,
  },
  genreChipText: {
    color: '#CCC',
    fontSize: 13,
    fontWeight: '500',
  },
  genreChipTextSelected: {
    color: '#000',
    fontWeight: '600',
  },

  // Surprise Me button
  surpriseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 50,
    paddingVertical: 12,
  },
  surpriseBtnText: {
    color: '#0A0A0A',
    fontSize: 15,
    fontWeight: '700',
  },
});
