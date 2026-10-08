/**
 * Root layout – providers, theme, error boundary and the background-task definition.
 *
 * Ordering matters: SafeArea → Theme (palette) → Toast (needs the palette) →
 * Preferences (storage) → Catalog (data) → navigation.
 */
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider, useToast } from '../src/components/feedback/ToastProvider';
import { CatalogProvider } from '../src/providers/CatalogProvider';
import { PreferencesProvider, usePreferences } from '../src/providers/PreferencesProvider';
import { ThemeProvider, useColors, useTheme } from '../src/theme/ThemeProvider';
import { defineRotationTask } from '../src/services/rotation';
import { maintainCache } from '../src/services/cache';
import { useRotationScheduler } from '../src/hooks/useRotationScheduler';
import { AppRecoveryBoundary } from '../src/components/feedback/AppRecoveryBoundary';
import { StartupGate, useAppStartupReady } from '../src/components/feedback/StartupGate';

// The task has to be defined on every launch – Android may start the app *only* to run it
// (headless), in which case this module is the entry point.
defineRotationTask();

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function ThemedApp() {
  const colors = useColors();
  const { reduceMotion, ready, storageError: themeStorageError } = useTheme();
  const reportReady = useAppStartupReady();
  useRotationScheduler();
  const { storageError } = usePreferences();
  const { show } = useToast();
  useEffect(() => {
    if (storageError || themeStorageError) show({ tone: 'warning', title: 'Preferences not saved', message: storageError || themeStorageError || '', durationMs: 7000 });
  }, [storageError, themeStorageError, show]);
  useEffect(() => {
    if (ready) reportReady();
  }, [ready, reportReady]);
  useEffect(() => {
    const timer = setTimeout(maintainCache, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar style={colors.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: reduceMotion ? 'none' : 'fade',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="wallpaper/[id]" options={{ animation: reduceMotion ? 'none' : 'fade_from_bottom' }} />
        <Stack.Screen name="search" options={{ animation: reduceMotion ? 'none' : 'fade' }} />
        <Stack.Screen name="directory" />
        <Stack.Screen name="tags" />
        <Stack.Screen name="privacy" />
        <Stack.Screen name="about" options={{ presentation: 'modal' }} />
        <Stack.Screen name="+not-found" />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <AppRecoveryBoundary>
      <StartupGate>
        <GestureHandlerRootView style={styles.root}>
          <SafeAreaProvider>
            <ThemeProvider>
              <ToastProvider>
                <PreferencesProvider>
                  <CatalogProvider>
                    <ThemedApp />
                  </CatalogProvider>
                </PreferencesProvider>
              </ToastProvider>
            </ThemeProvider>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </StartupGate>
    </AppRecoveryBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
