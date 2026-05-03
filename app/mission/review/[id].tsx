// ─── Mission Lineup Review ────────────────────────────────────────────────────
// Shows the saved lineup for a mission with drag-to-reorder, swipe-to-remove,
// tap-to-preview, shuffle, and Spotify export.

import { Audio, type AVPlaybackStatus } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

import ExportFlow from '@/src/components/ExportFlow';
import { useMissionStore, type MissionTrack } from '@/src/stores/missionStore';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fixed row height — used for drag offset math. */
const ITEM_H = 80;

const C = {
  bg: '#0A0A0A',
  surface: '#141414',
  border: 'rgba(255,255,255,0.08)',
  green: '#1DB954',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.45)',
  danger: '#FF4D4D',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function playlistDate(): string {
  return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to) return arr;
  const out = [...arr];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

// ─── Mini audio hook ──────────────────────────────────────────────────────────

function useMiniAudio() {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    }).catch(console.warn);
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const playTrack = useCallback(
    async (trackId: string, previewUrl: string) => {
      // Toggle off if already playing this track
      if (activeId === trackId) {
        await soundRef.current?.stopAsync().catch(() => {});
        await soundRef.current?.unloadAsync().catch(() => {});
        soundRef.current = null;
        setActiveId(null);
        setProgress(0);
        return;
      }

      const old = soundRef.current;
      soundRef.current = null;
      setActiveId(trackId);
      setProgress(0);
      if (old) old.unloadAsync().catch(() => {});

      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: previewUrl },
          { shouldPlay: true, progressUpdateIntervalMillis: 400 },
        );
        sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (!status.isLoaded) return;
          if (status.durationMillis) {
            setProgress(status.positionMillis / status.durationMillis);
          }
          if (status.didJustFinish) {
            setActiveId(null);
            setProgress(0);
          }
        });
        soundRef.current = sound;
      } catch {
        setActiveId(null);
      }
    },
    [activeId],
  );

  const stop = useCallback(async () => {
    await soundRef.current?.stopAsync().catch(() => {});
    await soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    setActiveId(null);
    setProgress(0);
  }, []);

  return { activeId, progress, playTrack, stop };
}

// ─── MiniPlayer ───────────────────────────────────────────────────────────────

