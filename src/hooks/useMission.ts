// ─── useMission ───────────────────────────────────────────────────────────────
// Manages the card queue, adaptive refill, and save/skip actions for a mission.
//
// DEFAULT MODE (no filter):
//   Loads purely from mission_playlist_tracks (Supabase, populated by Last.fm
//   tag.getTopTracks). Tracks are weighted-shuffled by tag_count:
//     top   (tag_count ≥ 3): interleaved 3:1:1 at the front of the pool
//     mid   (tag_count = 2): 1 per cycle
//     base  (tag_count = 1): 1 per cycle
//   All are searched by track+artist name — they're specific crowd-curated songs.
//
// FILTER MODE (user opened the filter sheet):
//   Switches to the gold/silver/bronze tiered pool that combines activity tracks
//   with genre×era artists from Supabase.
//     Gold   — activity track whose artist is in user's genre×era selection
//     Silver — activity track with tag_count ≥ 2, not genre-matched
//     Bronze — genre×era artist not in activity data
//
//   When the filter sheet "Clear all" is tapped the pool reverts to default mode.
//
// Adaptive learning: MINIMAL. Right swipe = save. Left swipe = skip.
// No pool reordering on swipes — pool quality + artist cap + spacing handles variety.

import { useCallback, useEffect, useRef, useState } from 'react';

import { MISSION_TEMPLATES } from '@/src/data/missionTemplates';
import {
  resetRateLimitWindow,
  searchTrackByName,
  searchTracksByArtist,
} from '@/src/services/itunes';
import { getArtistsForMission, getSimilarArtists } from '@/src/services/lastfm';
import { getMissionPlaylistTracks, type MissionPlaylistTrack } from '@/src/services/missionDiscovery';
import type { SpotifyTrack } from '@/src/services/spotify';
import type { MissionFilter } from '@/src/stores/missionStore';
import { useMissionStore } from '@/src/stores/missionStore';
import { useCollections } from '@/src/hooks/useCollections';
import {
  enforceArtistSpacing,
  deduplicateTracks,
  deduplicateMissionTracks,
  capMissionArtistTracks,
  normalizeTrackForGrouping,
} from '@/src/utils/feedAlgorithm';
import { isArtistSeenGlobally, markArtistsSeenGlobally } from '@/src/stores/globalSessionStore';

// ─── Constants ────────────────────────────────────────────────────────────────

const INITIAL_SEED_COUNT = 3;
const LOOKAHEAD_THRESHOLD = 3;
const BATCH_SIZE = 2;
const TRACKS_PER_ARTIST = 5;
const POOL_REFILL_THRESHOLD = 10;
/** Wider spacing for missions — user sees one card at a time, same artist 3 apart feels repetitive. */
const MISSION_ARTIST_SPACING = 5;
/** Minimum tag_count for silver tier in filter mode. */
const SILVER_MIN_TAG_COUNT = 2;

// ─── Pool entry ───────────────────────────────────────────────────────────────

type PoolTier = 'gold' | 'silver' | 'bronze';

