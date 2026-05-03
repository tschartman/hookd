import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getConnectedServices, type ServiceId, type StreamingService } from '@/src/services/exportService';
import { useExport, type ExportTrack } from '@/src/hooks/useExport';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  tracks: ExportTrack[];
  playlistName: string;
  playlistDescription?: string;
  onDismiss: () => void;
  onSuccess?: (playlistUrl: string) => void;
};

// ─── Sub-screens ──────────────────────────────────────────────────────────────

function PickerStep({
  services,
  onPick,
}: {
  services: StreamingService[];
  onPick: (id: ServiceId) => void;
}) {
  return (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Export to…</Text>
      <Text style={styles.stepHint}>Choose where to send your playlist</Text>
      <View style={styles.pickerList}>
        {services.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onPick(s.id);
            }}
            style={({ pressed }) => [styles.pickerBtn, pressed && { opacity: 0.75 }]}
          >
            <View style={[styles.pickerDot, { backgroundColor: s.color }]} />
            <Text style={styles.pickerBtnText}>{s.name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function NoServicesStep() {
  return (
    <View style={styles.stepContent}>
      <View style={styles.errorIconWrap}>
        <Text style={styles.errorIconText}>⚡</Text>
      </View>
      <Text style={styles.stepTitle}>Connect a service first</Text>
      <Text style={styles.errorMsg}>
        Go to the Library tab and connect Spotify, Apple Music, or YouTube Music to export playlists.
      </Text>
    </View>
  );
}

function MatchingStep({
  current,
  total,
  serviceName,
}: {
  current: number;
  total: number;
  serviceName: string;
}) {
  const pct = total > 0 ? current / total : 0;
  return (
    <View style={styles.stepContent}>
      <ActivityIndicator size="large" color={C.green} />
      <Text style={styles.stepTitle}>Matching songs…</Text>
      <Text style={styles.stepProgress}>
        {current}/{total}
      </Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
      <Text style={styles.stepHint}>Finding {serviceName} versions of your saved tracks</Text>
    </View>
  );
}

function CreatingStep({ serviceName }: { serviceName: string }) {
  return (
    <View style={styles.stepContent}>
      <ActivityIndicator size="large" color={C.green} />
      <Text style={[styles.stepTitle, { marginTop: 16 }]}>
        Creating your {serviceName} playlist…
      </Text>
    </View>
  );
}

function SuccessStep({
  playlistName,
  matchedCount,
  totalCount,
  serviceName,
  onOpen,
  onDone,
}: {
  playlistName: string;
  matchedCount: number;
  totalCount: number;
  serviceName: string;
  onOpen: () => void;
  onDone: () => void;
}) {
  const lowMatch = totalCount > 0 && matchedCount < totalCount * 0.5;

  return (
    <View style={styles.stepContent}>
      <View style={styles.successIconWrap}>
        <Text style={styles.successIconText}>✓</Text>
      </View>
      <Text style={styles.stepTitle} numberOfLines={2}>
        {playlistName}
      </Text>
      <Text style={[styles.stepProgress, lowMatch && styles.textWarning]}>
        {matchedCount} of {totalCount} tracks synced
      </Text>
      {lowMatch && (
        <Text style={styles.warningNote}>
          Some tracks weren't on {serviceName}, but your playlist was still created.
        </Text>
      )}
      <View style={styles.buttonRow}>
        <Pressable
          onPress={onOpen}
          style={({ pressed }) => [styles.openBtn, pressed && { opacity: 0.82 }]}
        >
          <Text style={styles.openBtnText}>Open in {serviceName}</Text>
        </Pressable>
        <Pressable
          onPress={onDone}
          style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.doneBtnText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ErrorStep({
  error,
  isAuth,
  onRetry,
  onDismiss,
}: {
  error: string;
  isAuth: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.stepContent}>
      <View style={styles.errorIconWrap}>
        <Text style={styles.errorIconText}>✕</Text>
      </View>
      <Text style={styles.stepTitle}>Export failed</Text>
      <Text style={styles.errorMsg}>
        {isAuth
          ? 'HOOKD needs permission to create playlists. Disconnect and reconnect the service from the Library tab.'
          : error}
      </Text>
      <View style={styles.buttonRow}>
        {!isAuth && (
          <Pressable
            onPress={onRetry}
            style={({ pressed }) => [styles.openBtn, pressed && { opacity: 0.82 }]}
          >
            <Text style={styles.openBtnText}>Retry</Text>
          </Pressable>
        )}
        <Pressable
          onPress={onDismiss}
          style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.doneBtnText}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExportFlow({
  visible,
  tracks,
  playlistName,
  playlistDescription,
  onDismiss,
  onSuccess,
}: Props) {
  const { step, matchedCount, totalCount, playlistUrl, error, activeServiceId, exportTo, reset } =
    useExport();

  // The service the user selected (or was auto-selected)
  const [resolvedServiceId, setResolvedServiceId] = useState<ServiceId | null>(null);
  const [connectedServices, setConnectedServices] = useState<StreamingService[]>([]);

  const argsRef = useRef({ tracks, playlistName, playlistDescription, onSuccess });
  argsRef.current = { tracks, playlistName, playlistDescription, onSuccess };

  const startedRef = useRef(false);

  // When the sheet opens, decide whether to show a picker or auto-start
  useEffect(() => {
    if (!visible) {
      startedRef.current = false;
      setResolvedServiceId(null);
      setConnectedServices([]);
      reset();
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    const connected = getConnectedServices();
    setConnectedServices(connected);

    if (connected.length === 1) {
      // Single service — skip the picker and start immediately
      runExport(connected[0].id);
    }
    // 0 or 2+: render will show NoServicesStep or PickerStep
  }, [visible]);

  function runExport(serviceId: ServiceId) {
    setResolvedServiceId(serviceId);
    const { tracks: t, playlistName: n, playlistDescription: d, onSuccess: cb } = argsRef.current;
    exportTo(serviceId, t, n, d).then((result) => {
      if (result) cb?.(result.playlistUrl);
    });
  }

  const handleDismiss = () => {
    reset();
    setResolvedServiceId(null);
    onDismiss();
  };

  const handleRetry = () => {
    if (resolvedServiceId) runExport(resolvedServiceId);
  };

  const handleOpenPlaylist = () => {
    if (playlistUrl) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Linking.openURL(playlistUrl).catch(() => {});
    }
  };

  const canDismissOnBackdrop =
    connectedServices.length === 0 ||
    connectedServices.length > 1 && step === 'idle' ||
    step === 'success' ||
    step === 'error';

  const isAuth =
    !!error &&
    (error.toLowerCase().includes('authenticated') ||
      error.toLowerCase().includes('not connected') ||
      error.toLowerCase().includes('refresh') ||
      error.includes('401') ||
      error.includes('403'));

  // Derive display name for the active service (during / after export)
  const displayServiceId = activeServiceId ?? resolvedServiceId;
  const activeService = displayServiceId
    ? connectedServices.find((s) => s.id === displayServiceId) ??
      { id: displayServiceId, name: displayServiceId === 'spotify' ? 'Spotify'
        : displayServiceId === 'apple_music' ? 'Apple Music'
        : 'YouTube Music', color: '#fff' }
    : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleDismiss}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={canDismissOnBackdrop ? handleDismiss : undefined}
        />

        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* No services connected */}
          {connectedServices.length === 0 && <NoServicesStep />}

          {/* Service picker (2+ services connected and not yet chosen) */}
          {connectedServices.length > 1 && step === 'idle' && (
            <PickerStep services={connectedServices} onPick={runExport} />
          )}

          {/* Export in progress / done */}
          {(step === 'matching') && (
            <MatchingStep
              current={matchedCount}
              total={totalCount}
              serviceName={activeService?.name ?? ''}
            />
          )}

          {step === 'creating' && <CreatingStep serviceName={activeService?.name ?? ''} />}

          {step === 'success' && (
            <SuccessStep
              playlistName={playlistName}
              matchedCount={matchedCount}
              totalCount={totalCount}
              serviceName={activeService?.name ?? ''}
              onOpen={handleOpenPlaylist}
              onDone={handleDismiss}
            />
          )}

          {step === 'error' && (
            <ErrorStep
              error={error ?? 'Something went wrong.'}
              isAuth={isAuth}
              onRetry={handleRetry}
              onDismiss={handleDismiss}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg: '#0A0A0A',
  surface: '#161616',
  border: 'rgba(255,255,255,0.08)',
  green: '#1DB954',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.45)',
  warning: '#F5A623',
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  stepContent: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 12,
    minHeight: 200,
    justifyContent: 'center',
  },
  stepTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  stepProgress: {
    color: C.green,
    fontSize: 22,
    fontWeight: '800',
    fontFamily: 'SpaceMono',
  },
  progressTrack: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: C.green,
    borderRadius: 2,
  },
  stepHint: {
    color: C.muted,
    fontSize: 13,
    textAlign: 'center',
  },
  // Service picker
  pickerList: {
    width: '100%',
    gap: 10,
    marginTop: 8,
  },
  pickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  pickerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pickerBtnText: {
    color: C.text,
    fontSize: 16,
    fontWeight: '600',
  },
  // Success
  successIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(29,185,84,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  successIconText: {
    color: C.green,
    fontSize: 26,
    fontWeight: '700',
  },
  // Error / no-services
  errorIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,77,77,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  errorIconText: {
    color: '#FF4D4D',
    fontSize: 22,
    fontWeight: '700',
  },
  textWarning: {
    color: C.warning,
  },
  warningNote: {
    color: C.muted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorMsg: {
    color: C.muted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  buttonRow: {
    width: '100%',
    gap: 10,
    marginTop: 8,
  },
  openBtn: {
    backgroundColor: C.green,
    borderRadius: 28,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  doneBtn: {
    borderRadius: 28,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  doneBtnText: {
    color: C.muted,
    fontSize: 15,
    fontWeight: '600',
  },
});
