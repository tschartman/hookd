import { Audio, type AVPlaybackStatus } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ExportFlow from '@/src/components/ExportFlow';
import { useCollections } from '@/src/hooks/useCollections';
import type { SavedTrack } from '@/src/stores/collectionStore';
import { useCollectionStore } from '@/src/stores/collectionStore';
import { usePlayerStore } from '@/src/stores/playerStore';

// ─── Mosaic header (blurred cover) ────────────────────────────────────────────

const HEADER_HEIGHT = 200;
const MOSAIC_CELL = 100;

function HeaderMosaic({ arts, name, trackCount }: { arts: string[]; name: string; trackCount: number }) {
  const cells = [arts[0], arts[1], arts[2], arts[3]];

  return (
    <View style={styles.header}>
      {/* Background: 2x2 mosaic filling the header */}
      <View style={styles.headerBg}>
        <View style={styles.headerMosaicRow}>
          {cells.slice(0, 2).map((url, i) =>
            url ? (
              <Image key={i} source={{ uri: url }} style={styles.headerCell} blurRadius={8} />
            ) : (
              <View key={i} style={[styles.headerCell, { backgroundColor: '#1a1a1a' }]} />
            ),
          )}
        </View>
        <View style={styles.headerMosaicRow}>
          {cells.slice(2, 4).map((url, i) =>
            url ? (
              <Image key={i + 2} source={{ uri: url }} style={styles.headerCell} blurRadius={8} />
            ) : (
              <View key={i + 2} style={[styles.headerCell, { backgroundColor: '#1a1a1a' }]} />
            ),
          )}
        </View>
      </View>

      {/* Dark gradient overlay */}
      <LinearGradient
        colors={['rgba(10,10,10,0.35)', 'rgba(10,10,10,0.95)']}
        style={StyleSheet.absoluteFill}
      />

      {/* Text overlay */}
      <View style={styles.headerText}>
        <Text style={styles.headerName} numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.headerCount}>
          {trackCount} {trackCount === 1 ? 'track' : 'tracks'}
        </Text>
      </View>
    </View>
  );
}

// ─── Track row ────────────────────────────────────────────────────────────────

function TrackRow({
  track,
  isPlaying,
  onPlay,
  onRemove,
}: {
  track: SavedTrack;
  isPlaying: boolean;
  onPlay: (track: SavedTrack) => void;
  onRemove: (id: string) => void;
}) {
  const swipeableRef = useRef<Swipeable>(null);

  const handleRemove = useCallback(() => {
    swipeableRef.current?.close();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onRemove(track.itunesTrackId);
  }, [track.itunesTrackId, onRemove]);

  const renderRightActions = () => (
    <Pressable onPress={handleRemove} style={styles.removeAction}>
      <Text style={styles.removeText}>Remove</Text>
    </Pressable>
  );

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      rightThreshold={60}
      friction={2}
      overshootRight={false}
    >
      <Pressable
        onPress={() => onPlay(track)}
        style={({ pressed }) => [styles.trackRow, pressed && { opacity: 0.75 }]}
      >
        {/* Album art */}
        {track.artworkUrl ? (
          <Image source={{ uri: track.artworkUrl }} style={styles.trackThumb} />
        ) : (
          <View style={[styles.trackThumb, styles.trackThumbPlaceholder]} />
        )}

        {/* Info */}
        <View style={styles.trackInfo}>
          <Text
            style={[styles.trackName, isPlaying && styles.trackNamePlaying]}
            numberOfLines={1}
          >
            {track.trackName}
          </Text>
          <Text style={styles.trackArtist} numberOfLines={1}>
            {track.artistName}
          </Text>
          {track.genre ? (
            <View style={styles.genrePill}>
              <Text style={styles.genrePillText}>{track.genre}</Text>
            </View>
          ) : null}
        </View>

        {/* Playing indicator */}
        {isPlaying ? (
          <View style={styles.playingDot}>
            <Text style={styles.playingDotText}>♪</Text>
          </View>
        ) : track.previewUrl ? (
          <View style={styles.playIcon}>
            <Text style={styles.playIconText}>▷</Text>
          </View>
        ) : (
          <Text style={styles.noPreviewText}>No preview</Text>
        )}
      </Pressable>
    </Swipeable>
  );
}

