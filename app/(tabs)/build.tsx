// ─── Build Tab — Mission Template Selector ────────────────────────────────────

import { useRouter } from 'expo-router';
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { MISSION_TEMPLATES, type MissionTemplate } from '@/src/data/missionTemplates';
import { useMissionStore } from '@/src/stores/missionStore';

// ─── Component ────────────────────────────────────────────────────────────────

export default function BuildTab() {
  const router = useRouter();
  const createMission = useMissionStore((s) => s.createMission);

  const handleStart = (template: MissionTemplate) => {
    // Create the mission immediately and go straight to swiping.
    // Genre/era/sounds-like customization is available via the filter icon
    // on the swipe screen — no mandatory vibe gate.
    const missionId = createMission({
      templateId: template.id,
      name: template.name,
      icon: template.icon,
      excludeTags: template.excludeTags,
      fallbackSeedArtists: template.fallbackSeedArtists,
      fallbackMusicbrainzTags: template.fallbackMusicbrainzTags,
      energyTarget: template.energyTarget,
      suggestedCount: template.suggestedCount,
      vibeProfile: null,
    });
    router.push(`/mission/${missionId}`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Start a Mission</Text>
        <Text style={styles.subtitle}>
          Pick a vibe. Swipe to build your playlist.
        </Text>
      </View>

      <FlatList
        data={MISSION_TEMPLATES}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => <TemplateCard template={item} onPress={handleStart} />}
      />
    </SafeAreaView>
  );
}

// ─── Template card ────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onPress,
}: {
  template: MissionTemplate;
  onPress: (t: MissionTemplate) => void;
}) {
  const energyColor =
    template.energyTarget === 'high'
      ? '#FF6B35'
      : template.energyTarget === 'medium'
        ? '#FFBE0B'
        : '#00B4D8';

  return (
    <Pressable
      style={({ pressed }) => [styles.card, { borderLeftColor: energyColor }, pressed && styles.cardPressed]}
      onPress={() => onPress(template)}>
      <Text style={styles.icon}>{template.icon}</Text>
      <View style={styles.cardBody}>
        <Text style={styles.cardName}>{template.name}</Text>
        <Text style={styles.cardDesc}>{template.description}</Text>
      </View>
      <Text style={[styles.energyTag, { color: energyColor }]}>
        {template.energyTarget.toUpperCase()} · {template.suggestedCount}
      </Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },

  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 4,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
  },

  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10,
    paddingTop: 12,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderLeftWidth: 3,
  },
  cardPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.98 }],
  },

  icon: {
    fontSize: 28,
    width: 40,
    textAlign: 'center',
  },

  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cardDesc: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
  },
  energyTag: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'SpaceMono',
    letterSpacing: 0.5,
  },
});
