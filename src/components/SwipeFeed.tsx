import { useCallback, useEffect, useRef } from 'react';
import {
  FlatList,
  InteractionManager,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  StyleSheet,
  View,
  useWindowDimensions,
  ViewToken,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import HookCard from '@/src/components/HookCard';
import type { SpotifyAudioFeatures, SpotifyTrack } from '@/src/services/spotify';
import { usePlayerStore } from '@/src/stores/playerStore';

// ─── Tab bar height estimation ────────────────────────────────────────────────
// tabBarHeight = 49 when inside the tab navigator, 0 for full-screen stack screens.
// topOffset accounts for any floating header/controls above the feed (e.g. festival banner).
function useItemHeight(tabBarHeight = 49, topOffset = 0): number {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return height - tabBarHeight - insets.bottom - topOffset;
}

// ─── Animated card wrapper ────────────────────────────────────────────────────
// Receives scrollY as a shared value so the scale worklet runs on the UI thread.

type WrapperProps = {
  scrollY: SharedValue<number>;
  index: number;
  itemHeight: number;
  children: React.ReactNode;
};

const AnimatedCardWrapper = ({ scrollY, index, itemHeight, children }: WrapperProps) => {
  const animatedStyle = useAnimatedStyle(() => {
    const offset = scrollY.value - index * itemHeight;
    const scale = interpolate(
      offset,
      [-itemHeight, 0, itemHeight],
      [0.94, 1, 0.94],
      Extrapolation.CLAMP,
    );
    return {
      transform: [{ scale }],
    };
  });

  return (
    <Animated.View style={[{ height: itemHeight }, animatedStyle]}>{children}</Animated.View>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

type Props = {
  tracks: SpotifyTrack[];
  audioFeaturesMap?: Record<string, SpotifyAudioFeatures>;
  savedTrackIds: Set<string>;
  onSave: (track: SpotifyTrack) => void;
  onExpand: (track: SpotifyTrack) => void;
  onAddToPlaylist?: (track: SpotifyTrack) => void;
  onEndReached: () => void;
  /** Called when the user scrolls past a track without saving it. */
  onSkip?: (track: SpotifyTrack) => void;
  /**
   * Height of the tab bar below the feed. Pass 0 for full-screen stack screens
   * that don't have a tab bar. Defaults to 49 (Expo Router tab bar height).
   */
  tabBarHeight?: number;
  /**
   * Height of any floating header/controls above the feed. Subtracted from
   * item height so cards fill only the visible area below those controls.
   * Defaults to 0.
   */
  topOffset?: number;
  /**
   * Extra bottom padding applied inside each card (e.g. safe-area inset + gap
   * for full-screen feeds that have no tab bar). Defaults to 0.
   */
  bottomPadding?: number;
  /**
   * Scroll the list to this index on first render (cache restore).
   * Uses FlatList's initialScrollIndex + pre-seeds visibleIndexRef so the
   * auto-scroll effect doesn't animate over it.
   */
  initialScrollIndex?: number;
  /** Pull-to-refresh state. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /**
   * Called whenever the visible card changes. Provides the track and its index.
   * Use this for background prefetching — fires on every card change including
   * programmatic auto-scrolls.
   */
  onVisibleItemChanged?: (track: SpotifyTrack, index: number) => void;
};

const SwipeFeed = ({
  tracks,
  audioFeaturesMap,
  savedTrackIds,
  onSave,
  onExpand,
  onAddToPlaylist,
  onEndReached,
  onSkip,
  tabBarHeight = 49,
  topOffset = 0,
  bottomPadding = 0,
  initialScrollIndex,
  refreshing,
  onRefresh,
  onVisibleItemChanged,
}: Props) => {
  const itemHeight = useItemHeight(tabBarHeight, topOffset);
  const scrollY = useSharedValue(0);

  // ── Opacity cross-fade — hides layout jank on cache restore ───────────────
  // For cache restores (non-zero initial index) the FlatList starts invisible
  // while a static skeleton card sits on top. After interactions settle the
  // skeleton fades out and the FlatList fades in simultaneously (150 ms).
  // For fresh loads the festival loading screen handles the pre-render phase,
  // so we go straight to opacity 1.
  const isCacheRestore = initialScrollIndex != null && initialScrollIndex > 0;
  const feedOpacity     = useSharedValue(isCacheRestore ? 0 : 1);
  const skeletonOpacity = useSharedValue(isCacheRestore ? 1 : 0);
  const feedStyle     = useAnimatedStyle(() => ({ opacity: feedOpacity.value }));
  const skeletonStyle = useAnimatedStyle(() => ({ opacity: skeletonOpacity.value }));

  useEffect(() => {
    if (!isCacheRestore) return;
    const task = InteractionManager.runAfterInteractions(() => {
      feedOpacity.value     = withTiming(1, { duration: 150 });
      skeletonOpacity.value = withTiming(0, { duration: 150 });
    });
    return () => task.cancel();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  // ── FlatList ref for programmatic scrolling ─────────────────────────────
  const flatListRef = useRef<FlatList<SpotifyTrack>>(null);

  // ── Scroll handler ─────────────────────────────────────────────────────────
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  // ── Track which item is visible ────────────────────────────────────────────
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  // The index that the FlatList is actually showing right now.
  // Updated by onViewableItemsChanged (both user swipes and programmatic scrolls).
  // Pre-seeded to initialScrollIndex so the auto-scroll effect doesn't fight the
  // FlatList's own initialScrollIndex on cache restore.
  const visibleIndexRef = useRef(initialScrollIndex ?? -1);

  // Stable refs for skip callback and live data (avoids stale closures in the ref callback)
  const onSkipRef = useRef(onSkip);
  const onVisibleItemChangedRef = useRef(onVisibleItemChanged);
  const savedTrackIdsRef = useRef(savedTrackIds);
  const tracksRef = useRef(tracks);
  useEffect(() => { onSkipRef.current = onSkip; }, [onSkip]);
  useEffect(() => { onVisibleItemChangedRef.current = onVisibleItemChanged; }, [onVisibleItemChanged]);
  useEffect(() => { savedTrackIdsRef.current = savedTrackIds; }, [savedTrackIds]);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) {
        const prevIndex = visibleIndexRef.current;
        const newIndex  = first.index;

        // Detect skip: user left a track that wasn't saved
        if (prevIndex >= 0 && prevIndex !== newIndex) {
          const leftTrack = tracksRef.current[prevIndex];
          if (leftTrack && !savedTrackIdsRef.current.has(leftTrack.id)) {
            onSkipRef.current?.(leftTrack);
          }
        }

        visibleIndexRef.current = newIndex;
        usePlayerStore.getState().playTrack(newIndex);

        // Notify parent of card change (used for background artist prefetch)
        const currentTrack = tracksRef.current[newIndex];
        if (currentTrack) {
          onVisibleItemChangedRef.current?.(currentTrack, newIndex);
        }
      }
    },
  ).current;

  // ── Momentum scroll end — ground truth after fast scroll ──────────────────
  // onViewableItemsChanged fires for intermediate cards during fast scroll.
  // onMomentumScrollEnd fires once the FlatList has fully settled, giving us
  // the definitive final index. This recalculation ensures the store always
  // reflects the card the user actually landed on.
  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(e.nativeEvent.contentOffset.y / itemHeight);
      const clampedIndex = Math.max(0, Math.min(index, tracks.length - 1));
      visibleIndexRef.current = clampedIndex;
      usePlayerStore.getState().playTrack(clampedIndex);
    },
    [itemHeight, tracks.length],
  );

  // ── Auto-scroll when queueIndex advances due to audio finishing ─────────
  // Only fires when the store index is ahead of what the FlatList is showing
  // (i.e. audio finished and nextTrack() ran). When the user swipes manually,
  // onViewableItemsChanged updates visibleIndexRef first, so by the time this
  // effect runs visibleIndexRef === queueIndex and we skip the scroll.
  useEffect(() => {
    if (queueIndex > 0 && queueIndex !== visibleIndexRef.current && queueIndex < tracks.length) {
      flatListRef.current?.scrollToIndex({ index: queueIndex, animated: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueIndex]);

  // ── Render item ────────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item, index }: { item: SpotifyTrack; index: number }) => {
      const isActive = index === queueIndex;
      const features = audioFeaturesMap?.[item.id];

      return (
        <AnimatedCardWrapper scrollY={scrollY} index={index} itemHeight={itemHeight}>
          <HookCard
            track={item}
            audioFeatures={features}
            isActive={isActive}
            isSaved={savedTrackIds.has(item.id)}
            onSave={() => onSave(item)}
            onExpand={() => onExpand(item)}
            onAddToPlaylist={onAddToPlaylist ? () => onAddToPlaylist(item) : undefined}
            onTogglePlay={togglePlay}
            height={itemHeight}
            bottomPadding={bottomPadding}
          />
        </AnimatedCardWrapper>
      );
    },
    [queueIndex, savedTrackIds, audioFeaturesMap, itemHeight, scrollY, onSave, onExpand, onAddToPlaylist, togglePlay, bottomPadding],
  );

  return (
    <View style={styles.list}>
      {/* Skeleton sits behind the FlatList during cache-restore cross-fade */}
      {isCacheRestore && (
        <Animated.View style={[StyleSheet.absoluteFill, skeletonStyle]} pointerEvents="none">
          <FeedSkeletonCard itemHeight={itemHeight} bottomPadding={bottomPadding} />
        </Animated.View>
      )}
      <Animated.View style={[StyleSheet.absoluteFill, feedStyle]}>
      <Animated.FlatList
        ref={flatListRef as any}
        data={tracks}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        style={StyleSheet.absoluteFill}
        // Vertical snap — one full card per page
        snapToInterval={itemHeight}
        snapToAlignment="start"
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        // Scroll-driven scale animation
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        // Viewability-driven audio
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        // Exact layout — eliminates measurement for all items (critical for large lists)
        getItemLayout={(_data, index) => ({
          length: itemHeight,
          offset: itemHeight * index,
          index,
        })}
        // Cache restore: jump to saved position without animation
        initialScrollIndex={
          initialScrollIndex && initialScrollIndex > 0 && initialScrollIndex < tracks.length
            ? initialScrollIndex
            : undefined
        }
        onScrollToIndexFailed={(info) => {
          // Fallback: scroll to the nearest renderable position then retry
          flatListRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: false,
          });
        }}
        // Final settled index after momentum scroll
        onMomentumScrollEnd={handleMomentumScrollEnd}
        // Pull-to-refresh
        refreshControl={
          onRefresh != null ? (
            <RefreshControl
              refreshing={refreshing ?? false}
              onRefresh={onRefresh}
              tintColor="rgba(255,255,255,0.5)"
            />
          ) : undefined
        }
        // Infinite scroll
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        // Performance — only render prev/current/next; don't measure unvisited items
        removeClippedSubviews
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
      />
      </Animated.View>
    </View>
  );
};

// ─── Skeleton card (shown during cache-restore cross-fade) ────────────────────

const FeedSkeletonCard = ({
  itemHeight,
  bottomPadding,
}: {
  itemHeight: number;
  bottomPadding: number;
}) => (
  <View style={[skeletonStyles.card, { height: itemHeight, paddingBottom: bottomPadding }]}>
    <View style={skeletonStyles.art} />
    <View style={skeletonStyles.meta}>
      <View style={skeletonStyles.line} />
      <View style={[skeletonStyles.line, skeletonStyles.lineShort]} />
      <View style={skeletonStyles.waveform} />
    </View>
  </View>
);

const skeletonStyles = StyleSheet.create({
  card: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 20,
    backgroundColor: '#0A0A0A',
  },
  art: {
    width: 240,
    height: 240,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  meta: {
    width: '100%',
    gap: 10,
  },
  line: {
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.1)',
    width: '70%',
  },
  lineShort: {
    width: '45%',
    opacity: 0.6,
  },
  waveform: {
    height: 40,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginTop: 4,
  },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
});

export default SwipeFeed;
