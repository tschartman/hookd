import { useCallback, useState } from 'react';

import { getService, type ServiceId } from '@/src/services/exportService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExportStep = 'idle' | 'picking' | 'matching' | 'creating' | 'success' | 'error';

export type ExportResult = {
  playlistUrl: string;
  matchedCount: number;
  totalCount: number;
};

export type ExportTrack = {
  trackName: string;
  artistName: string;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useExport() {
  const [step, setStep] = useState<ExportStep>('idle');
  const [matchedCount, setMatchedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeServiceId, setActiveServiceId] = useState<ServiceId | null>(null);

  const exportTo = useCallback(
    async (
      serviceId: ServiceId,
      tracks: ExportTrack[],
      playlistName: string,
      playlistDescription?: string,
    ): Promise<ExportResult | null> => {
      const service = getService(serviceId);

      // ── Step 1: match each track to a service-specific ID ─────────────────
      setStep('matching');
      setActiveServiceId(serviceId);
      setMatchedCount(0);
      setTotalCount(tracks.length);
      setPlaylistUrl(null);
      setError(null);

      const matchedIds: string[] = [];

      for (let i = 0; i < tracks.length; i++) {
        const { trackName, artistName } = tracks[i];
        try {
          const id = await service.matchTrack(trackName, artistName);
          if (id) matchedIds.push(id);
        } catch {
          // Network blip or no match — skip this track
        }
        setMatchedCount(i + 1);
        // 100 ms gap between requests respects API rate limits
        if (i < tracks.length - 1) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      // ── Step 2: create playlist with matched IDs ──────────────────────────
      setStep('creating');

      try {
        const url = await service.createPlaylist(
          playlistName,
          playlistDescription ?? '',
          matchedIds,
        );
        setPlaylistUrl(url);
        setStep('success');
        return { playlistUrl: url, matchedCount: matchedIds.length, totalCount: tracks.length };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Export failed. Please try again.';
        setError(msg);
        setStep('error');
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setStep('idle');
    setMatchedCount(0);
    setTotalCount(0);
    setPlaylistUrl(null);
    setError(null);
    setActiveServiceId(null);
  }, []);

  return {
    step,
    matchedCount,
    totalCount,
    playlistUrl,
    error,
    activeServiceId,
    exportTo,
    reset,
  };
}
