import { create } from 'zustand';
import type { SpotifyTrack } from '@/src/services/spotify';

// ─── Feed Context ─────────────────────────────────────────────────────────────

export type FeedContext =
  | { type: 'genreEra' }
  | { type: 'festival'; slug: string }
  | { type: 'mission'; id: string }
  | { type: 'artist'; id: string };

export function contextKey(ctx: FeedContext): string {
  if (ctx.type === 'festival') return `festival:${ctx.slug}`;
  if (ctx.type === 'mission') return `mission:${ctx.id}`;
  if (ctx.type === 'artist') return `artist:${ctx.id}`;
  return 'genreEra';
}

type SavedQueue = { queue: SpotifyTrack[]; queueIndex: number; meta?: Record<string, string>; wasPlaying?: boolean };

// ─── State ────────────────────────────────────────────────────────────────────

type PlayerState = {
  currentTrack: SpotifyTrack | null;
  isPlaying: boolean;
  /** Playback position as a 0–1 fraction of the track duration. */
  progress: number;
  queue: SpotifyTrack[];
  queueIndex: number;
  /**
   * True when nextTrack() was called but the queue had no more items.
   * appendToQueue() uses this to auto-advance once new tracks arrive.
   */
  queueExhausted: boolean;
  /** Which feed currently owns the player. */
  feedContext: FeedContext;
  /** Per-context queue snapshots, keyed by contextKey(). */
  savedQueues: Record<string, SavedQueue>;
};

// ─── Actions ──────────────────────────────────────────────────────────────────

