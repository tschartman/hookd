import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SlidersHorizontal } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, InteractionManager, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFestivalCacheStore } from '@/src/stores/festivalCacheStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import FestivalFilterSheet from '@/src/components/FestivalFilterSheet';
import FestivalFeedMode, { type FeedMode } from '@/src/components/FestivalFeedMode';
import SwipeFeed from '@/src/components/SwipeFeed';
import VibePill from '@/src/components/VibePill';
import VibeProgress from '@/src/components/VibeProgress';
import { useFestivalBySlug, fetchFestivalTracks } from '@/src/hooks/useFestivalData';
import { useCollections } from '@/src/hooks/useCollections';
import { useSessionVibe } from '@/src/hooks/useSessionVibe';
import { unloadAllSounds } from '@/src/hooks/useAudioPlayer';
import { abortAllPending } from '@/src/services/itunes';
import { prefetchIfIdle } from '@/src/services/artistPrefetch';
import type { SpotifyTrack } from '@/src/services/spotify';
import type { ResolvedTrack } from '@/src/types/index';
import { enforceArtistSpacing, extractPrimaryArtist } from '@/src/utils/feedAlgorithm';
import CompletionCard from '@/src/components/CompletionCard';
import { useCollectionStore } from '@/src/stores/collectionStore';
import { useFestivalProgressStore } from '@/src/stores/festivalProgressStore';
import { usePlayerStore } from '@/src/stores/playerStore';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Height of the FestivalFeedMode row (mode label + bar + vertical padding). */
const PROGRESS_BAR_HEIGHT = 42;

/** After this many plays, a primary artist no longer appears in the queue. */
const ARTIST_EXHAUST_LIMIT = 2;

// ─── Weighted shuffle utils ───────────────────────────────────────────────────

type TierWeights = { headliner: number; midtier: number; opener: number };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Interpolate tier weights from slider position.
 *   0.0 = Popular:   70 / 20 / 10
 *   0.5 = Default:   50 / 30 / 20
 *   1.0 = Discovery: 20 / 30 / 50
 */
function getWeights(slider: number): TierWeights {
  if (slider <= 0.5) {
    const t = slider * 2;
    return {
      headliner: lerp(0.7, 0.5, t),
      midtier:   lerp(0.2, 0.3, t),
      opener:    lerp(0.1, 0.2, t),
    };
  }
  const t = (slider - 0.5) * 2;
  return {
    headliner: lerp(0.5, 0.2, t),
    midtier:   lerp(0.3, 0.3, t),
    opener:    lerp(0.2, 0.5, t),
  };
}

function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Catalog-based queue building ────────────────────────────────────────────

/**
 * Pick one resolved track from a pre-cached artist catalog using weighted random.
 * sliderPosition 0.0 = Popular (favors rank 1–10), 1.0 = Discovery (favors 10–50).
 * Tracks already played this build are excluded.
 */
