// ─── CompletionCard ───────────────────────────────────────────────────────────
// Shown as an overlay over the festival feed when all artists have been heard
// the maximum number of times. Gives the user a sense of completion and lets
// them reshuffle for a fresh rotation.

import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  artistCount: number;
  festivalName: string;
  onReshuffle: () => void;
};

export default function CompletionCard({ artistCount, festivalName, onReshuffle }: Props) {
  const handleReshuffle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onReshuffle();
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.emoji}>🎉</Text>
        <Text style={styles.title}>You've explored the full lineup!</Text>
        <Text style={styles.subtitle}>
          You heard from all {artistCount} artists at {festivalName}
        </Text>
        <Pressable style={styles.button} onPress={handleReshuffle}>
          <Text style={styles.buttonText}>Reshuffle 🔄</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,10,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    alignItems: 'center',
    gap: 16,
  },
  emoji: {
    fontSize: 52,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    marginTop: 8,
    backgroundColor: '#1DB954',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 50,
  },
  buttonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