interface PoolEntry {
  artistName: string;
  /**
   * Set when we have a specific crowd-curated track name to search for.
   * iTunes is searched by track+artist for a precise match.
   * Bronze/adaptive entries are undefined → searched by artist name.
   */
  trackName?: string;
  /** Higher score = picked sooner by pickFromPool(). */
  score: number;
  used: boolean;
  tier: PoolTier;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const r = [...arr];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/**
 * Interleave gold/silver/bronze items in a 3:1:1 pattern, then assign
 * monotonically decreasing scores so pickFromPool() respects the order.
 */
function buildInterleavedPool(
  gold: { artistName: string; trackName: string }[],
  silver: { artistName: string; trackName: string }[],
  bronze: { artistName: string }[],
): PoolEntry[] {
  const sg = shuffle(gold);
  const ss = shuffle(silver);
  const sb = shuffle(bronze);

  type Ordered = { artistName: string; trackName?: string; tier: PoolTier };
  const ordered: Ordered[] = [];
  let g = 0, s = 0, b = 0;

  while (g < sg.length || s < ss.length || b < sb.length) {
    for (let i = 0; i < 3 && g < sg.length; i++) {
      ordered.push({ artistName: sg[g].artistName, trackName: sg[g].trackName, tier: 'gold' });
      g++;
    }
    if (s < ss.length) {
      ordered.push({ artistName: ss[s].artistName, trackName: ss[s].trackName, tier: 'silver' });
      s++;
    }
    if (b < sb.length) {
      ordered.push({ artistName: sb[b].artistName, tier: 'bronze' });
      b++;
    }
  }

  const total = Math.max(ordered.length, 1);
  return ordered.map((item, i) => ({
    artistName: item.artistName,
    trackName: item.trackName,
    score: 3.0 - (i / total) * 2.0,
    used: false,
    tier: item.tier,
  }));
}

/**
 * Build the default (no filter) pool from activity-tagged tracks.
 * Weighted shuffle: top tier (tag_count ≥ 3) appears 3× more than mid/base.
 * All entries have a specific trackName → iTunes searched by track+artist.
 */
function buildActivityPoolEntries(tracks: MissionPlaylistTrack[]): PoolEntry[] {
  // Dedup versions (keep best per normalized name+artist), then cap per artist
  const sorted = [...tracks].sort((a, b) => {
    if (b.tag_count !== a.tag_count) return b.tag_count - a.tag_count;
    return b.listeners - a.listeners;
  });
  const deduped = deduplicateMissionTracks(sorted);
  const capped = capMissionArtistTracks(deduped);

  const topTier = capped.filter((t) => t.tag_count >= 3);
  const midTier = capped.filter((t) => t.tag_count === 2);
  const baseTier = capped.filter((t) => t.tag_count === 1);

  const st = shuffle([...topTier]);
  const sm = shuffle([...midTier]);
  const sb = shuffle([...baseTier]);

  const ordered: Array<{ artistName: string; trackName: string }> = [];
  let t = 0, m = 0, b = 0;

  while (t < st.length || m < sm.length || b < sb.length) {
    for (let i = 0; i < 3 && t < st.length; i++) {
      ordered.push({ artistName: st[t].artist_name, trackName: st[t].track_name });
      t++;
    }
    if (m < sm.length) {
      ordered.push({ artistName: sm[m].artist_name, trackName: sm[m].track_name });
      m++;
    }
    if (b < sb.length) {
      ordered.push({ artistName: sb[b].artist_name, trackName: sb[b].track_name });
      b++;
    }
  }

  const total = Math.max(ordered.length, 1);
  return ordered
    .filter((item) => !isArtistSeenGlobally(item.artistName))
    .map((item, i) => ({
      artistName: item.artistName,
      trackName: item.trackName,
      score: 3.0 - (i / total) * 2.0,
      used: false,
      tier: 'gold' as PoolTier,
    }));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type SwipeDirection = 'left' | 'right';

interface LastSwipe {
  direction: SwipeDirection;
  track: SpotifyTrack;
}

export function useMission(missionId: string) {
  const missionStore = useMissionStore();
  const mission = missionStore.getMission(missionId);
  const { saveTrack } = useCollections();

  const [cards, setCards] = useState<SpotifyTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isTuning, setIsTuning] = useState(false);

  // Session tracking
  const seenIdsRef = useRef(new Set<string>());
  const isFetchingRef = useRef(false);
  const refillCountRef = useRef(0);
  const lastSwipeRef = useRef<LastSwipe | null>(null);
  const rightSwipeCountRef = useRef(0);

  // Artist pool — ordered by score descending. Mutated in place.
  const artistPoolRef = useRef<PoolEntry[]>([]);
  const poolOffsetRef = useRef(0);

  // ── Pool helpers ──────────────────────────────────────────────────────────

  function boostOrAddToPool(name: string, score: number) {
    const key = name.toLowerCase();
    const existing = artistPoolRef.current.find(
      (e) => e.artistName.toLowerCase() === key,
    );
    if (existing) {
      existing.score = Math.max(existing.score, score);
    } else {
      artistPoolRef.current.push({ artistName: name, score, used: false, tier: 'bronze' });
    }
  }

  function pickFromPool(count: number): PoolEntry[] {
    const available = artistPoolRef.current
      .filter((e) => !e.used && e.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, count);

    for (const entry of available) {
      entry.used = true;
    }
    return available;
  }

  function isPoolLow(): boolean {
    return artistPoolRef.current.filter((e) => !e.used && e.score >= 0).length < POOL_REFILL_THRESHOLD;
  }

  // ── Derive genres + eras (for filter mode) ───────────────────────────────

  function getGenresAndEras(): { genres: string[]; eras: string[] } {
    if (!mission) return { genres: [], eras: [] };
    // Filter (from filter sheet) takes precedence over legacy vibeProfile
    if (mission.filter) {
      return {
        genres: mission.filter.genres.map((g) => g.toLowerCase()),
        eras: mission.filter.eras,
      };
    }
    // Legacy path: vibe screen was used (old flow)
    const vibe = mission.vibeProfile;
    if (vibe && vibe.selectedGenres.length > 0) {
      return {
        genres: vibe.selectedGenres.map((g) => g.toLowerCase()),
        eras: vibe.selectedEras ?? [],
      };
    }
    // Template fallback for refills when no filter is active
    const template = MISSION_TEMPLATES.find((t) => t.id === mission.templateId);
    const fallback = (template?.suggestedGenres ?? []).map((g) => g.toLowerCase());
    return { genres: fallback, eras: [] };
  }

  // ── Fetch iTunes tracks for a pool entry ─────────────────────────────────

  async function fetchTracksForEntry(entry: PoolEntry): Promise<SpotifyTrack[]> {
    if (entry.trackName) {
      const tracks = await searchTrackByName(entry.trackName, entry.artistName, 5);
      const withPreviews = tracks.filter((t) => !!t.preview_url);
      if (withPreviews.length === 0) return [];
      // Pick the single best match: exact name first, then shortest name (cleanest version)
      const trackNameLower = entry.trackName.toLowerCase();
      const best = withPreviews.sort((a, b) => {
        const aExact = normalizeTrackForGrouping(a.name) === normalizeTrackForGrouping(trackNameLower) ? 0 : 1;
        const bExact = normalizeTrackForGrouping(b.name) === normalizeTrackForGrouping(trackNameLower) ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return a.name.length - b.name.length;
      })[0];
      return [best];
    } else {
      const tracks = await searchTracksByArtist(entry.artistName, TRACKS_PER_ARTIST);
      return tracks.filter((t) => !!t.preview_url);
    }
  }

  async function fetchTracksForEntries(entries: PoolEntry[]): Promise<SpotifyTrack[]> {
    const results: SpotifyTrack[] = [];
    for (const entry of entries) {
      results.push(...await fetchTracksForEntry(entry));
    }
    return results;
  }

  // ── Build tiered pool for filter mode ────────────────────────────────────

  async function buildFilteredPool(
    genres: string[],
    eras: string[],
    soundsLike: string[],
    missionType: string,
  ): Promise<void> {
    const [playlistTracks, genreEraArtists] = await Promise.all([
      getMissionPlaylistTracks(missionType, { limit: 200 }),
      genres.length > 0
        ? getArtistsForMission(genres, eras, { limit: 100 })
        : Promise.resolve([]),
    ]);

    const genreArtistSet = new Set(genreEraArtists.map((a) => a.artist_name.toLowerCase()));
    const playlistArtistSet = new Set(playlistTracks.map((t) => t.artist_name.toLowerCase()));

    if (playlistTracks.length === 0) {
      console.log('[mission] Playlist cache empty, using bronze-only pool');
      for (let i = 0; i < genreEraArtists.length; i++) {
        const name = genreEraArtists[i].artist_name;
        if (!isArtistSeenGlobally(name)) {
          artistPoolRef.current.push({
            artistName: name,
            score: 1.0 - (i / Math.max(genreEraArtists.length, 1)) * 0.5,
            used: false,
            tier: 'bronze',
          });
        }
      }
    } else {
      // Dedup versions and cap per artist before tiering
      const sortedPlaylist = [...playlistTracks].sort((a, b) => {
        if (b.tag_count !== a.tag_count) return b.tag_count - a.tag_count;
        return b.listeners - a.listeners;
      });
      const dedupedPlaylist = deduplicateMissionTracks(sortedPlaylist);
      const cappedPlaylist = capMissionArtistTracks(dedupedPlaylist);

      const gold = cappedPlaylist
        .filter((t) => genreArtistSet.has(t.artist_name.toLowerCase()) && !isArtistSeenGlobally(t.artist_name))
        .map((t) => ({ artistName: t.artist_name, trackName: t.track_name }));

      const silver = cappedPlaylist
        .filter(
          (t) =>
            !genreArtistSet.has(t.artist_name.toLowerCase()) &&
            t.tag_count >= SILVER_MIN_TAG_COUNT &&
            !isArtistSeenGlobally(t.artist_name),
        )
        .map((t) => ({ artistName: t.artist_name, trackName: t.track_name }));

      const bronze = genreEraArtists
        .filter(
          (a) =>
            !playlistArtistSet.has(a.artist_name.toLowerCase()) &&
            !isArtistSeenGlobally(a.artist_name),
        )
        .map((a) => ({ artistName: a.artist_name }));

      artistPoolRef.current = buildInterleavedPool(gold, silver, bronze);

      console.log(
        `[mission] Filter pool: ${gold.length}g ${silver.length}s ${bronze.length}b` +
        ` → ${artistPoolRef.current.length} total`,
      );
    }

    for (const artist of soundsLike) {
      boostOrAddToPool(artist, 5.0);
      getSimilarArtists(artist, 15).then((similar) => {
        for (const s of similar) {
          boostOrAddToPool(s.artist_name, 4.0 * s.match_score + 0.5);
        }
      });
    }
  }

  // ── Refill pool from Supabase when running low ────────────────────────────

  async function refillPool(genres: string[], eras: string[]): Promise<void> {
    poolOffsetRef.current += 80;
    const artists = await getArtistsForMission(genres, eras, {
      limit: 50,
      excludeArtists: artistPoolRef.current.map((e) => e.artistName),
    });

    for (let i = 0; i < artists.length; i++) {
      const name = artists[i].artist_name;
      if (!isArtistSeenGlobally(name)) {
        const score = 0.6 - (i / Math.max(artists.length, 1)) * 0.2;
        artistPoolRef.current.push({ artistName: name, score, used: false, tier: 'bronze' });
      }
    }

    console.log(
      `[mission] Pool refilled: ${artistPoolRef.current.filter((e) => !e.used && e.score >= 0).length} unused`,
    );
  }

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!mission) return;
    let cancelled = false;

