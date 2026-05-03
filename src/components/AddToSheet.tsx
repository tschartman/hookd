// ─── AddToSheet ────────────────────────────────────────────────────────────────
// Bottom sheet for adding the current track to any existing collection or mission.
// Tapping a row toggles the track in/out — checkmark shows current state.

import * as Haptics from 'expo-haptics';
import { useEffect, useMemo } from 'react';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import type { SpotifyTrack } from '@/src/services/spotify';
import { useCollectionStore, type Collection } from '@/src/stores/collectionStore';
import { useMissionStore, type Mission } from '@/src/stores/missionStore';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  track: SpotifyTrack | null;
  visible: boolean;
  onClose: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AddToSheet({ track, visible, onClose }: Props) {
  // Select the raw maps — stable references that only change when data changes.
  // Sorting in useMemo avoids returning a new array from the selector every
  // render, which would cause Zustand's referential equality check to fire
  // an infinite re-render loop.
  const collectionsMap = useCollectionStore((s) => s.collections);
  const collections = useMemo(
    () =>
      Object.values(collectionsMap).sort(
        (a, b) => b.lastSavedAt.getTime() - a.lastSavedAt.getTime(),
      ),
    [collectionsMap],
  );
  const saveTrack = useCollectionStore((s) => s.saveTrack);
  const unsaveTrack = useCollectionStore((s) => s.unsaveTrack);

  const missionsMap = useMissionStore((s) => s.missions);
  const missions = useMemo(
    () =>
      Object.values(missionsMap).sort(
        (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
      ),
    [missionsMap],
  );
  const addToLineup = useMissionStore((s) => s.addToLineup);
  const removeFromLineup = useMissionStore((s) => s.removeFromLineup);

  // ── Slide-up animation ────────────────────────────────────────────────────
  const translateY = useSharedValue(500);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      backdropOpacity.value = withTiming(1, { duration: 200 });
      translateY.value = withSpring(0, { damping: 22, stiffness: 280 });
    } else {
      backdropOpacity.value = withTiming(0, { duration: 180 });
      translateY.value = withTiming(500, { duration: 200 });
    }
  }, [visible]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  // ── Toggle handlers ───────────────────────────────────────────────────────

  const toggleCollection = (col: Collection) => {
    if (!track) return;
    const isIn = col.tracks.some((t) => t.itunesTrackId === track.id);
    if (isIn) {
      unsaveTrack(track.id, col.slug);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      saveTrack(track, { type: col.type, slug: col.slug, name: col.name });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const toggleMission = (mission: Mission) => {
    if (!track) return;
    const isIn = mission.lineup.some((t) => t.itunesTrackId === track.id);
    if (isIn) {
      removeFromLineup(mission.id, track.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      addToLineup(mission.id, track);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  if (!visible || !track) return null;

  const albumArt = track.album.images[0]?.url;
  const artistName = track.artists.map((a) => a.name).join(', ');

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View style={[styles.sheet, sheetStyle]}>
        {/* Handle bar */}
        <View style={styles.handleBar} />

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Add to...</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.closeBtn}>✕</Text>
          </Pressable>
        </View>

        {/* Track mini-card */}
        <View style={styles.trackRow}>
          {albumArt ? (
            <Image source={{ uri: albumArt }} style={styles.trackArt} />
          ) : (
            <View style={[styles.trackArt, styles.trackArtPlaceholder]} />
          )}
          <View style={styles.trackMeta}>
            <Text style={styles.trackName} numberOfLines={1}>{track.name}</Text>
            <Text style={styles.trackArtist} numberOfLines={1}>{artistName}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Collections */}
          <Text style={styles.sectionLabel}>Collections</Text>
          {collections.length === 0 ? (
            <Text style={styles.emptyText}>No collections yet — save a track first</Text>
          ) : (
            collections.map((col) => {
              const isIn = col.tracks.some((t) => t.itunesTrackId === track.id);
              const icon =
                col.type === 'festival' ? '🎪' : col.type === 'mission' ? '🎯' : '♡';
              return (
                <Pressable
                  key={col.slug}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => toggleCollection(col)}
                >
                  <Text style={styles.rowIcon}>{icon}</Text>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowName} numberOfLines={1}>{col.name}</Text>
                    <Text style={styles.rowMeta}>
                      {col.trackCount} {col.trackCount === 1 ? 'track' : 'tracks'}
                    </Text>
                  </View>
                  {isIn && <Text style={styles.checkmark}>✓</Text>}
                </Pressable>
              );
            })
          )}

          {/* Missions */}
          {missions.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, styles.sectionLabelGap]}>Missions</Text>
              {missions.map((mission) => {
                const isIn = mission.lineup.some((t) => t.itunesTrackId === track.id);
                return (
                  <Pressable
                    key={mission.id}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                    onPress={() => toggleMission(mission)}
                  >
                    <Text style={styles.rowIcon}>{mission.icon}</Text>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowName} numberOfLines={1}>{mission.name}</Text>
                      <Text style={styles.rowMeta}>
                        {mission.lineup.length} {mission.lineup.length === 1 ? 'track' : 'tracks'}
                      </Text>
                    </View>
                    {isIn && <Text style={styles.checkmark}>✓</Text>}
                  </Pressable>
                );
              })}
            </>
          )}

          <View style={{ height: 8 }} />
        </ScrollView>

        {/* Done button */}
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.8 }]}
            onPress={onClose}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BORDER = 'rgba(255,255,255,0.1)';
const ACCENT = '#1DB954';

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
    maxHeight: '78%',
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
  closeBtn: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 16,
    fontWeight: '600',
  },

  // Track mini-card
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  trackArt: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  trackArtPlaceholder: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  trackMeta: {
    flex: 1,
    gap: 2,
  },
  trackName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  trackArtist: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: BORDER,
    marginHorizontal: 0,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },

  sectionLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: 'SpaceMono',
    marginBottom: 8,
  },
  sectionLabelGap: {
    marginTop: 20,
  },

  emptyText: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 13,
    marginBottom: 8,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginHorizontal: -20,
    paddingHorizontal: 20,
  },
  rowIcon: {
    fontSize: 20,
    width: 28,
    textAlign: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  rowMeta: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    fontFamily: 'SpaceMono',
  },
  checkmark: {
    color: ACCENT,
    fontSize: 16,
    fontWeight: '700',
  },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  doneBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 25,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
