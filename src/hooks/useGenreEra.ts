// ─── useGenreEra ──────────────────────────────────────────────────────────────
// Manages the Genre × Era Explorer state.
// Discovery strategy (no hardcoded artists, no MusicBrainz):
//
//   Phase 1 — Artist lookup (instant if Supabase warm):
//     Read top artists for genre × era from Supabase (populated by Last.fm
//     cache refresh). Random offset gives variety across sessions.
//     Query iTunes for tracks from those artists, filtered to era year range.
//     Display as soon as minimum threshold met (4 unique artists, 12 tracks).
//
//   Phase 2 — Search term discovery (supplementary):
//     Use era-specific iTunes search terms from Supabase (or genreConfig fallback).
//     Results appended behind current scroll position.
//
//   Cold-start fallback (Supabase cache empty):
//     Skip artist lookup, fall through to search terms from genreConfig.ts.
//     Logged so we know when it happens.
//
//   Refills use the same two-phase pattern with a shifted random offset so
//   each refill surfaces different artists from the Last.fm pool.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';

import {
  ERA_YEAR_RANGES,
  GENRE_ERA_SEEDS,
  GENRES,
  getEraSearchTerms,
  type Era,
  type Genre,
} from '@/src/data/genreConfig';
import { getArtistsForGenreEra } from '@/src/services/lastfm';
import { searchByTermInRange, searchTracksByArtistInRange } from '@/src/services/itunes';
import type { SpotifyTrack } from '@/src/services/spotify';
import {
  isArtistSeenGlobally,
  markArtistsSeenGlobally,
} from '@/src/stores/globalSessionStore';
import { enforceArtistSpacing, limitArtistTracks, spaceTracks } from '@/src/utils/feedAlgorithm';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pickRandom<T>(arr: T[], count: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, count);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface GenreEraResult {
  currentEra: Era;
  currentGenre: Genre;
  tracks: SpotifyTrack[];
  isLoading: boolean;
  /**
   * Increments each time the genre or era changes (full queue reset needed).
   * feed.tsx watches this to call setQueue vs appendToQueue.
   */
  queueVersion: number;
  /**
   * False once a refill fetch returns zero new tracks — the pool for this
   * genre × era combo is genuinely exhausted. Resets to true on combo change.
   */
  hasMore: boolean;
  /**
   * True when a refill fetch fails with a network error (non-Abort).
   * Resets to false on combo change or when clearFetchError() is called.
   */
  fetchError: boolean;
  setEra: (era: Era) => void;
  setGenre: (genre: Genre) => void;
  randomize: () => { era: Era; genre: Genre };
  loadMore: () => void;
  /** Clear fetchError so the UI can retry without changing the combo. */
  clearFetchError: () => void;
  /**
   * Restore a previously saved combo WITHOUT triggering a fetch.
   * Used when returning to the feed after navigating away.
   */
  restoreCombo: (era: Era, genre: Genre) => void;
}

