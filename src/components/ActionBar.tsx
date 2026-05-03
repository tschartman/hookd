import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

// ─── Icons (inline SVG paths via react-native-svg would be ideal, but we use
//     simple Unicode emoji-free text labels as a placeholder until Lucide RN
//     is wired up. Replace the inner <Text> with <LucideIcon> as needed.) ─────

import { Text } from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  isSaved: boolean;
  onSave: () => void;
  onExpand: () => void;
  onAddToPlaylist?: () => void;
  trackUrl?: string;
  accentColor: string;
};

// ─── Heart button ─────────────────────────────────────────────────────────────

const HeartButton = ({
  isSaved,
  onSave,
  accentColor,
}: {
  isSaved: boolean;
  onSave: () => void;
  accentColor: string;
}) => {
  const scale = useSharedValue(1);

  const handlePress = useCallback(() => {
    scale.value = withSequence(
      withSpring(1.45, { damping: 6, stiffness: 300 }),
      withSpring(1, { damping: 10, stiffness: 200 }),
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave();
  }, [onSave]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable onPress={handlePress} hitSlop={8}>
      <Animated.View
        style={[
          styles.heartButton,
          isSaved
            ? { backgroundColor: accentColor + '40', borderColor: accentColor }
            : { borderColor: 'rgba(255,255,255,0.35)' },
          animatedStyle,
        ]}
      >
        <Text style={[styles.heartIcon, isSaved && { color: accentColor }]}>
          {isSaved ? '♥' : '♡'}
        </Text>
      </Animated.View>
    </Pressable>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

const ActionBar = ({
  isSaved,
  onSave,
  onExpand,
  onAddToPlaylist,
  trackUrl,
  accentColor,
}: Props) => {
  const handleShare = useCallback(async () => {
    if (!trackUrl) return;
    try {
      await Share.share({ url: trackUrl, message: trackUrl });
    } catch {
      // User dismissed
    }
  }, [trackUrl]);

  const handleExpandPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onExpand();
  }, [onExpand]);

  return (
    <View style={styles.container}>
      <View style={styles.group}>
        <HeartButton isSaved={isSaved} onSave={onSave} accentColor={accentColor} />
        <ActionButton icon="⊕" label="Add" onPress={onAddToPlaylist ?? (() => {})} />
      </View>
      <View style={styles.group}>
        <ActionButton icon="↗" label="Deep Dive" onPress={handleExpandPress} />
        <ActionButton icon="⤴" label="Share" onPress={handleShare} />
      </View>
    </View>
  );
};

// ─── Generic action button ────────────────────────────────────────────────────

const ActionButton = ({
  icon,
  label: _label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) => (
  <Pressable onPress={onPress} hitSlop={8}>
    <View style={styles.button}>
      <Text style={styles.icon}>{icon}</Text>
    </View>
  </Pressable>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  // Heart — primary, larger, bordered
  heartButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartIcon: {
    color: '#FFFFFF',
    fontSize: 22,
  },
  // Secondary action buttons
  button: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    color: '#FFFFFF',
    fontSize: 17,
  },
});

export default ActionBar;
