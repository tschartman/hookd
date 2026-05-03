// ─── MissionFilterSheet ───────────────────────────────────────────────────────
// Optional genre/era/sounds-like filter for missions.
// Slides up from the bottom as an overlay. Tapping the backdrop dismisses it.

import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';

import { GENRES, GENRE_ICONS, type Genre, type Era } from '@/src/data/genreConfig';
import { searchArtistsByName, type ArtistResult } from '@/src/services/itunes';
import type { MissionFilter } from '@/src/stores/missionStore';

// ─── Constants ────────────────────────────────────────────────────────────────

const ERA_OPTIONS: Array<Era | 'Any'> = ['Any', '60s', '70s', '80s', '90s', '00s', '10s', '20s'];
const MAX_GENRES = 5;
const MAX_SOUNDS_LIKE = 2;
const AUTOCOMPLETE_DEBOUNCE_MS = 300;

const ACCENT = '#1DB954';
const ACCENT_DIM = 'rgba(29,185,84,0.15)';
const SURFACE = '#141414';
const BORDER = 'rgba(255,255,255,0.1)';

// ─── Sub-components ───────────────────────────────────────────────────────────

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function GenreChip({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = () => {
    scale.value = withSpring(0.93, { duration: 80 }, () => {
      scale.value = withSpring(1, { duration: 120 });
    });
    onPress();
  };

  return (
    <AnimatedPressable
      style={[styles.chip, selected && styles.chipSelected, animStyle]}
      onPress={handlePress}>
      {icon ? <Text style={styles.chipIcon}>{icon}</Text> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </AnimatedPressable>
  );
}

function EraPill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.eraPill, selected && styles.eraPillSelected]}
      onPress={onPress}>
      <Text style={[styles.eraPillText, selected && styles.eraPillTextSelected]}>{label}</Text>
    </Pressable>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  isLoading?: boolean;
  initialFilter?: MissionFilter | null;
  onApply: (filter: MissionFilter) => void;
  onClose: () => void;
};

