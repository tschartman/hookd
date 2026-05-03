// ─── Mission Vibe Selection Screen ────────────────────────────────────────────
// Screen 2 in the mission flow: Purpose → Vibe → Swipe.
// User picks genres (required, 1-5), era(s) (optional, multi-select), and
// up to 2 "sounds like" artists (optional) before starting the swipe session.

import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';

import { MISSION_TEMPLATES } from '@/src/data/missionTemplates';
import { GENRES, GENRE_ICONS, type Genre, type Era } from '@/src/data/genreConfig';
import { searchArtistsByName, type ArtistResult } from '@/src/services/itunes';
import { useMissionStore } from '@/src/stores/missionStore';

// ─── Constants ────────────────────────────────────────────────────────────────

// Genre list comes from genreConfig — must match the `genre` column in genre_era_artists.
const ERA_PILL_OPTIONS: Array<Era | 'Any'> = ['Any', '60s', '70s', '80s', '90s', '00s', '10s', '20s'];

const MAX_GENRES = 5;
const MAX_SOUNDS_LIKE = 2;
const AUTOCOMPLETE_MIN_CHARS = 2;
const AUTOCOMPLETE_DEBOUNCE_MS = 300;

// ─── Genre Chip ───────────────────────────────────────────────────────────────

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

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    scale.value = withSpring(0.95, { duration: 80 }, () => {
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

// ─── Era Pill ─────────────────────────────────────────────────────────────────

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
      <Text style={[styles.eraPillText, selected && styles.eraPillTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function VibeScreen() {
  const { id: templateId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const createMission = useMissionStore((s) => s.createMission);

  const template = MISSION_TEMPLATES.find((t) => t.id === templateId);

  // ── Vibe state ─────────────────────────────────────────────────────────────
  const [selectedGenres, setSelectedGenres] = useState<string[]>(
    template?.suggestedGenres ?? [],
  );
  // Empty array = "Any era". Specific entries = filter to those eras.
  const [selectedEras, setSelectedEras] = useState<string[]>([]);
  const [soundsLikeArtists, setSoundsLikeArtists] = useState<ArtistResult[]>([]);

  // ── Autocomplete state ─────────────────────────────────────────────────────
  const [inputText, setInputText] = useState('');
  const [autocompleteResults, setAutocompleteResults] = useState<ArtistResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocompleteOpacity = useSharedValue(0);

  // ── Max-5 toast ────────────────────────────────────────────────────────────
  const [showMaxToast, setShowMaxToast] = useState(false);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Autocomplete search ────────────────────────────────────────────────────

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (inputText.length < AUTOCOMPLETE_MIN_CHARS) {
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

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputText]);

  const autocompleteStyle = useAnimatedStyle(() => ({
    opacity: autocompleteOpacity.value,
  }));

  // ── Handlers ──────────────────────────────────────────────────────────────

  const toggleGenre = useCallback(
    (genre: string) => {
      setSelectedGenres((prev) => {
        if (prev.includes(genre)) {
          return prev.filter((g) => g !== genre);
        }
        if (prev.length >= MAX_GENRES) {
          // Show "max 5" toast and deselect the oldest
          if (toastTimeout.current) clearTimeout(toastTimeout.current);
          setShowMaxToast(true);
          toastTimeout.current = setTimeout(() => setShowMaxToast(false), 1500);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          return [...prev.slice(1), genre];
        }
        Haptics.selectionAsync();
        return [...prev, genre];
      });
    },
    [],
  );

  const toggleEra = useCallback((era: string) => {
    Haptics.selectionAsync();
    if (era === 'Any') {
      setSelectedEras([]);
      return;
    }
    setSelectedEras((prev) => {
      if (prev.includes(era)) return prev.filter((e) => e !== era);
      return [...prev, era];
    });
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

  // ── Start mission ─────────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    if (!template) return;

    const missionId = createMission({
      templateId: template.id,
      name: template.name,
      icon: template.icon,
      excludeTags: template.excludeTags,
      fallbackSeedArtists: template.fallbackSeedArtists,
      fallbackMusicbrainzTags: template.fallbackMusicbrainzTags,
      energyTarget: template.energyTarget,
      suggestedCount: template.suggestedCount,
      vibeProfile: {
        selectedGenres,
        selectedEras,
        soundsLikeArtists: soundsLikeArtists.map((a) => a.name),
      },
    });

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace(`/mission/${missionId}`);
  }, [template, selectedGenres, selectedEras, soundsLikeArtists, createMission, router]);

  const handleSkip = useCallback(() => {
    if (!template) return;

    const missionId = createMission({
      templateId: template.id,
      name: template.name,
      icon: template.icon,
      excludeTags: template.excludeTags,
      fallbackSeedArtists: template.fallbackSeedArtists,
      fallbackMusicbrainzTags: template.fallbackMusicbrainzTags,
      energyTarget: template.energyTarget,
      suggestedCount: template.suggestedCount,
      vibeProfile: null, // surprise me — use template defaults
    });

    router.replace(`/mission/${missionId}`);
  }, [template, createMission, router]);

  // ── Error state ───────────────────────────────────────────────────────────

  if (!template) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Mission not found.</Text>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <Text style={styles.backLinkText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const canStart = selectedGenres.length >= 1;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}>

        {/* Back button */}
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>← Back</Text>
        </Pressable>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>

          {/* Header */}
          <Animated.View entering={FadeInDown.duration(300)} style={styles.headerSection}>
            <Text style={styles.missionIcon}>{template.icon}</Text>
            <Text style={styles.missionTitle}>{template.name} Mix</Text>
            <Text style={styles.missionQuestion}>What should it sound like?</Text>
          </Animated.View>

          {/* Genre Selection */}
          <Animated.View entering={FadeInDown.duration(300).delay(60)} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>Pick your genres</Text>
              <Text style={styles.sectionHint}>(1–5)</Text>
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

          {/* Era Selection */}
          <Animated.View entering={FadeInDown.duration(300).delay(120)} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>Any era preference?</Text>
              <Text style={styles.sectionHint}>(optional, pick multiple)</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.eraRow}>
              {ERA_PILL_OPTIONS.map((era) => (
                <EraPill
                  key={era}
                  label={era}
                  selected={era === 'Any' ? selectedEras.length === 0 : selectedEras.includes(era)}
                  onPress={() => toggleEra(era)}
                />
              ))}
            </ScrollView>
          </Animated.View>

          {/* Sounds Like */}
          {soundsLikeArtists.length < MAX_SOUNDS_LIKE && (
            <Animated.View entering={FadeInDown.duration(300).delay(180)} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>Sounds like...</Text>
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
                  <ActivityIndicator
                    size="small"
                    color="rgba(255,255,255,0.4)"
                    style={styles.inputSpinner}
                  />
                )}
              </View>

              {/* Autocomplete dropdown */}
              {autocompleteResults.length > 0 && (
                <Animated.View style={[styles.autocompleteDropdown, autocompleteStyle]}>
                  {autocompleteResults.map((artist, i) => (
                    <Animated.View
                      key={artist.id}
                      entering={FadeInDown.duration(150).delay(i * 30)}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.autocompleteRow,
                          pressed && styles.autocompleteRowPressed,
                          i < autocompleteResults.length - 1 && styles.autocompleteRowBorder,
                        ]}
                        onPress={() => selectArtist(artist)}>
                        {artist.imageUrl ? (
                          <Image
                            source={{ uri: artist.imageUrl }}
                            style={styles.artistThumb}
                          />
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

          {/* Sounds-like chips (selected artists) */}
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

          {/* Spacer for button area */}
          <View style={{ height: 120 }} />
        </ScrollView>

        {/* Sticky bottom — Start + Skip */}
        <View style={styles.bottomArea}>
          <Pressable
            style={[styles.startButton, !canStart && styles.startButtonDisabled]}
            onPress={handleStart}
            disabled={!canStart}>
            <Text style={[styles.startButtonText, !canStart && styles.startButtonTextDisabled]}>
              Build My Playlist →
            </Text>
          </Pressable>
          <Pressable onPress={handleSkip} style={styles.skipLink}>
            <Text style={styles.skipLinkText}>Skip — surprise me</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ACCENT = '#1DB954';
const ACCENT_DIM = 'rgba(29,185,84,0.15)';
const SURFACE = '#141414';
const BORDER = 'rgba(255,255,255,0.1)';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 16,
  },
  backLink: { marginTop: 8 },
  backLinkText: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: '600',
  },

  backButton: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  backButtonText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    fontWeight: '600',
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  headerSection: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 6,
  },
  missionIcon: {
    fontSize: 40,
    marginBottom: 4,
  },
  missionTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  missionQuestion: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 15,
  },

  // ── Sections ───────────────────────────────────────────────────────────────
  section: {
    marginBottom: 24,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  sectionLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  sectionHint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    fontFamily: 'SpaceMono',
  },

  // ── Genre chips ────────────────────────────────────────────────────────────
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: ACCENT_DIM,
    borderColor: ACCENT,
  },
  chipIcon: {
    fontSize: 13,
  },
  chipText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: ACCENT,
  },

  maxToast: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  maxToastText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },

  // ── Era pills ──────────────────────────────────────────────────────────────
  eraRow: {
    gap: 8,
    paddingRight: 8,
  },
  eraPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
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
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
  },
  eraPillTextSelected: {
    color: ACCENT,
  },

  // ── Sounds like input ──────────────────────────────────────────────────────
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    height: 48,
  },
  artistInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    height: '100%',
  },
  inputSpinner: {
    marginLeft: 8,
  },

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
    paddingVertical: 10,
    gap: 12,
  },
  autocompleteRowPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  autocompleteRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  artistThumb: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#333',
  },
  artistThumbPlaceholder: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  autocompleteArtistName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },

  // ── Selected artist chips ──────────────────────────────────────────────────
  soundsLikeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  artistChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ACCENT_DIM,
    borderWidth: 1,
    borderColor: ACCENT,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 8,
  },
  artistChipThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  artistChipName: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '600',
  },
  artistChipRemove: {
    color: ACCENT,
    fontSize: 16,
    fontWeight: '400',
    marginLeft: -2,
  },

  // ── Bottom area ────────────────────────────────────────────────────────────
  bottomArea: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 16 : 24,
    paddingTop: 12,
    gap: 12,
    backgroundColor: '#0A0A0A',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
    alignItems: 'center',
  },
  startButton: {
    width: '100%',
    height: 52,
    borderRadius: 26,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonDisabled: {
    backgroundColor: 'rgba(29,185,84,0.25)',
  },
  startButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  startButtonTextDisabled: {
    color: 'rgba(0,0,0,0.4)',
  },
  skipLink: {
    paddingVertical: 4,
  },
  skipLinkText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 13,
  },
});
