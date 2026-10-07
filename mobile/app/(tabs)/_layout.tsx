/** Bottom tab bar – Browse · Favourites · History · Settings. */
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router/js-tabs';
import React from 'react';
import { Platform, StyleSheet } from 'react-native';

import { fontSize } from '../../src/theme/tokens';
import { useColors } from '../../src/theme/ThemeProvider';
import { usePreferences } from '../../src/providers/PreferencesProvider';

export default function TabsLayout() {
  const colors = useColors();
  const { favoriteCount } = usePreferences();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          position: 'absolute',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.stroke,
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : colors.surface,
          height: Platform.OS === 'ios' ? 84 : 62,
          paddingTop: 6,
          elevation: 0,
        },
        tabBarBackground: () =>
          Platform.OS === 'ios' ? (
            <BlurView intensity={48} tint={colors.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          ) : null,
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