export default function MissionFilterSheet({
  visible,
  isLoading = false,
  initialFilter,
  onApply,
  onClose,
}: Props) {
  // ── Local state ──────────────────────────────────────────────────────────
  const [selectedGenres, setSelectedGenres] = useState<string[]>(
    initialFilter?.genres ?? [],
  );
  const [selectedEras, setSelectedEras] = useState<string[]>(
    initialFilter?.eras ?? [],
  );
  const [soundsLikeArtists, setSoundsLikeArtists] = useState<ArtistResult[]>([]);

  const [inputText, setInputText] = useState('');
  const [autocompleteResults, setAutocompleteResults] = useState<ArtistResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocompleteOpacity = useSharedValue(0);

  const [showMaxToast, setShowMaxToast] = useState(false);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync with initialFilter whenever the sheet opens
  useEffect(() => {
    if (visible) {
      setSelectedGenres(initialFilter?.genres ?? []);
      setSelectedEras(initialFilter?.eras ?? []);
      setSoundsLikeArtists([]);
      setInputText('');
      setAutocompleteResults([]);
    }
  }, [visible]);

  // ── Slide animation ──────────────────────────────────────────────────────
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

  // ── Autocomplete ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (inputText.length < 2) {
      setAutocompleteResults([]);
      autocompleteOpacity.value = withTiming(0, { duration: 150 });
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchArtistsByName(inputText, 5);
        setAutocompleteResults(results);
        if (results.length > 0) {
          autocompleteOpacity.value = withTiming(1, { duration: 150 });
        }
      } catch {
        setAutocompleteResults([]);
      } finally {
        setIsSearching(false);
      }
    }, AUTOCOMPLETE_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputText]);

  const autocompleteStyle = useAnimatedStyle(() => ({ opacity: autocompleteOpacity.value }));

  // ── Handlers ─────────────────────────────────────────────────────────────

  const toggleGenre = useCallback((genre: string) => {
    setSelectedGenres((prev) => {
      if (prev.includes(genre)) return prev.filter((g) => g !== genre);
      if (prev.length >= MAX_GENRES) {
        if (toastTimeout.current) clearTimeout(toastTimeout.current);
        setShowMaxToast(true);
        toastTimeout.current = setTimeout(() => setShowMaxToast(false), 1500);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return [...prev.slice(1), genre];
      }
      Haptics.selectionAsync();
      return [...prev, genre];
    });
  }, []);

  const toggleEra = useCallback((era: string) => {
    Haptics.selectionAsync();
    if (era === 'Any') {
      setSelectedEras([]);
      return;
    }
    setSelectedEras((prev) =>
      prev.includes(era) ? prev.filter((e) => e !== era) : [...prev, era],
    );
  }, []);

  const selectArtist = useCallback(
    (artist: ArtistResult) => {
      if (soundsLikeArtists.length >= MAX_SOUNDS_LIKE) return;
      setSoundsLikeArtists((prev) => {
        if (prev.some((a) => a.id === artist.id)) return prev;
        return [...prev, artist];
      });
      setInputText('');
      setAutocompleteResults([]);
      autocompleteOpacity.value = withTiming(0, { duration: 100 });
      Haptics.selectionAsync();
    },
    [soundsLikeArtists.length],
  );

  const removeArtist = useCallback((id: string) => {
    setSoundsLikeArtists((prev) => prev.filter((a) => a.id !== id));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleApply = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onApply({
      genres: selectedGenres,
      eras: selectedEras,
      soundsLikeArtists: soundsLikeArtists.map((a) => a.name),
    });
    onClose();
  }, [selectedGenres, selectedEras, soundsLikeArtists, onApply, onClose]);

  const handleClear = useCallback(() => {
    setSelectedGenres([]);
    setSelectedEras([]);
    setSoundsLikeArtists([]);
    Haptics.selectionAsync();
  }, []);

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View style={[styles.sheet, sheetStyle]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}>

          {/* Handle bar */}
          <View style={styles.handleBar} />

          {/* Header */}
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Customize Your Mix</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.closeButton}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>

            {/* Genres */}
            <Animated.View entering={FadeInDown.duration(200)} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>Genres</Text>
                <Text style={styles.sectionHint}>(optional, up to 5)</Text>
              </View>
              <View style={styles.chipGrid}>
                {GENRES.map((genre) => (
                  <GenreChip
                    key={genre}
                    label={genre}
                    icon={GENRE_ICONS[genre as Genre]}
                    selected={selectedGenres.includes(genre)}
                    onPress={() => toggleGenre(genre)}
                  />
                ))}
              </View>
              {showMaxToast && (
                <Animated.View entering={FadeIn.duration(150)} style={styles.maxToast}>
                  <Text style={styles.maxToastText}>Max 5 genres — oldest replaced</Text>
                </Animated.View>
              )}
            </Animated.View>

            {/* Eras */}
            <Animated.View entering={FadeInDown.duration(200).delay(40)} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>Era</Text>
                <Text style={styles.sectionHint}>(optional)</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.eraRow}>
                {ERA_OPTIONS.map((era) => (
                  <EraPill
                    key={era}
                    label={era}
                    selected={era === 'Any' ? selectedEras.length === 0 : selectedEras.includes(era)}
                    onPress={() => toggleEra(era)}
                  />
                ))}
              </ScrollView>
            </Animated.View>

            {/* Sounds like */}
            {soundsLikeArtists.length < MAX_SOUNDS_LIKE && (
              <Animated.View entering={FadeInDown.duration(200).delay(80)} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionLabel}>Sounds like</Text>
                  <Text style={styles.sectionHint}>(optional)</Text>
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.artistInput}
                    value={inputText}
                    onChangeText={setInputText}
                    placeholder="Type an artist name"
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    returnKeyType="search"
                    autoCorrect={false}
                    autoCapitalize="words"
                  />
                  {isSearching && (
                    <ActivityIndicator size="small" color="rgba(255,255,255,0.4)" style={styles.inputSpinner} />
                  )}
                </View>
                {autocompleteResults.length > 0 && (
                  <Animated.View style={[styles.autocompleteDropdown, autocompleteStyle]}>
                    {autocompleteResults.map((artist, i) => (
                      <Animated.View key={artist.id} entering={FadeInDown.duration(120).delay(i * 25)}>
                        <Pressable
                          style={({ pressed }) => [
                            styles.autocompleteRow,
                            pressed && styles.autocompleteRowPressed,
                            i < autocompleteResults.length - 1 && styles.autocompleteRowBorder,
                          ]}
                          onPress={() => selectArtist(artist)}>
                          {artist.imageUrl ? (
                            <Image source={{ uri: artist.imageUrl }} style={styles.artistThumb} />
                          ) : (
                            <View style={[styles.artistThumb, styles.artistThumbPlaceholder]} />
                          )}
                          <Text style={styles.autocompleteArtistName}>{artist.name}</Text>
                        </Pressable>
                      </Animated.View>
                    ))}
                  </Animated.View>
                )}
              </Animated.View>
            )}

            {/* Selected artist chips */}
            {soundsLikeArtists.length > 0 && (
              <View style={styles.soundsLikeChips}>
                {soundsLikeArtists.map((artist) => (
                  <Pressable
                    key={artist.id}
                    style={styles.artistChip}
                    onPress={() => removeArtist(artist.id)}>
                    {artist.imageUrl ? (
                      <Image source={{ uri: artist.imageUrl }} style={styles.artistChipThumb} />
                    ) : null}
                    <Text style={styles.artistChipName}>{artist.name}</Text>
                    <Text style={styles.artistChipRemove}>×</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <View style={{ height: 16 }} />
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <Pressable
              style={[styles.applyButton, isLoading && styles.applyButtonLoading]}
              onPress={handleApply}
              disabled={isLoading}>
              {isLoading ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text style={styles.applyButtonText}>Apply Filters</Text>
              )}
            </Pressable>
            <Pressable onPress={handleClear} style={styles.clearLink}>
              <Text style={styles.clearLinkText}>Clear all</Text>
            </Pressable>
          </View>

        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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

  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },

  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  sheetTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  closeButton: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 16,
    fontWeight: '600',
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },

  section: {
    marginBottom: 22,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  sectionLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  sectionHint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 11,
    fontFamily: 'SpaceMono',
  },

  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BORDER,
  },
  chipSelected: {
    backgroundColor: ACCENT_DIM,
    borderColor: ACCENT,
  },
  chipIcon: { fontSize: 12 },
  chipText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextSelected: { color: ACCENT },

  maxToast: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  maxToastText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
  },

  eraRow: { gap: 8, paddingRight: 8 },
  eraPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BORDER,
  },
  eraPillSelected: {
    backgroundColor: ACCENT_DIM,
    borderColor: ACCENT,
  },
  eraPillText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
  },
  eraPillTextSelected: { color: ACCENT },

  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    height: 44,
  },
  artistInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    height: '100%',
  },
  inputSpinner: { marginLeft: 8 },

  autocompleteDropdown: {
    backgroundColor: '#1C1C1C',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  autocompleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 12,
  },
  autocompleteRowPressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  autocompleteRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  artistThumb: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#333',
  },
  artistThumbPlaceholder: { backgroundColor: 'rgba(255,255,255,0.08)' },
  autocompleteArtistName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },

  soundsLikeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  artistChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ACCENT_DIM,
    borderWidth: 1,
    borderColor: ACCENT,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 7,
  },
  artistChipThumb: { width: 20, height: 20, borderRadius: 10 },
  artistChipName: { color: ACCENT, fontSize: 12, fontWeight: '600' },
  artistChipRemove: { color: ACCENT, fontSize: 15, fontWeight: '400', marginLeft: -2 },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  applyButton: {
    width: '100%',
    height: 50,
    borderRadius: 25,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyButtonLoading: { opacity: 0.7 },
  applyButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  clearLink: { paddingVertical: 4 },
  clearLinkText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
  },
});
