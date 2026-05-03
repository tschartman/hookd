import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import ExportFlow from '@/src/components/ExportFlow';
import type { Collection } from '@/src/stores/collectionStore';
import { useCollectionStore } from '@/src/stores/collectionStore';
import { formatRelativeTime } from '@/src/utils/formatters';

// ─── Mosaic cover ─────────────────────────────────────────────────────────────
// 2x2 grid of first 4 album art URLs. Missing cells are filled with a dark
// placeholder so the grid always looks complete.

const MOSAIC_SIZE = 80;
const CELL_GAP = 2;
const CELL_SIZE = (MOSAIC_SIZE - CELL_GAP) / 2;

function MosaicCover({ arts }: { arts: string[] }) {
  const cells = [arts[0], arts[1], arts[2], arts[3]];

  return (
    <View style={styles.mosaic}>
      {/* Row 1 */}
      <View style={styles.mosaicRow}>
        {cells.slice(0, 2).map((url, i) =>
          url ? (
            <Image key={i} source={{ uri: url }} style={styles.mosaicCell} />
          ) : (
            <View key={i} style={[styles.mosaicCell, styles.mosaicPlaceholder]} />
          ),
        )}
      </View>
      {/* Row 2 */}
      <View style={styles.mosaicRow}>
        {cells.slice(2, 4).map((url, i) =>
          url ? (
            <Image key={i + 2} source={{ uri: url }} style={styles.mosaicCell} />
          ) : (
            <View key={i + 2} style={[styles.mosaicCell, styles.mosaicPlaceholder]} />
          ),
        )}
      </View>
    </View>
  );
}

// ─── CollectionCard ───────────────────────────────────────────────────────────

type Props = { collection: Collection };

export default function CollectionCard({ collection }: Props) {
  const router = useRouter();
  const { slug, name, type, trackCount, lastSavedAt, coverArt, exportedPlaylistUrl } =
    collection;

  const setExportedPlaylistUrl = useCollectionStore((s) => s.setExportedPlaylistUrl);
  const [exportVisible, setExportVisible] = useState(false);

  const typeIcon = type === 'festival' ? '🏕️' : '🎵';

  const handlePress = () => {
    router.push(`/collection/${slug}`);
  };

  const handleExport = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setExportVisible(true);
  };

  return (
    <>
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {/* Mosaic */}
      <MosaicCover arts={coverArt} />

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.meta}>
          {trackCount} {trackCount === 1 ? 'track' : 'tracks'}
        </Text>
        <Text style={styles.lastAdded}>Last added {formatRelativeTime(lastSavedAt)}</Text>

        <View style={styles.badgeRow}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>
              {typeIcon} {type === 'festival' ? 'Festival' : 'Main Feed'}
            </Text>
          </View>
        </View>
      </View>

      {/* Export button */}
      <Pressable
        onPress={handleExport}
        style={({ pressed }) => [styles.exportBtn, pressed && { opacity: 0.7 }]}
        hitSlop={8}
      >
        {exportedPlaylistUrl ? (
          <Text style={styles.exportedText}>Exported ✓</Text>
        ) : (
          <Text style={styles.exportText}>Export →</Text>
        )}
      </Pressable>
    </Pressable>

    <ExportFlow
      visible={exportVisible}
      tracks={collection.tracks.map((t) => ({
        trackName: t.trackName,
        artistName: t.artistName,
      }))}
      playlistName={`HOOKD — ${name}`}
      onDismiss={() => setExportVisible(false)}
      onSuccess={(url) => setExportedPlaylistUrl(slug, url)}
    />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardPressed: {
    opacity: 0.82,
  },

  // Mosaic
  mosaic: {
    width: MOSAIC_SIZE,
    height: MOSAIC_SIZE,
    borderRadius: 10,
    overflow: 'hidden',
    gap: CELL_GAP,
    flexShrink: 0,
  },
  mosaicRow: {
    flexDirection: 'row',
    gap: CELL_GAP,
  },
  mosaicCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
  },
  mosaicPlaceholder: {
    backgroundColor: '#262626',
  },

  // Info
  info: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  name: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  meta: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
  },
  lastAdded: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    fontFamily: 'SpaceMono',
  },
  badgeRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  typeBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  typeBadgeText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '600',
  },

  // Export
  exportBtn: {
    flexShrink: 0,
    alignSelf: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(29,185,84,0.4)',
  },
  exportText: {
    color: '#1DB954',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'SpaceMono',
  },
  exportedText: {
    color: 'rgba(29,185,84,0.55)',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'SpaceMono',
  },
});