    seenIdsRef.current = new Set();
    refillCountRef.current = 0;
    rightSwipeCountRef.current = 0;
    artistPoolRef.current = [];
    poolOffsetRef.current = 0;

    const missionType = mission.templateId;
    const hasFilter = !!mission.filter;
    const hasVibeProfile = !!mission.vibeProfile && mission.vibeProfile.selectedGenres.length > 0;
    const useActivityOnly = !hasFilter && !hasVibeProfile;

    const load = async () => {
      setIsLoading(true);
      setCards([]);
      setCurrentIndex(0);

      resetRateLimitWindow();

      let feedStarted = false;

      const flush = (raw: SpotifyTrack[]) => {
        const fresh = deduplicateTracks(raw, new Set(), seenIdsRef.current);
        if (!fresh.length) return;
        const spaced = enforceArtistSpacing(shuffle(fresh), MISSION_ARTIST_SPACING);
        for (const t of spaced) seenIdsRef.current.add(t.id);
        if (!feedStarted) {
          feedStarted = true;
          setCards(spaced);
          setIsLoading(false);
        } else {
          setCards((prev) => [...prev, ...spaced]);
        }
      };

      if (useActivityOnly) {
        // ── Auto-apply template defaults if available ──────────────────────
        // Missions always start with default genres pre-applied so the pool is
        // already filtered on first load. Filter dot shows since mission.filter
        // will be non-null. User can modify or clear via the filter sheet.
        const template = MISSION_TEMPLATES.find((t) => t.id === missionType);
        if (template && template.defaultGenres.length > 0) {
          const defaultFilter = {
            genres: template.defaultGenres,
            eras: template.defaultEras,
            soundsLikeArtists: [],
          };
          missionStore.setMissionFilter(missionId, defaultFilter);
          console.log(`[mission] Auto-applied defaults for "${missionType}": ${template.defaultGenres.join(', ')}`);
          await buildFilteredPool(template.defaultGenres, template.defaultEras, [], missionType);
          if (cancelled) return;
        } else {
          // Custom mission or template with no defaults — pure activity mode
          console.log(`[mission] Activity-only mode for "${missionType}"`);
          const activityTracks = await getMissionPlaylistTracks(missionType, { limit: 300 });
          if (cancelled) return;

          if (activityTracks.length > 0) {
            artistPoolRef.current = buildActivityPoolEntries(activityTracks);
            console.log(`[mission] Activity pool: ${artistPoolRef.current.length} tracks`);
          } else {
            console.log('[mission] Activity cache empty, falling back to template');
          }
        }
      } else {
        // ── Filter mode: tiered pool ───────────────────────────────────────
        const { genres, eras } = getGenresAndEras();
        const soundsLike =
          mission.filter?.soundsLikeArtists ??
          mission.vibeProfile?.soundsLikeArtists ??
          [];

        // Seed "sounds like" artists immediately (Phase 1)
        for (const artist of soundsLike.slice(0, INITIAL_SEED_COUNT)) {
          if (cancelled) return;
          const batch = await searchTracksByArtist(artist, TRACKS_PER_ARTIST);
          if (cancelled) return;
          flush(batch.filter((t) => !!t.preview_url));
          markArtistsSeenGlobally([artist]);
          console.log(`[mission] Sounds-like seed: "${artist}" → ${batch.length} tracks`);
        }

        await buildFilteredPool(genres, eras, soundsLike, missionType);
        if (cancelled) return;
      }

      // ── Load initial cards from pool ──────────────────────────────────────
      if (artistPoolRef.current.length > 0) {
        const seedCount = useActivityOnly
          ? INITIAL_SEED_COUNT
          : INITIAL_SEED_COUNT - Math.min(
              (mission.filter?.soundsLikeArtists ?? mission.vibeProfile?.soundsLikeArtists ?? []).length,
              INITIAL_SEED_COUNT,
            );

        const poolEntries = pickFromPool(Math.max(seedCount, INITIAL_SEED_COUNT));
        if (poolEntries.length > 0) {
          markArtistsSeenGlobally(poolEntries.map((e) => e.artistName));
          const poolBatch = await fetchTracksForEntries(poolEntries);
          if (cancelled) return;
          flush(poolBatch.filter((t) => !!t.preview_url));
          const tiers = poolEntries.map((e) => `${e.tier}:${e.artistName}`).join(', ');
          console.log(`[mission] Initial pool [${tiers}] → ${poolBatch.length} tracks`);
        }
      }

      // ── Fallback: template seed artists ──────────────────────────────────
      if (!feedStarted && mission.fallbackSeedArtists?.length > 0) {
        const fallback = shuffle([...mission.fallbackSeedArtists]).slice(0, INITIAL_SEED_COUNT);
        for (const artist of fallback) {
          if (cancelled) return;
          const batch = await searchTracksByArtist(artist, TRACKS_PER_ARTIST);
          if (cancelled) return;
          flush(batch.filter((t) => !!t.preview_url));
          if (feedStarted) break;
        }
      }

      if (!feedStarted) setIsLoading(false);

      // ── Extra variety batch ───────────────────────────────────────────────
      if (cancelled || artistPoolRef.current.length === 0) return;
      try {
        const extraEntries = pickFromPool(BATCH_SIZE);
        if (extraEntries.length > 0) {
          markArtistsSeenGlobally(extraEntries.map((e) => e.artistName));
          const extra = await fetchTracksForEntries(extraEntries);
          if (cancelled) return;
          if (extra.length > 0) flush(extra.filter((t) => !!t.preview_url));
        }
      } catch (err) {
        console.warn('[mission] Extra batch failed:', err);
      }
    };

    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  // ── Refill when queue runs low ────────────────────────────────────────────

