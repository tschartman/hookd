import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import FestivalCard from '@/src/components/FestivalCard';
import { useFestivals } from '@/src/hooks/useFestivalData';

// ─── Filter/sort config ───────────────────────────────────────────────────────

const GENRE_FILTERS = [
  'Rock',
  'Pop',
  'Hip-Hop',
  'Electronic',
  'Country',
  'Indie',
  'R&B',
  'Latin',
];

type SortMode = 'popular' | 'upcoming';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();

  const { festivals: allFestivals, isLoading } = useFestivals();

  const [search, setSearch]           = useState('');
  const [selectedGenres, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort]               = useState<SortMode>('popular');
  const [showPast, setShowPast]       = useState(false);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const handleSearchChange = useCallback((text: string) => {
    setSearch(text);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(text), 200);
  }, []);

  const toggleGenre = useCallback((genre: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(genre)) {
        next.delete(genre);
      } else {
        next.add(genre);
      }
      return next;
    });
  }, []);

  const clearGenres = useCallback(() => setSelected(new Set()), []);

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  const isPastFestival = useCallback(
    (f: { endDate?: string; dates: string }) =>
      f.endDate ? f.endDate < today : false,
    [today],
  );

  const filtered = useMemo(() => {
    let list = [...allFestivals];

    // Hide past festivals unless the toggle is on
    if (!showPast) {
      list = list.filter((f) => !isPastFestival(f));
    }

    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.location.toLowerCase().includes(q),
      );
    }

    if (selectedGenres.size > 0) {
      list = list.filter((f) => f.genres.some((g) => selectedGenres.has(g)));
    }

    if (sort === 'popular') {
      list.sort((a, b) => {
        // When showing past, upcoming always comes first
        if (showPast) {
          const aPast = isPastFestival(a) ? 1 : 0;
          const bPast = isPastFestival(b) ? 1 : 0;
          if (aPast !== bPast) return aPast - bPast;
        }
        return b.estimatedAttendance - a.estimatedAttendance;
      });
    } else {
      list.sort((a, b) => {
        // When showing past, upcoming always comes first
        if (showPast) {
          const aPast = isPastFestival(a) ? 1 : 0;
          const bPast = isPastFestival(b) ? 1 : 0;
          if (aPast !== bPast) return aPast - bPast;
        }
        // Sort by start_date if available, otherwise fall back to string parsing
        if (a.startDate && b.startDate) {
          return a.startDate.localeCompare(b.startDate);
        }
        const monthOrder: Record<string, number> = {
          january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
          july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
        };
        const getMonthNum = (dates: string) => {
          const lower = dates.toLowerCase();
          for (const [name, num] of Object.entries(monthOrder)) {
            if (lower.includes(name)) return num;
          }
          return 13;
        };
        return getMonthNum(a.dates) - getMonthNum(b.dates);
      });
    }

    return list;
  }, [allFestivals, debouncedSearch, selectedGenres, sort, showPast, isPastFestival]);

  // ── Scrollable list header (title + search — scrolls away) ────────────────
  const ListHeader = (
    <View style={styles.listHeader}>
      <Text style={styles.headerTitle}>Explore Festivals</Text>
      <Text style={styles.headerSub}>Discover your next lineup</Text>

      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search festivals..."
          placeholderTextColor="rgba(255,255,255,0.3)"
          value={search}
          onChangeText={handleSearchChange}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#1DB954" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* ── Sticky top bar: filter chips + sort (always visible) ──────── */}
      <View style={styles.stickyBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterBar}
          style={styles.filterScroll}
        >
          <Pressable
            onPress={clearGenres}
            style={[styles.chip, selectedGenres.size === 0 && styles.chipActive]}
          >
            <Text style={[styles.chipText, selectedGenres.size === 0 && styles.chipTextActive]}>
              All
            </Text>
          </Pressable>
          {GENRE_FILTERS.map((genre) => {
            const active = selectedGenres.has(genre);
            return (
              <Pressable
                key={genre}
                onPress={() => toggleGenre(genre)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {genre}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setShowPast((prev) => !prev)}
            style={[styles.chip, styles.chipPast, showPast && styles.chipPastActive]}
          >
            <Text style={[styles.chipText, showPast && styles.chipPastActiveText]}>
              {showPast ? 'Hide Past' : 'Show Past'}
            </Text>
          </Pressable>
        </ScrollView>

        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Sort:</Text>
          <View style={styles.sortToggle}>
            <Pressable
              onPress={() => setSort('popular')}
              style={[styles.sortBtn, sort === 'popular' && styles.sortBtnActive]}
            >
              <Text style={[styles.sortBtnText, sort === 'popular' && styles.sortBtnTextActive]}>
                Popular
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setSort('upcoming')}
              style={[styles.sortBtn, sort === 'upcoming' && styles.sortBtnActive]}
            >
              <Text style={[styles.sortBtnText, sort === 'upcoming' && styles.sortBtnTextActive]}>
                Upcoming
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* ── Festival list with scrollable title+search header ─────────── */}
      {filtered.length === 0 ? (
        <>
          {ListHeader}
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🎪</Text>
            <Text style={styles.emptyTitle}>No festivals match your filters</Text>
            <Text style={styles.emptySub}>Try a different genre or clear the filter.</Text>
            <Pressable onPress={clearGenres} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>Clear filters</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => (
            <FestivalCard festival={item} isPast={isPastFestival(item)} />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Sticky bar (always visible at top)
  stickyBar: {
    backgroundColor: '#0A0A0A',
    paddingTop: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  filterScroll: {
    flexGrow: 0,
  },
  filterBar: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chipActive: {
    backgroundColor: '#1DB954',
    borderColor: '#1DB954',
  },
  chipText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#000000',
  },
  chipPast: {
    borderColor: 'rgba(255,255,255,0.2)',
  },
  chipPastActive: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  chipPastActiveText: {
    color: '#FFFFFF',
  },

  // Sort row (inside sticky bar)
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 2,
    gap: 10,
  },
  sortLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontFamily: 'SpaceMono',
  },
  sortToggle: {
    flexDirection: 'row',
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    overflow: 'hidden',
  },
  sortBtn: {
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  sortBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  sortBtnText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '600',
  },
  sortBtnTextActive: {
    color: '#FFFFFF',
  },

  // Scrollable list header (title + search — scrolls away with content)
  listHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 4,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerSub: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    marginBottom: 12,
  },

  // Search (inside scrollable header)
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchIcon: {
    fontSize: 14,
  },
  searchInput: {
    flex: 1,
    height: 40,
    color: '#FFFFFF',
    fontSize: 14,
  },

  // Festival list
  list: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 14,
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 40,
  },
  emptyEmoji: {
    fontSize: 40,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySub: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    textAlign: 'center',
  },
  clearBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1DB954',
    borderRadius: 20,
  },
  clearBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
});
