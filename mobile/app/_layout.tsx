/**
 * Root layout – providers, theme, error boundary and the background-task definition.
 *
 * Ordering matters: SafeArea → Theme (palette) → Toast (needs the palette) →
 * Preferences (storage) → Catalog (data) → navigation.
 */
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '../src/components/feedback/ToastProvider';
import { Button } from '../src/components/ui/Button';
import { AppText } from '../src/components/ui/AppText';
import { CatalogProvider } from '../src/providers/CatalogProvider';
import { PreferencesProvider } from '../src/providers/PreferencesProvider';
import { ThemeProvider, useColors } from '../src/theme/ThemeProvider';
import { defineRotationTask } from '../src/services/rotation';

// The task has to be defined on every launch – Android may start the app *only* to run it
// (headless), in which case this module is the entry point.
defineRotationTask();

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * A last-resort error screen.  Anything a screen throws lands here instead of a white
 * screen, and the details stay visible for a bug report.
 */
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error('[SpotlightStudio] unhandled render error', error);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.errorWrap}>
        <Ionicons name="bug-outline" size={42} color="#f87171" />
        <AppText variant="title" align="center">
          Something broke
        </AppText>
        <AppText variant="label" tone="muted" align="center">
          The app hit an unexpected error. Your favourites and settings are safe.
        </AppText>
        <AppText variant="mono" tone="faint" align="center" numberOfLines={6}>
          {this.state.error.message}
        </AppText>
        <Button title="Try again" icon="refresh" variant="primary" inline onPress={() => this.setState({ error: null })} />
      </View>
    );
  }
}

function ThemedApp() {
  const colors = useColors();
  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar style={colors.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="wallpaper/[id]" options={{ animation: 'fade_from_bottom' }} />
        <Stack.Screen name="search" options={{ animation: 'fade' }} />
        <Stack.Screen name="directory" />
        <Stack.Screen name="tags" />
        <Stack.Screen name="about" options={{ presentation: 'modal' }} />
        <Stack.Screen name="+not-found" />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ToastProvider>
            <PreferencesProvider>
              <CatalogProvider>
                <AppErrorBoundary>
                  <ThemedApp />
                </AppErrorBoundary>
              </CatalogProvider>
            </PreferencesProvider>
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 28,
    backgroundColor: '#07080d',
  },
});
