/** Bottom tab bar – Browse · Favourites · History · Settings. */
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import React from 'react';
import { StyleSheet } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassBackdrop } from '../../src/components/ui/GlassBackdrop';
import { fontSize, navigation, radius, spacing } from '../../src/theme/tokens';
import { useColors } from '../../src/theme/ThemeProvider';
import { usePreferences } from '../../src/providers/PreferencesProvider';

export default function TabsLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { favoriteCount } = usePreferences();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          position: 'absolute',
          left: spacing.lg, right: spacing.lg,
          bottom: Math.max(insets.bottom, navigation.inset),
          height: navigation.height,
          paddingTop: spacing.sm, paddingBottom: spacing.sm,
          borderRadius: radius.xl, overflow: 'hidden',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.strokeStrong, borderTopColor: colors.strokeStrong,
          backgroundColor: 'transparent',
          elevation: 0,
        },
        tabBarActiveBackgroundColor: colors.accentFill,
        tabBarItemStyle: { borderRadius: radius.lg, overflow: 'hidden', marginHorizontal: spacing.xs },
        tabBarBackground: () => <GlassBackdrop />,
        tabBarLabelStyle: { fontSize: fontSize.xxs, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Browse',
          tabBarIcon: ({ color, size }) => <Ionicons name="images-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: 'Favourites',
          tabBarBadge: favoriteCount > 0 ? favoriteCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, color: colors.onAccent, fontSize: 10 },
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'heart' : 'heart-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
