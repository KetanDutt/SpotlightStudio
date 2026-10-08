/** Offline privacy notice and least-privilege permission explanation. */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../src/components/ui/AppText';
import { IconButton } from '../src/components/ui/IconButton';
import { SectionCard } from '../src/components/ui/SectionCard';
import { PRIVACY_SECTIONS, PRIVACY_UPDATED } from '../src/core/privacy';
import { spacing } from '../src/theme/tokens';
import { useColors } from '../src/theme/ThemeProvider';

export default function PrivacyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  return <View style={[styles.fill, { backgroundColor: colors.bg }]}>
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <IconButton icon="chevron-back" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />
      <AppText variant="heading">Privacy</AppText>
    </View>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxxl }]}>
      <AppText variant="caption" tone="muted">Privacy & permissions · updated {PRIVACY_UPDATED}. Available offline.</AppText>
      {PRIVACY_SECTIONS.map(section => <SectionCard key={section.title} title={section.title}>
        <AppText variant="body" tone="muted" style={styles.section}>{section.body}</AppText>
      </SectionCard>)}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  content: { padding: spacing.lg, gap: spacing.lg },
  section: { padding: spacing.lg },
});
