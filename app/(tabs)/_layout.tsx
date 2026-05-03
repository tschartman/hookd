import { Pressable } from 'react-native';
import { Tabs } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import { usePlayerStore } from '@/src/stores/playerStore';

export default function TabLayout() {
  return (
    <Tabs
      screenListeners={{
        blur: () => usePlayerStore.getState()._setIsPlaying(false),
      }}
      initialRouteName="feed"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: '#666666',
        tabBarStyle: {
          backgroundColor: '#111111',
          borderTopColor: 'rgba(255,255,255,0.08)',
          borderTopWidth: 1,
          paddingTop: 8,
          height: 80,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontFamily: 'SpaceMono',
          marginTop: 2,
        },
        tabBarButton: (props) => (
          <Pressable
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {...(props as any)}
            onPress={(e) => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              props.onPress?.(e);
            }}
          />
        ),
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarIcon: ({ color }) => <Ionicons name="radio-outline" size={24} color={color} />,
        }}
      />
      {/* Hide the old index placeholder from the tab bar */}
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen
        name="two"
        options={{
          title: 'Live',
          tabBarIcon: ({ color }) => <Ionicons name="ticket-outline" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="build"
        options={{
          title: 'Mix',
          tabBarIcon: ({ color }) => <Ionicons name="layers-outline" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Library',
          tabBarIcon: ({ color }) => <Ionicons name="bookmarks-outline" size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}