function selectTrackFromCatalog(
  tracks: ResolvedTrack[],
  sliderPosition: number,
  playedKeys: Set<string>,
  artistName: string,
): ResolvedTrack | null {
  const available = tracks.filter(
    (t) => !playedKeys.has(`${artistName}:${t.track_name}`),
  );
  if (!available.length) return null;

  const weights = available.map((t) => {
    const popularWeight   = 1 / (t.track_rank * 0.5 + 0.5);
    const discoveryWeight = Math.log(t.track_rank + 1);
    return popularWeight * (1 - sliderPosition) + discoveryWeight * sliderPosition;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let rand = Math.random() * totalWeight;
  for (let i = 0; i < available.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return available[i];
  }
  return available[available.length - 1];
}

/** Convert a resolved Supabase row into the SpotifyTrack shape the player expects. */
function resolvedToSpotifyTrack(
  track: ResolvedTrack,
  artist: { tier: string; genres?: string[] },
): SpotifyTrack {
  const artLow  = track.itunes_artwork_url ?? '';
  const artHigh = artLow.replace('100x100bb', '600x600bb');
  return {
    id:          String(track.itunes_track_id),
    name:        track.track_name,
    preview_url: track.itunes_preview_url,
    duration_ms: 30_000,
    artists:     [{ id: String(track.itunes_track_id), name: track.itunes_artist_name ?? track.artist_name }],
    album: {
      id:     '',
      name:   track.itunes_collection_name ?? '',
      images: [
        { url: artHigh, width: 600, height: 600 },
        { url: artLow,  width: 100, height: 100 },
      ],
    },
    external_urls: { spotify: '' },
    tier:        artist.tier as 'headliner' | 'midtier' | 'opener',
    popularity:  track.track_rank,
    genres:      artist.genres ?? [],
    releaseYear: track.itunes_release_date
      ? parseInt(track.itunes_release_date.slice(0, 4), 10)
      : undefined,
  };
}

type FestivalArtistEntry = { name: string; tier: string; genres?: string[] };

/**
 * Build a complete, artist-spaced queue from the pre-resolved Supabase catalog.
 * All data is in-memory — no network calls.
 *
 * 1. Genre-filter the artist list
 * 2. Shuffle within each tier for session variety
 * 3. Probabilistically interleave tiers using getWeights(slider)
 * 4. For each artist, pick one track via weighted-random from their catalog
 * 5. Enforce artist spacing
 */
function buildFestivalQueueFromCatalog(
  festivalArtists: FestivalArtistEntry[],
  tracksByArtist: Map<string, ResolvedTrack[]>,
  sliderPosition: number,
  genreFilters: Set<string> | null,
  artistPlayCount?: Map<string, number>,
): SpotifyTrack[] {
  // 1. Genre filter — artists with no genres are always included
  let artists = genreFilters === null || genreFilters.size === 0
    ? festivalArtists
    : festivalArtists.filter(
        (a) => !a.genres?.length || a.genres.some((g) => genreFilters.has(g)),
      );

  // 1.5. Filter out exhausted artists (heard ARTIST_EXHAUST_LIMIT times this session)
  if (artistPlayCount) {
    artists = artists.filter((a) => {
      const primary = extractPrimaryArtist(a.name);
      return (artistPlayCount.get(primary) ?? 0) < ARTIST_EXHAUST_LIMIT;
    });
  }

  if (!artists.length) return [];

  // 2. Group + shuffle within each tier
  const byTier: Record<'headliner' | 'midtier' | 'opener', FestivalArtistEntry[]> = {
    headliner: [],
    midtier:   [],
    opener:    [],
  };
  for (const a of artists) {
    const tier = (a.tier as 'headliner' | 'midtier' | 'opener') ?? 'opener';
    byTier[tier].push(a);
  }
  for (const tier of ['headliner', 'midtier', 'opener'] as const) {
    byTier[tier] = shuffleArr(byTier[tier]);
  }

  // 3. Interleave tiers probabilistically
  const weights = getWeights(sliderPosition);
  const ptrs = { headliner: 0, midtier: 0, opener: 0 };
  const orderedArtists: FestivalArtistEntry[] = [];
  const total = artists.length;

  while (orderedArtists.length < total) {
    const available = (['headliner', 'midtier', 'opener'] as const).filter(
      (t) => ptrs[t] < byTier[t].length,
    );
    if (!available.length) break;

    const totalWeight = available.reduce((s, t) => s + weights[t], 0);
    let rand = Math.random() * totalWeight;
    let chosen: 'headliner' | 'midtier' | 'opener' = available[0];
    for (const tier of available) {
      rand -= weights[tier];
      if (rand <= 0) { chosen = tier; break; }
    }
    orderedArtists.push(byTier[chosen][ptrs[chosen]]);
    ptrs[chosen]++;
  }

  // 4. Pick one track per artist from their resolved catalog
  const playedKeys = new Set<string>();
  const queue: SpotifyTrack[] = [];

  for (const artist of orderedArtists) {
    const catalog = tracksByArtist.get(artist.name);
    if (!catalog?.length) {
      console.log(`[festival] skipping ${artist.name} — no resolved tracks`);
      continue;
    }
    const selected = selectTrackFromCatalog(catalog, sliderPosition, playedKeys, artist.name);
    if (!selected) continue;
    playedKeys.add(`${artist.name}:${selected.track_name}`);
    queue.push(resolvedToSpotifyTrack(selected, artist));
  }

  // 5. Artist spacing
  return enforceArtistSpacing(queue);
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FestivalScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const festival = useFestivalBySlug(slug ?? '');

  // ── Cache store ───────────────────────────────────────────────────────────
  const { loadCache, getCache, saveCache } = useFestivalCacheStore();

  // ── Load state ────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [feedInitialIndex, setFeedInitialIndex] = useState(0);

  const queue = usePlayerStore((s) => s.queue);

  // ── Full track pool (all artists fetched so far) ──────────────────────────
  const allTracksRef = useRef<SpotifyTrack[]>([]);
  // Pre-resolved catalog from Supabase — keyed by artist_name, used for instant slider rebuilds
  const tracksByArtistRef = useRef<Map<string, ResolvedTrack[]>>(new Map());
  // Mirrors of slider/genres for useFocusEffect cleanup (avoids stale closures)
  const sliderValueRef   = useRef(0.25);
  const activeGenresRef  = useRef<Set<string> | null>(null);
  // Date.now() when tracks were first fetched — preserved across save/restores
  const cacheLoadedAtRef = useRef<number | null>(null);
  // Skip the hero intro card on cache restores (user has already seen it)
  const skipHeroRef = useRef(false);
  // Tracks already served this session (artist:trackName) — prevents same track repeating
  const playedTracksRef = useRef(new Set<string>());

  // ── Artist exhaustion (session-local, not persisted) ─────────────────────
  // Counts how many tracks each primary artist has actually played this session.
  // useRef so it resets on every mount (re-entry) without causing re-renders.
  const artistPlayCountRef = useRef(new Map<string, number>());
  // Prevent concurrent extendQueue calls (synchronous but called from effects)
  const isExtendingRef = useRef(false);
  // Ref mirror of showCompletion for use inside callbacks without stale closures
  const showCompletionRef = useRef(false);
  const [showCompletion, setShowCompletion] = useState(false);
  // Total unique primary artists with resolved tracks — used in the completion card
  const totalArtistsWithTracksRef = useRef(0);

  // ── Feed mode: 'explore' (exhaustion ON) | 'freeplay' (exhaustion OFF) ──
  // Always defaults to explore on every mount (re-entry). Not persisted.
  const [feedMode, setFeedMode] = useState<FeedMode>('explore');
  const feedModeRef = useRef<FeedMode>('explore');
  // Count of unique primary artists heard this session (derived from artistPlayCountRef.size).
  // Maintained as state so the FestivalFeedMode component re-renders on change.
  const [artistsExplored, setArtistsExplored] = useState(0);

  // ── Session vibe ──────────────────────────────────────────────────────────
  const { vibeStage, vibeLabel, saveCount, addSave, addSkip } = useSessionVibe();
  const { saveTrack, unsaveTrack } = useCollections();

  // ── Saved tracks — derived from this festival's collection ────────────────
  const festivalTracks = useCollectionStore((s) => s.collections[slug ?? '']?.tracks);
  const savedTrackIds = useMemo(
    () => new Set((festivalTracks ?? []).map((t) => t.itunesTrackId)),
    [festivalTracks],
  );

  // ── User controls ─────────────────────────────────────────────────────────
  const [sliderValue, setSliderValue]   = useState(0.25);
  const [activeGenres, setActiveGenres] = useState<Set<string> | null>(null);
  const [allGenres, setAllGenres]       = useState<string[]>([]);

  // ── Filter sheet ──────────────────────────────────────────────────────────
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  const hasActiveFilter = activeGenres !== null || Math.abs(sliderValue - 0.25) > 0.01;
  const genresSetRef = useRef<Set<string>>(new Set());

  // Keep refs in sync so useFocusEffect cleanup captures current values
  useEffect(() => { sliderValueRef.current = sliderValue; }, [sliderValue]);
  useEffect(() => { activeGenresRef.current = activeGenres; }, [activeGenres]);


  // ── Artists-heard counter (persisted via festivalProgressStore) ──────────
  const { loadProgress, markArtistHeard, resetProgress } = useFestivalProgressStore();
  const heardArtistNames = useFestivalProgressStore(
    useCallback((s) => s.progress[slug ?? ''], [slug]),
  );
  const heardArtists = useMemo(() => new Set(heardArtistNames ?? []), [heardArtistNames]);

  // Load persisted progress when the festival is known
  useEffect(() => {
    if (!festival) return;
    loadProgress();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [festival?.slug]);

  // ── Artist exhaustion: extend queue with unexplored artists ──────────────
  // Called when the user approaches the end of the current queue.
  // Builds a new batch from the in-memory catalog, excluding exhausted artists.
  // If all artists are exhausted, shows the completion card instead.
  const extendQueue = useCallback(() => {
    if (isExtendingRef.current) return;
    if (showCompletionRef.current) return;
    if (!festival || !tracksByArtistRef.current.size) return;

    isExtendingRef.current = true;
    const festivalCtx = { type: 'festival' as const, slug: slug ?? '' };

    // In Free Play mode, skip the exhaustion check — pass undefined so all artists are eligible
    const newTracks = buildFestivalQueueFromCatalog(
      festival.artists,
      tracksByArtistRef.current,
      sliderValueRef.current,
      activeGenresRef.current,
      feedModeRef.current === 'explore' ? artistPlayCountRef.current : undefined,
    );

    isExtendingRef.current = false;

    if (!newTracks.length) {
      // All artists have hit ARTIST_EXHAUST_LIMIT — show the completion card (Explore mode only)
      if (feedModeRef.current === 'explore') {
        showCompletionRef.current = true;
        setShowCompletion(true);
      }
      return;
    }

    usePlayerStore.getState().appendToQueue(newTracks, festivalCtx);
  }, [festival, slug]);

  const currentTrack = usePlayerStore((s) => s.currentTrack);

  useEffect(() => {
    if (!currentTrack || !festival || !slug) return;
    const name = currentTrack.artists[0]?.name?.toLowerCase();
    if (!name) return;
    const matched = festival.artists.find(
      (a) => name.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(name),
    );
    if (matched) {
      markArtistHeard(slug, matched.name);

      // Increment session play count for artist exhaustion tracking.
      // Only fires when a track actually becomes currentTrack (audio starts),
      // not on scroll — so fast swipes that don't play don't count.
      const primary = extractPrimaryArtist(currentTrack.artists[0]?.name ?? '');
      if (primary) {
        const prev = artistPlayCountRef.current.get(primary) ?? 0;
        artistPlayCountRef.current.set(primary, prev + 1);
        // Update explore progress counter (count of artists heard >= 1 time)
        setArtistsExplored(artistPlayCountRef.current.size);
      }
    }

    // Extend queue when approaching the end (3 tracks from end)
    const { queueIndex, queue } = usePlayerStore.getState();
    if (queue.length > 0 && queueIndex >= queue.length - 3) {
      extendQueue();
    }
  }, [currentTrack, festival, slug, markArtistHeard, extendQueue]);

  // ── Start Over handler ────────────────────────────────────────────────────
  const handleStartOver = useCallback(() => {
    if (!festival || !slug) return;
    Alert.alert(
      'Reset Progress?',
      `Reset discovery progress for ${festival.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start Over',
          style: 'destructive',
          onPress: () => {
            resetProgress(slug);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          },
        },
      ],
    );
  }, [festival, slug, resetProgress]);

  // ── Re-shuffle on slider / genre change ───────────────────────────────────
  const reshuffleUpcoming = useCallback((slider: number, genres: Set<string> | null) => {
    if (!festival) return;
    if (!tracksByArtistRef.current.size) return;

    // Rebuild the full queue from the in-memory catalog — instant, no network call.
    // Resets to position 0 per spec: slider/genre change = fresh session start.
    // Also reset exhaustion so user gets a full fresh rotation.
    playedTracksRef.current = new Set();
    artistPlayCountRef.current.clear();
    isExtendingRef.current = false;
    showCompletionRef.current = false;
    setShowCompletion(false);

    const newQueue = buildFestivalQueueFromCatalog(
      festival.artists, tracksByArtistRef.current, slider, genres,
    );
    if (!newQueue.length) return;
    allTracksRef.current = newQueue;
    const festivalCtx = { type: 'festival' as const, slug: slug ?? '' };
    usePlayerStore.getState().setQueue(newQueue, 0, false, festivalCtx);
  }, [festival, slug]);

  useEffect(() => {
    if (isLoading || !allTracksRef.current.length) return;
    reshuffleUpcoming(sliderValue, activeGenres);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliderValue, activeGenres]);


  // ── Reshuffle: clear exhaustion, rebuild with all artists ─────────────────
  const handleReshuffle = useCallback(() => {
    if (!festival) return;
    setArtistsExplored(0);
    reshuffleUpcoming(sliderValueRef.current, activeGenresRef.current);
  }, [festival, reshuffleUpcoming]);

  // ── Feed mode toggle: Explore ↔ Free Play ─────────────────────────────────
  const handleToggleMode = useCallback(() => {
    const newMode: FeedMode = feedModeRef.current === 'explore' ? 'freeplay' : 'explore';
    setFeedMode(newMode);
    feedModeRef.current = newMode;

    // Always start fresh counters on mode switch — don't retroactively count
    artistPlayCountRef.current.clear();
    setArtistsExplored(0);

    // Hide completion card if it was showing (only relevant when leaving explore)
    showCompletionRef.current = false;
    setShowCompletion(false);

    // Rebuild queue from in-memory catalog — no network call
    if (festival && tracksByArtistRef.current.size) {
      reshuffleUpcoming(sliderValueRef.current, activeGenresRef.current);
    }
  }, [festival, reshuffleUpcoming]);

  // ── Genre handlers ────────────────────────────────────────────────────────
  const handleGenreToggle = useCallback((genre: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveGenres((prev) => {
      if (prev === null) return new Set([genre]);
      const next = new Set(prev);
      if (next.has(genre)) {
        next.delete(genre);
        return next.size === 0 ? null : next;
      }
      next.add(genre);
      return next;
    });
  }, []);

  const handleAllGenres = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveGenres(null);
  }, []);

  // ── Focus/blur ────────────────────────────────────────────────────────────
  const focusPlayTaskRef = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!slug) return;

      // Drain any pending requests from the previous feed, then reset the
      // rate-limit window so this festival gets a clean budget.
      abortAllPending();

      // Restore this festival's queue (saved by the previous setFeedContext call
      // when another screen gained focus) or start empty on first visit.
      usePlayerStore.getState().setFeedContext({ type: 'festival', slug });

      // If the queue was restored (returning visit), start playback.
      // On first visit the queue is empty — the load effect triggers play itself.
      if (usePlayerStore.getState().queue.length > 0) {
        focusPlayTaskRef.current = InteractionManager.runAfterInteractions(() => {
          focusPlayTaskRef.current = null;
          if (isMountedRef.current) {
            usePlayerStore.getState()._setIsPlaying(true);
          }
        });
      }

      return () => {
        focusPlayTaskRef.current?.cancel();
        focusPlayTaskRef.current = null;

        // Stop audio immediately — setFeedContext on the next screen's focus
        // will save and restore queues; we don't need to snapshot here.
        usePlayerStore.getState()._setIsPlaying(false);

        // Unload Sound objects to prevent audio engine memory buildup
        unloadAllSounds();

        // Save feed position to cache for app-restart restoration
        const { queue, queueIndex } = usePlayerStore.getState();
        if (queue.length && festival && slug) {
          console.log(`[festival] Saving cache for ${slug}: ${queue.length} tracks at index ${queueIndex}`);
          saveCache(slug, {
            tracks: queue,
            currentIndex: queueIndex,
            allGenres: [...genresSetRef.current].sort(),
            sliderValue: sliderValueRef.current,
            activeGenres: activeGenresRef.current ? [...activeGenresRef.current] : null,
            festivalArtistCount: festival.artists.length,
            loadedAt: cacheLoadedAtRef.current ?? Date.now(),
          });
        }
      };
    }, [festival, saveCache, slug]),
  );

  // ── Supabase catalog loader (cache-aware) ────────────────────────────────
  const isMountedRef = useRef(false);

  useEffect(() => {
    if (!festival) return;

    isMountedRef.current = true;
    allTracksRef.current    = [];
    tracksByArtistRef.current = new Map();
    genresSetRef.current    = new Set();
    playedTracksRef.current = new Set();

    console.log(`[festival] Loading tracks for: ${slug}`);

    const festivalCtx = { type: 'festival' as const, slug: slug ?? '' };

    const load = async () => {
      // ── 0. Clear queue so the previous festival is never briefly visible ──
      usePlayerStore.getState().setQueue([], 0, false, festivalCtx);

      // ── 1. Fetch the full resolved catalog from Supabase (one query) ──────
      //       This is fast (~200 ms) and needed for slider rebuilds even on cache hits.
      const artistNames = festival.artists.map((a) => a.name);
      const catalogMap  = await fetchFestivalTracks(artistNames);

      if (!isMountedRef.current) return;

      tracksByArtistRef.current = catalogMap;
      console.log(`[festival] Catalog: ${catalogMap.size} artists with resolved tracks`);

      // Count unique primary artists with resolved tracks (for the completion card)
      const uniquePrimary = new Set<string>();
      for (const name of catalogMap.keys()) {
        uniquePrimary.add(extractPrimaryArtist(name));
      }
      totalArtistsWithTracksRef.current = uniquePrimary.size;

      // Collect genres from festival artists (faster than waiting for track data)
      for (const a of festival.artists) {
        (a.genres ?? []).forEach((g) => genresSetRef.current.add(g));
      }
      setAllGenres([...genresSetRef.current].sort());

      // ── 2. Check queue cache ──────────────────────────────────────────────
      await loadCache();

      const cached = getCache(slug ?? '', festival.artists.length);
      console.log(`[cache] ${slug} — ${cached ? `HIT (${cached.tracks.length} tracks, index ${cached.currentIndex})` : 'MISS'}`);

      if (cached) {
        allTracksRef.current = cached.tracks;
        cacheLoadedAtRef.current = cached.loadedAt;
        setSliderValue(cached.sliderValue);
        setActiveGenres(cached.activeGenres ? new Set(cached.activeGenres) : null);
        setFeedInitialIndex(cached.currentIndex);
        usePlayerStore.getState().setQueue(cached.tracks, cached.currentIndex, false, festivalCtx);
        skipHeroRef.current = true;
        if (isMountedRef.current) setIsLoading(false);
        InteractionManager.runAfterInteractions(() => {
          if (isMountedRef.current) {
            usePlayerStore.getState()._setIsPlaying(true);
          }
        });
        return;
      }

      // ── 3. Fresh load: build the full queue from the in-memory catalog ────
      //       No iTunes calls, no progressive loading, no minimum threshold wait.
      console.log(`[festival] Cache MISS for ${slug}, building queue from catalog`);
      cacheLoadedAtRef.current = Date.now();

      if (!catalogMap.size) {
        if (isMountedRef.current) {
          setError('No tracks found for this lineup. Try running the resolve-festival-itunes Edge Function.');
          setIsLoading(false);
        }
        return;
      }

      const initialQueue = buildFestivalQueueFromCatalog(
        festival.artists, catalogMap, sliderValueRef.current, activeGenresRef.current,
      );

      if (!initialQueue.length) {
        if (isMountedRef.current) {
          setError('No playable previews found for this lineup.');
          setIsLoading(false);
        }
        return;
      }

      allTracksRef.current = initialQueue;
      console.log(`[festival] Queue built: ${initialQueue.length} tracks from ${new Set(initialQueue.map((t) => t.artists[0]?.name)).size} artists`);

      usePlayerStore.getState().setQueue(initialQueue, 0, false, festivalCtx);
      if (isMountedRef.current) setIsLoading(false);

      InteractionManager.runAfterInteractions(() => {
        if (isMountedRef.current) {
          usePlayerStore.getState()._setIsPlaying(true);
        }
      });
    };

    load().catch((err) => {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load tracks.');
        setIsLoading(false);
      }
    });

    return () => { isMountedRef.current = false; };
    // festival?.slug ensures the effect re-runs if festival was null on first
    // mount (e.g. slow Supabase) and resolves later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [festival?.slug]);

  // ── Hero card (brief intro overlay) ──────────────────────────────────────
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const [heroVisible, setHeroVisible] = useState(false);

  // Fade in when feed loads, auto-dismiss after 2.8s (skip on cache restore)
  useEffect(() => {
    if (isLoading || skipHeroRef.current) return;
    setHeroVisible(true);
    Animated.sequence([
      Animated.timing(heroOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(2200),
      Animated.timing(heroOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start(() => setHeroVisible(false));
  }, [isLoading, heroOpacity]);

  const dismissHero = useCallback(() => {
    Animated.timing(heroOpacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(
      () => setHeroVisible(false),
    );
  }, [heroOpacity]);

  // ── Save handler ──────────────────────────────────────────────────────────
  const handleSave = useCallback(
    (track: SpotifyTrack) => {
      if (!festival) return;

      if (savedTrackIds.has(track.id)) {
        unsaveTrack(track.id, festival.slug);
        return;
      }

      // Save to this festival's collection + update vibe engine
      saveTrack(track, { type: 'festival', slug: festival.slug, name: festival.name });
      addSave(track);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Note: no "more like this" in festival mode — queue stays a fair shuffle of the full lineup
    },
    [savedTrackIds, saveTrack, unsaveTrack, addSave, festival],
  );

  // ── Background artist prefetch ────────────────────────────────────────────
  const handleVisibleItemChanged = useCallback((track: SpotifyTrack, index: number) => {
    const artistId = track.artists[0]?.id ?? track.id;
    const artistName = track.artists[0]?.name ?? track.name;
    prefetchIfIdle(artistName, artistId);

    const nextTrack = queue[index + 1];
    if (nextTrack) {
      const nextArtistId = nextTrack.artists[0]?.id ?? nextTrack.id;
      const nextArtistName = nextTrack.artists[0]?.name ?? nextTrack.name;
      setTimeout(() => prefetchIfIdle(nextArtistName, nextArtistId), 2000);
    }
  }, [queue]);

  // ── 404 ───────────────────────────────────────────────────────────────────
  if (!festival) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Festival not found.</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.backLink}>← Go back</Text>
        </Pressable>
      </View>
    );
  }

  // ── Loading screen (skeleton card — shown until 5+ tracks are ready) ───────
  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>✕</Text>
          </Pressable>

          <View style={styles.loadingContent}>
            <Text style={styles.loadingFestival}>{festival.name}</Text>
            <Text style={styles.loadingLocation}>{festival.location}</Text>

            <View style={styles.skeletonCard}>
              <View style={styles.skeletonMeta}>
                <View style={styles.skeletonLine} />
                <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
              </View>
            </View>
          </View>
        </View>
      </>
    );
  }

  // ── Error screen ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backLink}>← Go back</Text>
          </Pressable>
        </View>
      </>
    );
  }

  // ── Feed screen ───────────────────────────────────────────────────────────
  const BANNER_HEIGHT = 52 + insets.top;
  const FEED_TOP      = BANNER_HEIGHT + PROGRESS_BAR_HEIGHT;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        {/* Feed — sits below banner + controls */}
        <View style={[styles.feedWrapper, { paddingTop: FEED_TOP, paddingBottom: insets.bottom }]}>
          <SwipeFeed
            tracks={queue}
            savedTrackIds={savedTrackIds}
            onSave={handleSave}
            onExpand={(track) => router.push({
              pathname: '/artist/[id]' as any,
              params: {
                id: track.artists[0]?.id ?? track.id,
                name: track.artists[0]?.name ?? track.name,
                sourceCollection: slug ?? '',
                sourceContext: 'festival',
                originatingTrackId: track.id,
              },
            })}
            onEndReached={extendQueue}
            onSkip={addSkip}
            tabBarHeight={0}
            topOffset={FEED_TOP}
            bottomPadding={16}
            initialScrollIndex={feedInitialIndex > 0 ? feedInitialIndex : undefined}
            onVisibleItemChanged={handleVisibleItemChanged}
          />

          {/* Vibe overlays — positioned inside feedWrapper so they clear the banner */}

          {vibeStage === 'building' && (
            <View style={styles.vibeProgressContainer}>
              <VibeProgress saveCount={saveCount} />
            </View>
          )}

          {(vibeStage === 'forming' || vibeStage === 'locked') && vibeLabel && (
            <View style={styles.vibePillContainer}>
              <VibePill stage={vibeStage} label={vibeLabel} />
            </View>
          )}

          {/* Completion overlay — Explore mode only, shown when all artists exhausted */}
          {showCompletion && feedMode === 'explore' && (
            <CompletionCard
              artistCount={totalArtistsWithTracksRef.current}
              festivalName={festival.name}
              onReshuffle={handleReshuffle}
            />
          )}
        </View>

        {/* Floating banner */}
        <View style={[styles.banner, { paddingTop: insets.top, height: BANNER_HEIGHT }]}>
          <Pressable onPress={() => router.back()} style={styles.bannerBack} hitSlop={8}>
            <Text style={styles.bannerBackText}>‹</Text>
          </Pressable>

          {/* Filter toggle — left of title, matching MissionTopBar pattern */}
          <Pressable
            onPress={() => { setFilterSheetVisible(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            hitSlop={8}
            style={styles.filterToggleBtn}
          >
            <SlidersHorizontal
              size={18}
              color={hasActiveFilter ? '#1DB954' : 'rgba(255,255,255,0.55)'}
            />
            {hasActiveFilter && <View style={styles.filterDot} />}
          </Pressable>

          <View style={styles.bannerCenter}>
            <Text style={styles.bannerTitle} numberOfLines={1}>
              {festival.name}
            </Text>
            <Text style={styles.bannerSub} numberOfLines={1}>
              {festival.location}
              {festival.dates ? ` · ${festival.dates}` : ''}
            </Text>
          </View>
        </View>

        {/* Mode indicator + progress bar — directly below banner, static position */}
        <View style={[styles.progressBarPanel, { top: BANNER_HEIGHT }]}>
          <FestivalFeedMode
            mode={feedMode}
            artistsExplored={artistsExplored}
            totalArtists={totalArtistsWithTracksRef.current}
            onToggleMode={handleToggleMode}
          />
        </View>

        {/* Hero intro card — anchored to bottom of container, above action bar area */}
        {heroVisible && (
          <Animated.View
            style={[styles.heroOverlay, { opacity: heroOpacity, bottom: insets.bottom + 90 }]}
            pointerEvents="box-none"
          >
            <Pressable onPress={dismissHero} style={styles.heroCard}>
              <LinearGradient
                colors={[festival.imageColors?.primary ?? '#1DB954', festival.imageColors?.secondary ?? '#0A0A0A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroGradient}
              >
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.75)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <View style={styles.heroContent}>
                  <Text style={styles.heroName}>{festival.name}</Text>
                  <Text style={styles.heroMeta}>{festival.dates}</Text>
                  <Text style={styles.heroMeta}>{festival.location}</Text>
                  <Text style={styles.heroCta}>
                    {festival.artists.length} artists · Swipe to discover ›
                  </Text>
                </View>
              </LinearGradient>
            </Pressable>
          </Animated.View>
        )}

        {/* Filter bottom sheet */}
        <FestivalFilterSheet
          visible={filterSheetVisible}
          sliderValue={sliderValue}
          onSliderChange={setSliderValue}
          genres={allGenres}
          activeGenres={activeGenres}
          onGenreToggle={handleGenreToggle}
          onAllGenres={handleAllGenres}
          onClose={() => setFilterSheetVisible(false)}
          onResetProgress={handleStartOver}
          canResetProgress={heardArtists.size > 0}
        />

      </View>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  feedWrapper: {
    flex: 1,
  },
  vibeProgressContainer: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  vibePillContainer: {
    position: 'absolute',
    top: 12,
    right: 16,
  },
  centered: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },

  // Full-screen loading
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  backButton: {
    alignSelf: 'flex-end',
    padding: 20,
  },
  backButtonText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 18,
  },
  loadingContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
    marginTop: -60,
  },
  loadingFestival: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  loadingLocation: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    textAlign: 'center',
  },
  // Skeleton card (replaces ActivityIndicator during first load)
  skeletonCard: {
    width: '100%',
    marginTop: 28,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    height: 260,
    justifyContent: 'flex-end',
    padding: 20,
  },
  skeletonMeta: {
    gap: 10,
  },
  skeletonLine: {
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.15)',
    width: '75%',
  },
  skeletonLineShort: {
    width: '45%',
    opacity: 0.5,
  },

  // Banner
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: 'rgba(10,10,10,0.88)',
    gap: 10,
  },
  bannerBack: {
    marginBottom: 2,
  },
  bannerBackText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 28,
  },
  bannerCenter: {
    flex: 1,
    gap: 2,
  },
  filterToggleBtn: {
    padding: 6,
    position: 'relative',
  },
  filterDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#1DB954',
  },
  bannerTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  bannerSub: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontFamily: 'SpaceMono',
  },
  progressBarPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
  },


  // Hero intro card
  heroOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 20,
  },
  heroCard: {
    borderRadius: 20,
    overflow: 'hidden',
    height: 180,
  },
  heroGradient: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  heroContent: {
    padding: 18,
    gap: 4,
  },
  heroName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroMeta: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '500',
  },
  heroCta: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontFamily: 'SpaceMono',
    marginTop: 6,
  },

  // Error
  errorText: {
    color: '#FF4D4D',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  backLink: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
});