  useEffect(() => {
    const remaining = cards.length - currentIndex;
    if (remaining <= LOOKAHEAD_THRESHOLD && !isFetchingRef.current && !isLoading && mission) {
      void refill();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, cards.length, isLoading]);

  const refill = useCallback(async () => {
    if (!mission || isFetchingRef.current) return;
    isFetchingRef.current = true;

    const isFirstRefill = refillCountRef.current === 0;
    refillCountRef.current++;

    console.log(`[mission] Lookahead refill #${refillCountRef.current}`);

    const { genres, eras } = getGenresAndEras();

    try {
      if (isPoolLow() && genres.length > 0) {
        await refillPool(genres, eras);
      }

      const newTracks: SpotifyTrack[] = [];

      const poolEntries = pickFromPool(BATCH_SIZE);
      if (poolEntries.length > 0) {
        markArtistsSeenGlobally(poolEntries.map((e) => e.artistName));
        const batch = await fetchTracksForEntries(poolEntries);
        newTracks.push(...batch);
        const tiers = poolEntries.map((e) => `${e.tier}:${e.artistName}`).join(', ');
        console.log(`[mission] Refill [${tiers}] → ${batch.length} tracks`);
      }

      const existingQueueIds = new Set(cards.slice(currentIndex).map((t) => t.id));
      const deduped = deduplicateTracks(newTracks, existingQueueIds, seenIdsRef.current);
      const spaced = enforceArtistSpacing(shuffle(deduped), MISSION_ARTIST_SPACING);
      for (const t of spaced) seenIdsRef.current.add(t.id);

      if (spaced.length > 0) {
        console.log(`[mission] Appended ${spaced.length} tracks after index ${currentIndex}`);
        setCards((prev) => [...prev, ...spaced]);
      }

      if (isFirstRefill) {
        const hasBoosts = artistPoolRef.current.some((e) => e.score > 3.0);
        if (hasBoosts) {
          setIsTuning(true);
          setTimeout(() => setIsTuning(false), 3000);
        }
      }
    } finally {
      isFetchingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission, cards, currentIndex]);

  // ── Apply filter (from filter sheet) ─────────────────────────────────────

  const applyFilter = useCallback(async (filter: MissionFilter) => {
    if (!mission || isFetchingRef.current) return;
    isFetchingRef.current = true;

    const isEmpty =
      filter.genres.length === 0 &&
      filter.eras.length === 0 &&
      filter.soundsLikeArtists.length === 0;

    try {
      setIsTuning(true);

      // Clear and rebuild pool
      artistPoolRef.current = [];

      if (isEmpty) {
        // Revert to default activity-only mode
        missionStore.setMissionFilter(missionId, null);
        const activityTracks = await getMissionPlaylistTracks(mission.templateId, { limit: 300 });
        if (activityTracks.length > 0) {
          artistPoolRef.current = buildActivityPoolEntries(activityTracks);
          console.log(`[mission] Reverted to activity pool: ${artistPoolRef.current.length} tracks`);
        }
      } else {
        // Save filter and build tiered pool
        missionStore.setMissionFilter(missionId, filter);
        const genres = filter.genres.map((g) => g.toLowerCase());
        await buildFilteredPool(genres, filter.eras, filter.soundsLikeArtists, mission.templateId);
      }

      // Fetch initial batch from new pool
      const entries = pickFromPool(BATCH_SIZE * 2);
      if (entries.length > 0) {
        markArtistsSeenGlobally(entries.map((e) => e.artistName));
        const batch = await fetchTracksForEntries(entries);
        const existingFutureIds = new Set(cards.slice(currentIndex + 1).map((t) => t.id));
        const deduped = deduplicateTracks(
          batch.filter((t) => !!t.preview_url),
          existingFutureIds,
          seenIdsRef.current,
        );
        const spaced = enforceArtistSpacing(shuffle(deduped), MISSION_ARTIST_SPACING);
        for (const t of spaced) seenIdsRef.current.add(t.id);

        if (spaced.length > 0) {
          // Frozen head: keep current card and everything before it
          setCards((prev) => [...prev.slice(0, currentIndex + 1), ...spaced]);
          console.log(`[mission] Filter applied: ${spaced.length} new tracks after index ${currentIndex}`);
        }
      }
    } finally {
      isFetchingRef.current = false;
      setTimeout(() => setIsTuning(false), 2000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission, missionId, missionStore, cards, currentIndex]);

  // ── Swipe actions ─────────────────────────────────────────────────────────

  const handleSwipe = useCallback(
    (direction: SwipeDirection, track: SpotifyTrack) => {
      lastSwipeRef.current = { direction, track };
      setCurrentIndex((i) => i + 1);

      const artistName = track.artists[0]?.name ?? '';

      if (direction === 'right') {
        missionStore.addToLineup(missionId, track);
        saveTrack(track, {
          type: 'mission',
          slug: `mission-${missionId}`,
          name: mission?.name ?? 'Mission',
        });
        markArtistsSeenGlobally([artistName]);

        rightSwipeCountRef.current++;

        if (rightSwipeCountRef.current % 3 === 0 && !isFetchingRef.current) {
          setTimeout(() => void refill(), 100);
        }
      } else {
        missionStore.addSkipped(missionId, track.id);
      }
    },
    [missionId, mission, missionStore, saveTrack, refill],
  );

  const handleUndo = useCallback(() => {
    const last = lastSwipeRef.current;
    if (!last || currentIndex === 0) return;

    setCurrentIndex((i) => Math.max(0, i - 1));

    if (last.direction === 'right') {
      missionStore.removeFromLineup(missionId, last.track.id);
      rightSwipeCountRef.current = Math.max(0, rightSwipeCountRef.current - 1);
    }

    lastSwipeRef.current = null;
  }, [currentIndex, missionId, missionStore]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const currentCard = cards[currentIndex] ?? null;
  const nextCards = [cards[currentIndex + 1], cards[currentIndex + 2]].filter(
    Boolean,
  ) as SpotifyTrack[];
  const canUndo = currentIndex > 0 && lastSwipeRef.current !== null;
  const reviewedCount = currentIndex;
  const isExhausted = !isLoading && currentIndex >= cards.length && cards.length > 0;
  const isFilterActive = !!mission?.filter;

  return {
    cards,
    currentIndex,
    currentCard,
    nextCards,
    isLoading,
    isExhausted,
    isTuning,
    isFilterActive,
    handleSwipe,
    handleUndo,
    applyFilter,
    canUndo,
    reviewedCount,
  };
}