export function useGenreEra(): GenreEraResult {
  const [currentEra, setCurrentEraState] = useState<Era>('90s');
  const [currentGenre, setCurrentGenreState] = useState<Genre>('Rock');
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [queueVersion, setQueueVersion] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  const comboRef = useRef<{ era: Era; genre: Genre }>({ era: '90s', genre: 'Rock' });

  // Deduplication: track keys seen in this combo session (resets on combo change)
  const seenKeysRef = useRef(new Set<string>());
  // Artist names already shown in this session (for cross-feed dedup)
  const seenArtistsRef = useRef(new Set<string>());

  // Incrementing ID so a new combo selection cancels any in-flight fetch
  const fetchRequestRef = useRef(0);

  // Rolling offset into the Supabase artist pool — increments each refill
  // so successive loads surface different artists from the Last.fm pool
  const poolOffsetRef = useRef(0);

  // ── Track dedup helper ────────────────────────────────────────────────────

  function filterFresh(raw: SpotifyTrack[]): SpotifyTrack[] {
    return raw.filter((t) => {
      if (!t.preview_url) return false;
      const key = `${t.artists[0]?.name.toLowerCase().trim()}|||${t.name.toLowerCase().trim()}`;
      if (seenKeysRef.current.has(key)) return false;
      seenKeysRef.current.add(key);
      const artistKey = t.artists[0]?.name.toLowerCase().trim() ?? '';
      seenArtistsRef.current.add(artistKey);
      markArtistsSeenGlobally([t.artists[0]?.name ?? '']);
      return true;
    });
  }

  // ── Phase 1: artist lookup from Supabase → iTunes ─────────────────────────

  async function loadArtistBatch(
    era: Era,
    genre: Genre,
    relaxedStart: number,
    relaxedEnd: number,
    requestId: number,
  ): Promise<SpotifyTrack[]> {
    const offset = poolOffsetRef.current;

    const artists = await getArtistsForGenreEra(genre.toLowerCase(), era, {
      limit: 20,
      offset,
      excludeArtists: [...seenArtistsRef.current],
    });

    if (requestId !== fetchRequestRef.current || !isFocusedRef.current) return [];

    if (artists.length === 0) {
      console.log('[discovery] Supabase cache miss for', genre, era, '— falling back to search terms');
      return [];
    }

    // Filter out globally seen artists (other feeds this session)
    const fresh = artists.filter((a) => !isArtistSeenGlobally(a.artist_name));
    if (!fresh.length) return [];

    // Pick 5 random artists from the top results (not always #1, #2, #3...)
    const selected = pickRandom(fresh.map((a) => a.artist_name), 5);
    markArtistsSeenGlobally(selected);

    const raw: SpotifyTrack[] = [];
    for (const artist of selected) {
      if (requestId !== fetchRequestRef.current || !isFocusedRef.current) return [];
      const results = await searchTracksByArtistInRange(artist, 3, relaxedStart, relaxedEnd);
      raw.push(...results);
    }

    return raw;
  }

  // ── Phase 2: search term discovery → iTunes ───────────────────────────────

  async function loadTermBatch(
    era: Era,
    genre: Genre,
    relaxedStart: number,
    relaxedEnd: number,
    requestId: number,
  ): Promise<SpotifyTrack[]> {
    // Use genreConfig search terms as the source of truth
    // (same terms are seeded into Supabase by the Edge Function)
    const allTerms = getEraSearchTerms(genre, era);
    if (!allTerms.length) return [];

    const terms = pickRandom(allTerms, 2);
    const raw: SpotifyTrack[] = [];

    for (const term of terms) {
      if (requestId !== fetchRequestRef.current || !isFocusedRef.current) return [];
      const results = await searchByTermInRange(term, 15, relaxedStart, relaxedEnd);
      raw.push(...results);
    }

    return raw;
  }

  // ── Core fetch ────────────────────────────────────────────────────────────

  const fetchTracksForCombo = useCallback(async (
    era: Era,
    genre: Genre,
    isReset: boolean,
  ) => {
    if (!isFocusedRef.current) {
      console.log('[genreEra] skipping — tab not focused');
      return;
    }

    const requestId = ++fetchRequestRef.current;
    setIsLoading(true);

    // Clear transient error on every new attempt
    setFetchError(false);

    if (isReset) {
      poolOffsetRef.current = Math.floor(Math.random() * 30);
    } else {
      // Shift offset by ~20 on each refill to surface the next slice of the pool
      poolOffsetRef.current += 20;
    }

    const { yearStart, yearEnd } = ERA_YEAR_RANGES[era];
    const relaxedStart = yearStart - 3;
    const relaxedEnd = yearEnd + 3;

    try {
      let newTracksAdded = false;

      // ── Phase 1: Supabase artists → iTunes ────────────────────────────────
      const artistRaw = await loadArtistBatch(era, genre, relaxedStart, relaxedEnd, requestId);
      if (requestId !== fetchRequestRef.current) return;

      const artistFresh = filterFresh(artistRaw);
      const artistSpaced = enforceArtistSpacing(spaceTracks(limitArtistTracks(artistFresh, 3)));

      const artistUniqueCount = new Set(artistSpaced.map((t) => t.artists[0]?.name ?? '')).size;
      const artistMeetsThreshold = artistSpaced.length >= 12 && artistUniqueCount >= 4;

      if (artistMeetsThreshold) {
        console.log('[queue] Initial display (artist batch):', artistSpaced.slice(0, 6).map((t) => t.artists[0]?.name));
        setTracks(artistSpaced);
        setIsLoading(false);
        newTracksAdded = true;
      }

      // ── Phase 2: search terms for supplementary tracks ────────────────────
      const termRaw = await loadTermBatch(era, genre, relaxedStart, relaxedEnd, requestId);
      if (requestId !== fetchRequestRef.current) return;

      const termFresh = filterFresh(termRaw);

      if (!artistMeetsThreshold) {
        // Artist batch didn't meet threshold — combine with term results
        const combined = enforceArtistSpacing(
          spaceTracks(limitArtistTracks([...artistFresh, ...termFresh], 3)),
        );
        if (combined.length > 0) {
          console.log('[queue] Combined display:', combined.slice(0, 6).map((t) => t.artists[0]?.name));
          setTracks(combined);
          newTracksAdded = true;
        } else {
          console.warn('[useGenreEra] No tracks found for', genre, era);
        }
      } else if (termFresh.length > 0) {
        // Artist batch already displayed — append term results as next batch
        const termSpaced = enforceArtistSpacing(spaceTracks(limitArtistTracks(termFresh, 3)));
        if (termSpaced.length > 0) {
          setTracks(termSpaced);
          newTracksAdded = true;
        }
      }

      // After both phases: if this was a refill and produced nothing, the pool
      // for this combo is exhausted — signal the UI to show a completion state.
      if (requestId === fetchRequestRef.current && !isReset && !newTracksAdded) {
        setHasMore(false);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // Do NOT retry
      console.warn('[useGenreEra] fetch failed:', err);
      // Surface network errors so the UI can offer a retry — but only for
      // refills (not resets, where the initial load failure is handled separately).
      if (!isReset && requestId === fetchRequestRef.current) {
        setFetchError(true);
      }
    } finally {
      if (requestId === fetchRequestRef.current) setIsLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Public API ────────────────────────────────────────────────────────────

  const setEra = useCallback((era: Era) => {
    const newCombo = { era, genre: comboRef.current.genre };
    comboRef.current = newCombo;
    seenKeysRef.current = new Set();
    seenArtistsRef.current = new Set();
    poolOffsetRef.current = 0;
    setCurrentEraState(era);
    setTracks([]);
    setHasMore(true);
    setFetchError(false);
    setQueueVersion((v) => v + 1);
    fetchTracksForCombo(era, newCombo.genre, true);
  }, [fetchTracksForCombo]);

  const setGenre = useCallback((genre: Genre) => {
    const newCombo = { era: comboRef.current.era, genre };
    comboRef.current = newCombo;
    seenKeysRef.current = new Set();
    seenArtistsRef.current = new Set();
    poolOffsetRef.current = 0;
    setCurrentGenreState(genre);
    setTracks([]);
    setHasMore(true);
    setFetchError(false);
    setQueueVersion((v) => v + 1);
    fetchTracksForCombo(newCombo.era, genre, true);
  }, [fetchTracksForCombo]);

  const randomize = useCallback((): { era: Era; genre: Genre } => {
    const genre = GENRES[Math.floor(Math.random() * GENRES.length)];
    const validEras = GENRE_ERA_SEEDS[genre].availableEras;
    const era = validEras[Math.floor(Math.random() * validEras.length)];

    const newCombo = { era, genre };
    comboRef.current = newCombo;
    seenKeysRef.current = new Set();
    seenArtistsRef.current = new Set();
    poolOffsetRef.current = 0;

    setCurrentEraState(era);
    setCurrentGenreState(genre);
    setTracks([]);
    setHasMore(true);
    setFetchError(false);
    setQueueVersion((v) => v + 1);
    fetchTracksForCombo(era, genre, true);

    return { era, genre };
  }, [fetchTracksForCombo]);

  const loadMore = useCallback(() => {
    const { era, genre } = comboRef.current;
    // Clear any prior error so the retry attempt is treated fresh
    setFetchError(false);
    fetchTracksForCombo(era, genre, false);
  }, [fetchTracksForCombo]);

  const clearFetchError = useCallback(() => setFetchError(false), []);

  const restoreCombo = useCallback((era: Era, genre: Genre) => {
    comboRef.current = { era, genre };
    setCurrentEraState(era);
    setCurrentGenreState(genre);
  }, []);

  return {
    currentEra,
    currentGenre,
    tracks,
    isLoading,
    queueVersion,
    hasMore,
    fetchError,
    setEra,
    setGenre,
    randomize,
    loadMore,
    clearFetchError,
    restoreCombo,
  };
}
