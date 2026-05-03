import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ExportFlow from '@/src/components/ExportFlow';
import { discoverTracksFromItunes } from '@/src/services/itunes';
import { useSessionStore } from '@/src/stores/sessionStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatExportDate(): string {
  const d = new Date();
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  return `${month} ${day}`;
}

/** Search iTunes for vibe-matched tracks using the session's keyword list. */
async function fetchVibeMatches(
  keywords: string[],
  targetCount: number,
): Promise<{ trackName: string; artistName: string }[]> {
  if (!keywords.length) return [];

  const seen = new Set<string>();
  const results: { trackName: string; artistName: string }[] = [];
  const perKeyword = Math.ceil(targetCount / keywords.length);

  for (const kw of keywords) {
    if (results.length >= targetCount) break;
    try {
      const tracks = await discoverTracksFromItunes([kw], perKeyword);
      for (const t of tracks) {
        const key = `${t.name}|${t.artists[0]?.name ?? ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ trackName: t.name, artistName: t.artists[0]?.name ?? '' });
        }
        if (results.length >= targetCount) break;
      }
    } catch {
      // skip failed keyword
    }
    // Respect iTunes rate limit between keyword fetches
    await new Promise((r) => setTimeout(r, 60));
  }

  return results;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ExportVibeFAB() {
  const insets = useSafeAreaInsets();
  const vibeStage = useSessionStore((s) => s.vibeStage);
  const vibeLabel = useSessionStore((s) => s.vibeLabel);
  const vibeKeywords = useSessionStore((s) => s.vibeKeywords);
  const saves = useSessionStore((s) => s.saves);

  const [exportVisible, setExportVisible] = useState(false);
  const [exportTracks, setExportTracks] = useState<
    { trackName: string; artistName: string }[]
  >([]);
  const [isFetching, setIsFetching] = useState(false);

  // Bounce-in when stage reaches 'locked'
  const scale = useSharedValue(0);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  useEffect(() => {
    if (vibeStage === 'locked') {
      scale.value = withDelay(400, withSpring(1, { damping: 12, stiffness: 140 }));
    } else {
      scale.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vibeStage]);

  if (vibeStage !== 'locked' || !vibeLabel) return null;

  const playlistName = `HOOKD Vibe — ${vibeLabel} — ${formatExportDate()}`;
  const playlistDescription = `A HOOKD discovery session — ${vibeLabel}`;

  const handlePress = async () => {
    if (isFetching) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsFetching(true);

    try {
      // Saves go first, then 40 vibe-matched songs from iTunes
      const savedTracks = saves.map((t) => ({
        trackName: t.name,
        artistName: t.artists[0]?.name ?? '',
      }));

      const vibeMatches = await fetchVibeMatches(vibeKeywords, 40);

      // Deduplicate: drop matches already in saves
      const savedSet = new Set(savedTracks.map((t) => `${t.trackName}|${t.artistName}`));
      const uniqueMatches = vibeMatches.filter(
        (t) => !savedSet.has(`${t.trackName}|${t.artistName}`),
      );

      setExportTracks([...savedTracks, ...uniqueMatches.slice(0, 40)]);
    } catch {
      // Fallback: export just the session saves
      setExportTracks(
        saves.map((t) => ({
          trackName: t.name,
          artistName: t.artists[0]?.name ?? '',
        })),
      );
    } finally {
      setIsFetching(false);
      setExportVisible(true);
    }
  };

  return (
    <>
      <Animated.View
        style={[styles.fabWrap, { bottom: insets.bottom + 20 }, animStyle]}
      >
        <Pressable
          onPress={handlePress}
          disabled={isFetching}
          style={({ pressed }) => [styles.fab, pressed && { opacity: 0.88 }]}
        >
          <LinearGradient
            colors={['#1DB954', '#17a349']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          {isFetching ? (
            <ActivityIndicator color="#000" />
          ) : (
            <>
              <Text style={styles.fabLabel} numberOfLines={1}>
                {vibeLabel}
              </Text>
              <Text style={styles.fabCta}>Export Vibe →</Text>
            </>
          )}
        </Pressable>
      </Animated.View>

      <ExportFlow
        visible={exportVisible}
        tracks={exportTracks}
        playlistName={playlistName}
        playlistDescription={playlistDescription}
        onDismiss={() => setExportVisible(false)}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fabWrap: {
    position: 'absolute',
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  fab: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    gap: 2,
    shadowColor: '#1DB954',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabLabel: {
    color: '#000',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'SpaceMono',
    opacity: 0.65,
    letterSpacing: 0.3,
  },
  fabCta: {
    color: '#000',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
