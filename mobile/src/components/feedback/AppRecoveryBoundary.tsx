/** Works even when a provider fails: deliberately uses no theme/router/native icon hooks. */
import React, { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

export function RecoveryScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  useEffect(() => { void SplashScreen.hideAsync().catch(() => undefined); }, []);
  return <ScrollView style={styles.viewport} contentContainerStyle={styles.screen} accessibilityViewIsModal>
    <Text style={styles.title} accessibilityRole="header">Let’s try that again</Text>
    <Text style={styles.body}>{message}</Text>
    <Text style={styles.note}>Your favorites and saved Photos are not deleted. If retry does not help, restart the app.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Retry app startup" onPress={onRetry}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.75 }]}>
      <Text style={styles.buttonText}>Try again</Text>
    </Pressable>
  </ScrollView>;
}

export class AppRecoveryBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean; revision: number }> {
  override state = { error: false, revision: 0 };
  static getDerivedStateFromError() { return { error: true }; }
  override componentDidCatch(error: Error) {
    // No telemetry, no production log of URLs, private filenames or raw user data.
    if (__DEV__) console.warn('[SpotlightStudio] render recovery', error.message);
  }
  override render() {
    if (this.state.error) return <RecoveryScreen message="The app could not display this screen. Please retry."
      onRetry={() => this.setState(state => ({ error: false, revision: state.revision + 1 }))} />;
    return <React.Fragment key={this.state.revision}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  viewport: { flex: 1, backgroundColor: '#121316' },
  screen: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 20 },
  title: { color: '#f0f1f3', fontSize: 24, fontWeight: '600', textAlign: 'center' },
  body: { color: '#b0b5be', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  note: { color: '#979da8', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  button: { backgroundColor: '#e2b05e', borderRadius: 10, minHeight: 48, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: '#1c1406', fontSize: 15, fontWeight: '600' },
});