function MiniPlayer({
  track,
  progress,
  onStop,
}: {
  track: MissionTrack;
  progress: number;
  onStop: () => void;
}) {
  return (
    <View style={styles.miniPlayer}>
      {track.artworkUrl ? (
        <Image source={{ uri: track.artworkUrl }} style={styles.miniArt} />
      ) : (
        <View style={[styles.miniArt, styles.artPlaceholder]} />
      )}
      <View style={styles.miniMeta}>
        <Text style={styles.miniTrackName} numberOfLines={1}>{track.trackName}</Text>
        <View style={styles.miniProgressTrack}>
          <View style={[styles.miniProgressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      </View>
      <Pressable onPress={onStop} hitSlop={10} style={styles.miniStop}>
        <Text style={styles.miniStopIcon}>■</Text>
      </Pressable>
    </View>
  );
}

// ─── Swipeable delete action ──────────────────────────────────────────────────

function DeleteAction({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.deleteAction}>
      <Text style={styles.deleteActionText}>Remove</Text>
    </Pressable>
  );
}

// ─── Track row ────────────────────────────────────────────────────────────────

type TrackRowProps = {
  track: MissionTrack;
  index: number;
  totalCount: number;
  activeDragIdx: SharedValue<number>;
  dragAbsY: SharedValue<number>;
  dragStartAbsY: SharedValue<number>;
  listTopYSV: SharedValue<number>;
  isPlaying: boolean;
  onPlay: () => void;
  onRemove: () => void;
  onDragStart: (index: number) => void;
  onDragEnd: (from: number, to: number) => void;
};

function TrackRow({
  track,
  index,
  totalCount,
  activeDragIdx,
  dragAbsY,
  dragStartAbsY,
  listTopYSV: _listTopYSV, // currently unused in item style but kept for future
  isPlaying,
  onPlay,
  onRemove,
  onDragStart,
  onDragEnd,
}: TrackRowProps) {
  const swipeableRef = useRef<SwipeableMethods>(null);

  // ── Per-item animated shift during drag ─────────────────────────────────
  const rowStyle = useAnimatedStyle(() => {
    const activeIdx = activeDragIdx.value;

    if (activeIdx < 0) {
      return { transform: [{ translateY: 0 }], opacity: 1 };
    }
    if (activeIdx === index) {
      // Ghost — show faint in-place marker
      return { transform: [{ translateY: 0 }], opacity: 0.25 };
    }

    const delta = dragAbsY.value - dragStartAbsY.value;
    const targetIdx = Math.max(
      0,
      Math.min(totalCount - 1, Math.round(activeIdx + delta / ITEM_H)),
    );

    // Items between source and target shift to make room
    if (targetIdx > activeIdx && index > activeIdx && index <= targetIdx) {
      return { transform: [{ translateY: -ITEM_H }], opacity: 1 };
    }
    if (targetIdx < activeIdx && index >= targetIdx && index < activeIdx) {
      return { transform: [{ translateY: ITEM_H }], opacity: 1 };
    }
    return { transform: [{ translateY: 0 }], opacity: 1 };
  });

  // ── Drag handle gesture ──────────────────────────────────────────────────
  const handleGesture = Gesture.Pan()
    .activateAfterLongPress(350)
    .onStart((e) => {
      activeDragIdx.value = index;
      dragStartAbsY.value = e.absoluteY;
      dragAbsY.value = e.absoluteY;
      runOnJS(onDragStart)(index);
    })
    .onUpdate((e) => {
      dragAbsY.value = e.absoluteY;
    })
    .onEnd(() => {
      const activeIdx = activeDragIdx.value;
      const delta = dragAbsY.value - dragStartAbsY.value;
      const toIdx = Math.max(
        0,
        Math.min(totalCount - 1, Math.round(activeIdx + delta / ITEM_H)),
      );
      activeDragIdx.value = -1;
      runOnJS(onDragEnd)(activeIdx, toIdx);
    })
    .onFinalize(() => {
      // Reset drag state on cancel/interrupt
      if (activeDragIdx.value === index) {
        activeDragIdx.value = -1;
      }
    });

  const handleRemove = () => {
    swipeableRef.current?.close();
    onRemove();
  };

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      renderRightActions={() => <DeleteAction onPress={handleRemove} />}
      overshootRight={false}
      friction={2}
    >
      <Animated.View style={[styles.trackRow, rowStyle]}>
        {/* Drag handle */}
        <GestureDetector gesture={handleGesture}>
          <View style={styles.dragHandle}>
            <Text style={styles.dragHandleIcon}>⠿</Text>
          </View>
        </GestureDetector>

        {/* Album art — tap to preview */}
        <Pressable onPress={onPlay} style={styles.artWrap}>
          {track.artworkUrl ? (
            <Image source={{ uri: track.artworkUrl }} style={styles.trackArt} />
          ) : (
            <View style={[styles.trackArt, styles.artPlaceholder]} />
          )}
          {isPlaying && (
            <View style={styles.playingOverlay}>
              <Text style={styles.playingIcon}>▶</Text>
            </View>
          )}
        </Pressable>

        {/* Metadata — tap to preview */}
        <Pressable style={styles.trackMeta} onPress={onPlay}>
          <Text style={styles.trackName} numberOfLines={1}>
            {track.trackName}
          </Text>
          <Text style={styles.artistName} numberOfLines={1}>
            {track.artistName}
          </Text>
          {track.genre ? (
            <View style={styles.genrePill}>
              <Text style={styles.genreText}>{track.genre}</Text>
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
    </ReanimatedSwipeable>
  );
}

// ─── Draggable lineup list ────────────────────────────────────────────────────

type DraggableListProps = {
  lineup: MissionTrack[];
  onReorder: (from: number, to: number) => void;
  onRemove: (trackId: string) => void;
  activePreviewId: string | null;
  onPlayTrack: (track: MissionTrack) => void;
};

function DraggableLineupList({
  lineup,
  onReorder,
  onRemove,
  activePreviewId,
  onPlayTrack,
}: DraggableListProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragFromIndex, setDragFromIndex] = useState(-1);

  // Shared values on the UI thread
  const activeDragIdx = useSharedValue(-1);
  const dragAbsY = useSharedValue(0);
  const dragStartAbsY = useSharedValue(0);
  const listTopYSV = useSharedValue(0);

  const listRef = useRef<View>(null);

  const measureList = useCallback(() => {
    listRef.current?.measureInWindow((_x, y) => {
      listTopYSV.value = y;
    });
  }, [listTopYSV]);

  const handleDragStart = useCallback((index: number) => {
    setIsDragging(true);
    setDragFromIndex(index);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const handleDragEnd = useCallback(
    (from: number, to: number) => {
      setIsDragging(false);
      setDragFromIndex(-1);
      if (from !== to) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onReorder(from, to);
      }
    },
    [onReorder],
  );

  // Drag overlay: floating card that follows the finger
  const overlayStyle = useAnimatedStyle(() => {
    if (activeDragIdx.value < 0) {
      return { opacity: 0, transform: [{ translateY: -9999 }] };
    }
    const y = dragAbsY.value - listTopYSV.value - ITEM_H / 2;
    return {
      opacity: 0.95,
      transform: [{ translateY: y }],
    };
  });

  const draggedTrack = dragFromIndex >= 0 ? lineup[dragFromIndex] : null;

  return (
    <View ref={listRef} style={styles.listOuter} onLayout={measureList}>
      <ScrollView
        scrollEnabled={!isDragging}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      >
        {lineup.map((track, index) => (
          <TrackRow
            key={track.itunesTrackId}
            track={track}
            index={index}
            totalCount={lineup.length}
            activeDragIdx={activeDragIdx}
            dragAbsY={dragAbsY}
            dragStartAbsY={dragStartAbsY}
            listTopYSV={listTopYSV}
            isPlaying={activePreviewId === track.itunesTrackId}
            onPlay={() => onPlayTrack(track)}
            onRemove={() => onRemove(track.itunesTrackId)}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />
        ))}
      </ScrollView>

      {/* Floating overlay during drag */}
      {draggedTrack && (
        <Animated.View
          style={[styles.dragOverlay, overlayStyle]}
          pointerEvents="none"
        >
          <View style={styles.dragOverlayInner}>
            <View style={styles.dragHandle}>
              <Text style={styles.dragHandleIcon}>⠿</Text>
            </View>
            {draggedTrack.artworkUrl ? (
              <Image source={{ uri: draggedTrack.artworkUrl }} style={styles.trackArt} />
            ) : (
              <View style={[styles.trackArt, styles.artPlaceholder]} />
            )}
            <View style={styles.trackMeta}>
              <Text style={styles.trackName} numberOfLines={1}>
                {draggedTrack.trackName}
              </Text>
              <Text style={styles.artistName} numberOfLines={1}>
                {draggedTrack.artistName}
              </Text>
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MissionReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const missionStore = useMissionStore();
  const mission = missionStore.getMission(id);

  // Local working copy of the lineup (persisted to store on every change)
  const [localLineup, setLocalLineup] = useState<MissionTrack[]>(
    () => mission?.lineup ?? [],
  );

  // Sync if mission lineup changes externally (e.g. from swipe screen undo)
  useEffect(() => {
    if (mission?.lineup) setLocalLineup(mission.lineup);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { activeId, progress, playTrack, stop } = useMiniAudio();
  const [showExport, setShowExport] = useState(false);
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);

  const activeTrack = localLineup.find((t) => t.itunesTrackId === activeId) ?? null;
  const estimatedMin = localLineup.length * 3;

  // ── Reorder ───────────────────────────────────────────────────────────────
  const handleReorder = useCallback(
    (from: number, to: number) => {
      setLocalLineup((prev) => {
        const next = moveItem(prev, from, to).map((t, i) => ({ ...t, order: i }));
        missionStore.reorderLineup(id, next);
        return next;
      });
    },
    [id, missionStore],
  );

  // ── Remove ────────────────────────────────────────────────────────────────
  const handleRemove = useCallback(
    (trackId: string) => {
      if (activeId === trackId) stop();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setLocalLineup((prev) => {
        const next = prev.filter((t) => t.itunesTrackId !== trackId)
          .map((t, i) => ({ ...t, order: i }));
        missionStore.reorderLineup(id, next);
        return next;
      });
    },
    [id, activeId, missionStore, stop],
  );

  // ── Shuffle ───────────────────────────────────────────────────────────────
  const handleShuffle = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLocalLineup((prev) => {
      const shuffled = shuffle(prev).map((t, i) => ({ ...t, order: i }));
      missionStore.reorderLineup(id, shuffled);
      return shuffled;
    });
  }, [id, missionStore]);

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExportSuccess = useCallback(
    (url: string) => {
      setExportedUrl(url);
      missionStore.setExportedUrl(id, url);
      missionStore.completeMission(id);
    },
    [id, missionStore],
  );

  const handleExportDismiss = useCallback(() => {
    setShowExport(false);
    if (exportedUrl) {
      Alert.alert(
        'Playlist Created!',
        'Your lineup is in Spotify. What\'s next?',
        [
          {
            text: 'Go to Library',
            onPress: () => {
              router.dismiss();
              router.dismiss();
            },
          },
          {
            text: 'Start New Mission',
            onPress: () => {
              router.dismiss();
              router.dismiss();
            },
          },
          { text: 'Stay Here', style: 'cancel' },
        ],
      );
    }
  }, [exportedUrl, router]);

  // ── Save for Later ────────────────────────────────────────────────────────
  const handleSaveForLater = useCallback(() => {
    missionStore.completeMission(id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }, [id, missionStore, router]);

  // ── Keep Building ─────────────────────────────────────────────────────────
  const handleKeepBuilding = useCallback(() => {
    router.back();
  }, [router]);

  // ── Back nav ──────────────────────────────────────────────────────────────
  const handleBack = useCallback(() => {
    stop();
    router.back();
  }, [router, stop]);

  // ── Export track list ─────────────────────────────────────────────────────
  const exportTracks = localLineup.map((t) => ({
    trackName: t.trackName,
    artistName: t.artistName,
  }));
  const playlistName = mission
    ? `HOOKD ${mission.name} — ${playlistDate()}`
    : 'HOOKD Lineup';

  if (!mission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Mission not found.</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 12 }}>
            <Text style={styles.linkText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (localLineup.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={handleBack} hitSlop={12} style={styles.backBtn}>
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Your Lineup</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>{mission.icon}</Text>
          <Text style={styles.emptyText}>No songs in your lineup yet.</Text>
          <Pressable onPress={handleKeepBuilding} style={styles.keepBuildingBtn}>
            <Text style={styles.keepBuildingText}>Keep Swiping</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Pressable onPress={handleBack} hitSlop={12} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerMission} numberOfLines={1}>
            {mission.icon} {mission.name}
          </Text>
          <Text style={styles.headerTitle}>Your Lineup</Text>
        </View>
        <Pressable onPress={handleShuffle} hitSlop={12} style={styles.shuffleBtn}>
          <Text style={styles.shuffleIcon}>⇌</Text>
        </Pressable>
      </View>

      {/* ── Stats bar ─────────────────────────────────────────────────────── */}
      <View style={styles.statsBar}>
        <Text style={styles.statsText}>
          {localLineup.length} songs · ~{estimatedMin} min
        </Text>
        {mission.exportedPlaylistUrl && (
          <View style={styles.exportedBadge}>
            <Text style={styles.exportedBadgeText}>Exported ✓</Text>
          </View>
        )}
      </View>

      {/* ── Track list ────────────────────────────────────────────────────── */}
      <DraggableLineupList
        lineup={localLineup}
        onReorder={handleReorder}
        onRemove={handleRemove}
        activePreviewId={activeId}
        onPlayTrack={(track) => {
          if (track.previewUrl) playTrack(track.itunesTrackId, track.previewUrl);
        }}
      />

      {/* ── Mini player ───────────────────────────────────────────────────── */}
      {activeTrack && (
        <MiniPlayer track={activeTrack} progress={progress} onStop={stop} />
      )}

      {/* ── Action buttons ────────────────────────────────────────────────── */}
      <View style={styles.actions}>
        <Pressable
          onPress={() => setShowExport(true)}
          style={({ pressed }) => [styles.exportBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.exportBtnText}>Export to Spotify</Text>
        </Pressable>

        <View style={styles.secondaryRow}>
          <Pressable
            onPress={handleKeepBuilding}
            style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.secondaryBtnText}>Keep Building</Text>
          </Pressable>
          <Pressable
            onPress={handleSaveForLater}
            style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.secondaryBtnText}>Save for Later</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Export modal ──────────────────────────────────────────────────── */}
      <ExportFlow
        visible={showExport}
        tracks={exportTracks}
        playlistName={playlistName}
        onDismiss={handleExportDismiss}
        onSuccess={handleExportSuccess}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  errorText: { color: C.muted, fontSize: 16 },
  linkText: { color: C.green, fontSize: 15, fontWeight: '600' },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {
    color: C.text,
    fontSize: 18,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  headerMission: {
    color: C.muted,
    fontSize: 12,
    fontFamily: 'SpaceMono',
    letterSpacing: 0.3,
  },
  headerTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerRight: { width: 36 },
  shuffleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shuffleIcon: { color: C.text, fontSize: 18 },

  // ── Stats bar ────────────────────────────────────────────────────────────
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 10,
    gap: 10,
  },
  statsText: {
    color: C.muted,
    fontSize: 13,
    fontFamily: 'SpaceMono',
  },
  exportedBadge: {
    backgroundColor: 'rgba(29,185,84,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  exportedBadgeText: {
    color: C.green,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'SpaceMono',
  },

  // ── Draggable list ───────────────────────────────────────────────────────
  listOuter: {
    flex: 1,
    overflow: 'visible',
  },
  listContent: {
    paddingBottom: 8,
  },

  // ── Track row ────────────────────────────────────────────────────────────
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ITEM_H,
    paddingHorizontal: 12,
    backgroundColor: C.bg,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },

  dragHandle: {
    width: 28,
    height: ITEM_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragHandleIcon: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 18,
  },

  artWrap: {
    width: 52,
    height: 52,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  trackArt: {
    width: 52,
    height: 52,
    borderRadius: 8,
  },
  artPlaceholder: {
    backgroundColor: '#2A2A2A',
  },
  playingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  playingIcon: {
    color: C.green,
    fontSize: 14,
  },

  trackMeta: {
    flex: 1,
    gap: 2,
  },
  trackName: {
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  artistName: {
    color: C.muted,
    fontSize: 13,
  },
  genrePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 20,
    marginTop: 2,
  },
  genreText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontFamily: 'SpaceMono',
    letterSpacing: 0.3,
  },

  // ── Swipeable delete ─────────────────────────────────────────────────────
  deleteAction: {
    width: 80,
    height: ITEM_H,
    backgroundColor: C.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },

  // ── Drag overlay ─────────────────────────────────────────────────────────
  dragOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ITEM_H,
    zIndex: 100,
  },
  dragOverlayInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 10,
    backgroundColor: '#222222',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 16,
  },

  // ── Mini player ──────────────────────────────────────────────────────────
  miniPlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    paddingHorizontal: 16,
    gap: 12,
    backgroundColor: '#1A1A1A',
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  miniArt: {
    width: 42,
    height: 42,
    borderRadius: 6,
  },
  miniMeta: {
    flex: 1,
    gap: 6,
  },
  miniTrackName: {
    color: C.text,
    fontSize: 13,
    fontWeight: '600',
  },
  miniProgressTrack: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  miniProgressFill: {
    height: '100%',
    backgroundColor: C.green,
    borderRadius: 1,
  },
  miniStop: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniStopIcon: {
    color: C.muted,
    fontSize: 12,
  },

  // ── Actions ──────────────────────────────────────────────────────────────
  actions: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    gap: 10,
  },
  exportBtn: {
    backgroundColor: C.green,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportBtnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: C.muted,
    fontSize: 14,
    fontWeight: '600',
  },

  // ── Empty state ───────────────────────────────────────────────────────────
  emptyIcon: { fontSize: 48 },
  emptyText: {
    color: C.muted,
    fontSize: 15,
    textAlign: 'center',
  },
  keepBuildingBtn: {
    marginTop: 8,
    backgroundColor: C.green,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 22,
  },
  keepBuildingText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
  },
});