type PlayerActions = {
  /**
   * Switch the active feed context.
   * Stops audio, saves the outgoing queue, restores the saved queue for the
   * incoming context (or starts with an empty queue on first visit).
   * No-ops if the context is already active.
   */
  setFeedContext: (context: FeedContext) => void;

  /**
   * Replace the queue. Optionally jump to startIndex (default 0).
   * Pass autoPlay=false to restore a queue without starting playback.
   * Filters tracks with null preview_url before storing.
   * If `context` is supplied and does not match the current feedContext, no-ops.
   */
  setQueue: (tracks: SpotifyTrack[], startIndex?: number, autoPlay?: boolean, context?: FeedContext) => void;

  /**
   * Jump to a specific track by its position in the queue.
   * Called by the hook after audio is ready.
   */
  playTrack: (index: number) => void;

  /** Move to the next track. Returns the new track, or null if at end. */
  nextTrack: () => SpotifyTrack | null;

  /** Move to the previous track. Returns the new track, or null if at start. */
  prevTrack: () => SpotifyTrack | null;

  /** Toggle isPlaying — the hook reacts to this to call pause/resume. */
  togglePlay: () => void;

  /**
   * Append tracks to the end of the queue without disturbing current playback.
   * Filters null preview_url tracks before appending.
   * If `context` is supplied and does not match the current feedContext, no-ops.
   */
  appendToQueue: (tracks: SpotifyTrack[], context?: FeedContext) => void;

  /**
   * Replace everything after the current track with a new list.
   * Does not touch the current track, index, progress, or isPlaying.
   */
  replaceUpcoming: (tracks: SpotifyTrack[]) => void;

  /**
   * Splice tracks into the queue at a specific position.
   * Everything at and after `index` shifts right. Does not affect current playback.
   */
  injectAtPosition: (index: number, tracks: SpotifyTrack[]) => void;

  // ── Internal setters used by useAudioPlayer ──────────────────────────────
  _setIsPlaying: (v: boolean) => void;
  _setProgress: (v: number) => void;
  /** Replace a track in the queue (used when refetching an expired preview_url). */
  _replaceTrack: (index: number, track: SpotifyTrack) => void;

  /**
   * Replace the queue and index without touching isPlaying, progress, or
   * currentTrack — safe to call mid-playback.
   *
   * If the currently playing track exists in newQueue it is kept at its new
   * position. If it has been dropped (e.g. by limitArtistTracks) it is
   * re-inserted at newIndex so the audio engine never sees a track-id change.
   */
  _replaceQueueSilent: (newQueue: SpotifyTrack[], newIndex: number) => void;

  /**
   * Attach arbitrary metadata to a saved queue snapshot (e.g. era/genre for
   * the genreEra feed). No-ops if no snapshot exists for the context yet.
   */
  setSavedQueueMeta: (context: FeedContext, meta: Record<string, string>) => void;

  /**
   * Seek to a fractional position (0–1). Registered by useAudioPlayer;
   * WaveformViz and other components call this directly from the store.
   */
  seekTo: (fraction: number) => void;
  /** Called by useAudioPlayer to register its seek implementation. */
  _registerSeekHandler: (fn: (fraction: number) => void) => void;
  /** True while audio is being loaded/buffered for the current track. */
  isLoadingAudio: boolean;
  _setLoadingAudio: (v: boolean) => void;
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const usePlayerStore = create<PlayerState & PlayerActions>((set, get) => ({
  currentTrack: null,
  isPlaying: false,
  progress: 0,
  queue: [],
  queueIndex: -1,
  queueExhausted: false,
  feedContext: { type: 'genreEra' },
  savedQueues: {},

  setFeedContext: (context) => {
    const { feedContext, queue, queueIndex, isPlaying, savedQueues } = get();
    const outKey = contextKey(feedContext);
    const inKey  = contextKey(context);
    if (outKey === inKey) return; // already active

    // Persist the outgoing queue, including whether it was playing.
    // This lets feeds resume where they left off when you return to them.
    const nextSaved: Record<string, SavedQueue> = {
      ...savedQueues,
      [outKey]: { queue, queueIndex, wasPlaying: isPlaying },
    };

    // Restore the incoming queue (empty on first visit)
    const incoming = nextSaved[inKey];
    const newQueue = incoming?.queue ?? [];
    const newIndex = incoming ? incoming.queueIndex : -1;

    set({
      feedContext: context,
      savedQueues: nextSaved,
      // Resume playback if this feed was previously playing; start paused on first visit.
      isPlaying: incoming?.wasPlaying ?? false,
      queue: newQueue,
      queueIndex: newIndex,
      currentTrack: newQueue[newIndex] ?? null,
      progress: 0,
      queueExhausted: false,
    });
  },

  setQueue: (tracks, startIndex = 0, autoPlay = true, context?) => {
    if (context && contextKey(context) !== contextKey(get().feedContext)) return;
    const filtered = tracks.filter((t) => !!t.preview_url);
    const clamped = Math.min(startIndex, Math.max(0, filtered.length - 1));
    set({
      queue: filtered,
      queueIndex: clamped,
      currentTrack: filtered[clamped] ?? null,
      progress: 0,
      isPlaying: autoPlay && filtered.length > 0,
    });
  },

  playTrack: (index) => {
    const { queue } = get();
    const track = queue[index];
    if (!track) return;
    // Do NOT touch isPlaying here — owned by setQueue/togglePlay/_setIsPlaying.
    set({ currentTrack: track, queueIndex: index, progress: 0 });
  },

  nextTrack: () => {
    const { queue, queueIndex } = get();
    const nextIndex = queueIndex + 1;
    if (nextIndex >= queue.length) {
      set({ queueExhausted: true });
      return null;
    }
    const track = queue[nextIndex];
    set({ queueIndex: nextIndex, currentTrack: track, progress: 0, queueExhausted: false });
    return track;
  },

  prevTrack: () => {
    const { queue, queueIndex } = get();
    const prevIndex = queueIndex - 1;
    if (prevIndex < 0) return null;
    const track = queue[prevIndex];
    set({ queueIndex: prevIndex, currentTrack: track, progress: 0 });
    return track;
  },

  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),

  appendToQueue: (tracks, context?) => {
    if (context && contextKey(context) !== contextKey(get().feedContext)) return;
    const filtered = tracks.filter((t) => !!t.preview_url);
    if (!filtered.length) return;
    const wasExhausted = get().queueExhausted;
    set((s) => ({ queue: [...s.queue, ...filtered] }));
    if (wasExhausted) {
      get().nextTrack();
    }
  },

  replaceUpcoming: (tracks) => {
    const filtered = tracks.filter((t) => !!t.preview_url);
    set((s) => ({
      queue: [...s.queue.slice(0, s.queueIndex + 1), ...filtered],
      queueExhausted: false,
    }));
  },

  injectAtPosition: (index, tracks) => {
    const filtered = tracks.filter((t) => !!t.preview_url);
    if (!filtered.length) return;
    set((s) => {
      const q = [...s.queue];
      q.splice(index, 0, ...filtered);
      return { queue: q };
    });
  },

  _setIsPlaying: (v) => set({ isPlaying: v }),
  _setProgress: (v) => set({ progress: v }),
  seekTo: () => {},
  _registerSeekHandler: (fn) => set({ seekTo: fn }),
  isLoadingAudio: false,
  _setLoadingAudio: (v) => set({ isLoadingAudio: v }),

  _replaceTrack: (index, track) =>
    set((s) => {
      const queue = [...s.queue];
      queue[index] = track;
      return {
        queue,
        currentTrack: s.queueIndex === index ? track : s.currentTrack,
      };
    }),

  setSavedQueueMeta: (context, meta) => {
    const key = contextKey(context);
    set((s) => {
      const existing = s.savedQueues[key];
      if (!existing) return {};
      return { savedQueues: { ...s.savedQueues, [key]: { ...existing, meta } } };
    });
  },

  _replaceQueueSilent: (newQueue, newIndex) => {
    const current = get().currentTrack;
    if (!current) {
      const idx = Math.max(0, Math.min(newIndex, newQueue.length - 1));
      set({ queue: newQueue, queueIndex: idx, currentTrack: newQueue[idx] ?? null });
      return;
    }

    const found = newQueue.findIndex((t) => t.id === current.id);
    if (found !== -1) {
      // Track is present — update position without touching currentTrack (same id)
      set({ queue: newQueue, queueIndex: found });
    } else {
      // Track was dropped by limitArtistTracks or genre filter — re-insert it so
      // the audio engine never sees a currentTrackId change.
      const insertAt = Math.max(0, Math.min(newIndex, newQueue.length));
      const spliced = [
        ...newQueue.slice(0, insertAt),
        current,
        ...newQueue.slice(insertAt),
      ];
      set({ queue: spliced, queueIndex: insertAt });
    }
  },
}));
