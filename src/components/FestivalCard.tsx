import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import type { Festival } from '@/src/data/festivals';
import { formatFestivalDates } from '@/src/utils/formatters';

type Props = {
  festival: Festival;
  isPast?: boolean;
};

export default function FestivalCard({ festival, isPast = false }: Props) {
  const router = useRouter();

  const dateLabel =
    festival.startDate && festival.endDate
      ? formatFestivalDates(festival.startDate, festival.endDate)
      : festival.dates;

  return (
    <Pressable
      onPress={() => router.push(`/festival/${festival.slug}`)}
      style={({ pressed }) => [
        styles.card,
        pressed && styles.cardPressed,
        isPast && styles.cardPast,
      ]}
    >
      {/* Poster image or gradient fallback */}
      {festival.posterUrl ? (
        <Image
          source={{ uri: festival.posterUrl }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />
      ) : (
        <LinearGradient
          colors={[festival.imageColors.primary, festival.imageColors.secondary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      )}

      {/* Dark gradient overlay at bottom for text readability */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.82)']}
        start={{ x: 0, y: 0.45 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* PAST badge — top right */}
      {isPast && (
        <View style={styles.pastBadge}>
          <Text style={styles.pastBadgeText}>PAST</Text>
        </View>
      )}

      {/* Text content anchored to bottom */}
      <View style={styles.content}>
        <Text style={styles.name} numberOfLines={2}>
          {festival.name}
        </Text>

        {dateLabel ? (
          <Text style={styles.date} numberOfLines={1}>
            {dateLabel}
          </Text>
        ) : null}

        {festival.location ? (
          <Text style={styles.location} numberOfLines={1}>
            {festival.location}
          </Text>
        ) : null}

        <View style={styles.footer}>
          <View style={styles.genrePills}>
            {festival.genres.slice(0, 3).map((g) => (
              <View key={g} style={styles.genrePill}>
                <Text style={styles.genrePillText}>{g}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.artistCount}>
            {festival.artists.length} artists ›
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    width: '100%',
    aspectRatio: 0.72,   // portrait poster proportions (~3:4)
    backgroundColor: '#1A1A1A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  cardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  cardPast: {
    opacity: 0.6,
  },

  pastBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pastBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'SpaceMono',
    letterSpacing: 0.8,
  },

  content: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    gap: 5,
  },
  name: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  date: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  location: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  genrePills: {
    flexDirection: 'row',
    gap: 6,
    flexShrink: 1,
  },
  genrePill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  genrePillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  artistCount: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
    flexShrink: 0,
  },
});
