import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { loadCollectionsForUser } from '@/src/hooks/useCollections';
import { useFestivalCacheStore } from '@/src/stores/festivalCacheStore';
import { usePlayerStore } from '@/src/stores/playerStore';
import { useUserStore } from '@/src/stores/userStore';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

// ─── Collections bootstrapper ─────────────────────────────────────────────────
// Watches for the user's Spotify ID to become available (after session restore
// or fresh OAuth) and loads their collections from Supabase exactly once.

function CollectionsBootstrapper() {
  const userId = useUserStore((s) => s.profile?.id);

  useEffect(() => {
    if (userId) {
      loadCollectionsForUser(userId);
    }
  }, [userId]);

  return null;
}

// ─── Dev performance monitor ──────────────────────────────────────────────────
// Logs memory-relevant stats every 10 s in development builds to catch leaks
// during manual testing. Stripped from production by the bundler (__DEV__).

function DevPerfMonitor() {
  useEffect(() => {
    if (!__DEV__) return;

    const id = setInterval(() => {
      const { queue } = usePlayerStore.getState();
      const { cache } = useFestivalCacheStore.getState();
      const festivalsInMemory = Object.keys(cache).length;
      const trackObjects = Object.values(cache).reduce((n, c) => n + c.tracks.length, 0);

      console.log(
        `[perf] queue: ${queue.length} tracks` +
        ` | festivals in memory: ${festivalsInMemory}` +
        ` | cached track objects: ${trackObjects}`,
      );
    }, 10_000);

    return () => clearInterval(id);
  }, []);

  return null;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <CollectionsBootstrapper />
        <DevPerfMonitor />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
          <Stack.Screen name="festival/[slug]" options={{ headerShown: false }} />
          <Stack.Screen name="collection/[slug]" options={{ headerShown: false }} />
          <Stack.Screen name="mission/[id]" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="mission/review/[id]" options={{ headerShown: false }} />
          <Stack.Screen
            name="artist/[id]"
            options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: true }}
          />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