// ─── Mini player ──────────────────────────────────────────────────────────────

function MiniPlayer({
  track,
  isPlaying,
  progress,
  onToggle,
  onDismiss,
  bottomOffset,
}: {
  track: SavedTrack;
  isPlaying: boolean;
  progress: number;
  onToggle: () => void;
  onDismiss: () => void;
  bottomOffset: number;
}) {
  return (
    <View style={[styles.miniPlayer, { bottom: bottomOffset }]}>
      {/* Progress bar */}
      <View style={styles.miniProgress}>
        <View style={[styles.miniProgressFill, { width: `${progress * 100}%` }]} />
      </View>

      <View style={styles.miniPlayerContent}>
        {/* Art */}
        {track.artworkUrl ? (
          <Image source={{ uri: track.artworkUrl }} style={styles.miniArt} />
        ) : (
          <View style={[styles.miniArt, { backgroundColor: '#262626' }]} />
        )}

        {/* Info */}
        <View style={styles.miniInfo}>
          <Text style={styles.miniTrackName} numberOfLines={1}>
            {track.trackName}
          </Text>
          <Text style={styles.miniArtistName} numberOfLines={1}>
            {track.artistName}
          </Text>
        </View>

        {/* Controls */}
        <Pressable
          onPress={onToggle}
          style={({ pressed }) => [styles.miniPlayBtn, pressed && { opacity: 0.7 }]}
          hitSlop={8}
        >
          <Text style={styles.miniPlayBtnText}>{isPlaying ? '⏸' : '▷'}</Text>
        </Pressable>

        <Pressable
          onPress={onDismiss}
          style={({ pressed }) => [styles.miniCloseBtn, pressed && { opacity: 0.7 }]}
          hitSlop={8}
        >
          <Text style={styles.miniCloseBtnText}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CollectionDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { unsaveTrack } = useCollections();

  const collection = useCollectionStore((s) => s.collections[slug ?? '']);
  const setExportedPlaylistUrl = useCollectionStore((s) => s.setExportedPlaylistUrl);

  const [exportVisible, setExportVisible] = useState(false);

  // ── Local audio state (independent of main feed player) ──────────────────
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playingTrack, setPlayingTrack] = useState<SavedTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // Unload sound on unmount
  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  // ── Audio: play / toggle ──────────────────────────────────────────────────
  const handlePlay = useCallback(async (track: SavedTrack) => {
    if (!track.previewUrl) return;

    // Pause the main feed player to avoid double audio
    usePlayerStore.getState()._setIsPlaying(false);

    // Same track → toggle play/pause
    if (playingTrack?.itunesTrackId === track.itunesTrackId) {
      const sound = soundRef.current;
      if (!sound) return;
      if (isPlaying) {
        await sound.pauseAsync().catch(() => {});
        setIsPlaying(false);
      } else {
        await sound.playAsync().catch(() => {});
        setIsPlaying(true);
      }
      return;
    }

    // Different track → unload current, load new
    const old = soundRef.current;
    soundRef.current = null;
    setPlayingTrack(null);
    setProgress(0);
    await old?.unloadAsync().catch(() => {});

    setPlayingTrack(track);
    setIsPlaying(true);

    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: track.previewUrl },
        { shouldPlay: true, progressUpdateIntervalMillis: 250 },
      );

      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (!status.isLoaded) return;
        if (status.durationMillis) {
          setProgress(status.positionMillis / status.durationMillis);
        }
        if (status.didJustFinish) {
          setIsPlaying(false);
          setProgress(0);
        }
      });
    } catch {
      setPlayingTrack(null);
      setIsPlaying(false);
    }
  }, [playingTrack, isPlaying]);

  const handleTogglePlay = useCallback(async () => {
    if (!playingTrack) return;
    const sound = soundRef.current;
    if (!sound) return;
    if (isPlaying) {
      await sound.pauseAsync().catch(() => {});
      setIsPlaying(false);
    } else {
      await sound.playAsync().catch(() => {});
      setIsPlaying(true);
    }
  }, [playingTrack, isPlaying]);

  const handleDismissPlayer = useCallback(async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    setPlayingTrack(null);
    setIsPlaying(false);
    setProgress(0);
    await sound?.unloadAsync().catch(() => {});
  }, []);

  // ── Remove track ──────────────────────────────────────────────────────────
  const handleRemove = useCallback(
    (itunesTrackId: string) => {
      if (!slug) return;
      // If this is the currently playing track, stop it
      if (playingTrack?.itunesTrackId === itunesTrackId) {
        handleDismissPlayer();
      }
      unsaveTrack(itunesTrackId, slug);
    },
    [slug, unsaveTrack, playingTrack, handleDismissPlayer],
  );

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setExportVisible(true);
  };

  // ── Layout calculations ───────────────────────────────────────────────────
  const exportBtnHeight = 56;
  const exportBtnBottom = insets.bottom + 16;
  const miniPlayerHeight = 76;
  const miniPlayerBottom = exportBtnBottom + exportBtnHeight + 8;
  const listPaddingBottom =
    exportBtnBottom + exportBtnHeight + 16 + (playingTrack ? miniPlayerHeight + 8 : 0);

  // ── 404 ──────────────────────────────────────────────────────────────────
  if (!collection) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <Text style={styles.notFoundText}>Collection not found.</Text>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backLink}>← Go back</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>

        {/* Back button — absolute, above header */}
        <Pressable
          onPress={() => router.back()}
          style={[styles.backButton, { top: insets.top + 8 }]}
          hitSlop={12}
        >
          <Text style={styles.backButtonText}>‹</Text>
        </Pressable>

        {/* Mosaic header */}
        <HeaderMosaic
          arts={collection.coverArt}
          name={collection.name}
          trackCount={collection.trackCount}
        />

        {/* Track list */}
        <FlatList
          data={collection.tracks}
          keyExtractor={(item) => item.itunesTrackId}
          contentContainerStyle={{ paddingBottom: listPaddingBottom }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <TrackRow
              track={item}
              isPlaying={playingTrack?.itunesTrackId === item.itunesTrackId && isPlaying}
              onPlay={handlePlay}
              onRemove={handleRemove}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyList}>
              <Text style={styles.emptyListTitle}>No discoveries yet</Text>
              <Text style={styles.emptyListSubtitle}>
                {slug === 'main-feed'
                  ? 'Explore genres and eras to start your collection'
                  : slug?.startsWith('mission')
                    ? 'Start a mission to build a playlist'
                    : 'Listen to the lineup and save your favorites'}
              </Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />

        {/* Mini player */}
        {playingTrack && (
          <MiniPlayer
            track={playingTrack}
            isPlaying={isPlaying}
            progress={progress}
            onToggle={handleTogglePlay}
            onDismiss={handleDismissPlayer}
            bottomOffset={miniPlayerBottom}
          />
        )}

        {/* Export button — hidden when collection is empty */}
        {collection.tracks.length > 0 && (
          <Pressable
            onPress={handleExport}
            style={({ pressed }) => [
              styles.exportButton,
              { bottom: exportBtnBottom },
              pressed && { opacity: 0.8 },
            ]}
          >
            {collection.exportedPlaylistUrl ? (
              <Text style={styles.exportButtonText}>Exported ✓  Re-export →</Text>
            ) : (
              <Text style={styles.exportButtonText}>Export to Spotify →</Text>
            )}
          </Pressable>
        )}
      </View>

      {/* Export flow modal */}
      <ExportFlow
        visible={exportVisible}
        tracks={collection.tracks.map((t) => ({
          trackName: t.trackName,
          artistName: t.artistName,
        }))}
        playlistName={`HOOKD — ${collection.name}`}
        onDismiss={() => setExportVisible(false)}
        onSuccess={(url) => {
          if (slug) setExportedPlaylistUrl(slug, url);
        }}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const C = {
  bg: '#0A0A0A',
  surface: '#141414',
  border: 'rgba(255,255,255,0.07)',
  green: '#1DB954',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.45)',
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  centered: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  notFoundText: {
    color: '#FF4D4D',
    fontSize: 15,
  },
  backLink: {
    color: C.muted,
    fontSize: 14,
  },

  // Back button
  backButton: {
    position: 'absolute',
    left: 12,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: C.text,
    fontSize: 26,
    fontWeight: '300',
    lineHeight: 28,
    marginTop: -2,
  },

  // Header mosaic
  header: {
    height: HEADER_HEIGHT,
    overflow: 'hidden',
    position: 'relative',
  },
  headerBg: {
    position: 'absolute',
    inset: 0,
  },
  headerMosaicRow: {
    flexDirection: 'row',
    height: HEADER_HEIGHT / 2,
  },
  headerCell: {
    flex: 1,
    height: HEADER_HEIGHT / 2,
  },
  headerText: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    gap: 4,
  },
  headerName: {
    color: C.text,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerCount: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontFamily: 'SpaceMono',
  },

  // Track row
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: C.bg,
    gap: 12,
  },
  trackThumb: {
    width: 50,
    height: 50,
    borderRadius: 8,
    flexShrink: 0,
  },
  trackThumbPlaceholder: {
    backgroundColor: '#262626',
  },
  trackInfo: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  trackName: {
    color: C.text,
    fontSize: 15,
    fontWeight: '600',
  },
  trackNamePlaying: {
    color: C.green,
  },
  trackArtist: {
    color: C.muted,
    fontSize: 13,
  },
  genrePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
    marginTop: 3,
  },
  genrePillText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    fontWeight: '600',
  },
  playingDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(29,185,84,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  playingDotText: {
    color: C.green,
    fontSize: 16,
  },
  playIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  playIconText: {
    color: C.muted,
    fontSize: 14,
  },
  noPreviewText: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 10,
    fontFamily: 'SpaceMono',
  },

  // Separator
  separator: {
    height: 1,
    backgroundColor: C.border,
    marginLeft: 78, // indent to align with track name
  },

  // Swipe remove action
  removeAction: {
    backgroundColor: '#C0392B',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  removeText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },

  // Empty list
  emptyList: {
    paddingHorizontal: 32,
    paddingVertical: 56,
    alignItems: 'center',
    gap: 8,
  },
  emptyListTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyListSubtitle: {
    color: C.muted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Mini player
  miniPlayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 76,
    backgroundColor: '#1A1A1A',
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  miniProgress: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  miniProgressFill: {
    height: '100%',
    backgroundColor: C.green,
  },
  miniPlayerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  miniArt: {
    width: 44,
    height: 44,
    borderRadius: 8,
    flexShrink: 0,
  },
  miniInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  miniTrackName: {
    color: C.text,
    fontSize: 14,
    fontWeight: '600',
  },
  miniArtistName: {
    color: C.muted,
    fontSize: 12,
  },
  miniPlayBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniPlayBtnText: {
    color: '#000',
    fontSize: 18,
    lineHeight: 22,
  },
  miniCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniCloseBtnText: {
    color: C.muted,
    fontSize: 14,
  },

  // Export button
  exportButton: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 56,
    backgroundColor: C.green,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportButtonText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
