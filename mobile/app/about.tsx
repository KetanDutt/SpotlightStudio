/** About – what the app is, where the wallpapers come from, and how to get the desktop app. */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '../src/components/ui/AppText';
import { Button } from '../src/components/ui/Button';
import { IconButton } from '../src/components/ui/IconButton';
import { Row, SectionCard } from '../src/components/ui/SectionCard';
import { APP_TAGLINE, APP_VERSION, GITHUB_OWNER, GITHUB_REPO } from '../src/core/config';
import { CAPABILITIES_NOTE, capabilities } from '../src/core/platform';
import { fmtInt } from '../src/core/utils';
import { spacing } from '../src/theme/tokens';
import { useColors } from '../src/theme/ThemeProvider';
import { useCatalog } from '../src/providers/CatalogProvider';

const REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;

export default function AboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { catalog, meta } = useCatalog();

  const open = (url: string) => {
    void WebBrowser.openBrowserAsync(url).catch(() => undefined);
  };

  return (
    <View style={styles.fill}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <IconButton icon="chevron-down" accessibilityLabel="Close" onPress={() => (router.canGoBack() ? router.back() : router.push('/'))} translucent />
        <AppText variant="heading">About</AppText>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={[styles.logo, { backgroundColor: colors.fill, borderColor: colors.stroke }]}>
            <Ionicons name="image-outline" size={38} color={colors.accent} />
          </View>
          <AppText variant="display" align="center">
            Spotlight Studio
          </AppText>
          <AppText variant="label" tone="muted" align="center">
            {APP_TAGLINE}
          </AppText>
          <AppText variant="caption" tone="faint" align="center">
            Version {APP_VERSION} · {capabilities.name}
          </AppText>
        </View>

        <SectionCard title="The collection">
          <Row
            icon="images-outline"
            title="Wallpapers in this catalog"
            value={fmtInt(catalog?.total ?? 0)}
            divider={false}
          />
          <Row
            icon="cloud-outline"
            title="Loaded from"
            subtitle={
              meta.origin === 'local-api'
                ? `Your Spotlight Studio server (${meta.baseUrl})`
                : meta.origin === 'remote'
                  ? 'The published catalog bundled with the repository, cached on this device'
                  : meta.origin === 'bundled'
                    ? 'The offline copy bundled inside the app'
                    : 'Nothing loaded yet'
            }
            divider
          />
          <Row
            icon="layers-outline"
            title="Origin of the pictures"
            subtitle="Windows Spotlight images collected by the Spotlight Studio crawler from Peapix and Windows10Spotlight, de-duplicated by perceptual hash."
            divider
          />
        </SectionCard>

        <SectionCard title="How setting works">
          <View style={styles.note}>
            <AppText variant="caption" tone="muted">
              {CAPABILITIES_NOTE}
            </AppText>
          </View>
        </SectionCard>

        <SectionCard title="Links">
          <Row
            icon="logo-github"
            title="Spotlight Studio on GitHub"
            subtitle="The crawler, the web gallery and this app"
            onPress={() => open(REPO_URL)}
            divider={false}
          />
          <Row
            icon="book-outline"
            title="Documentation"
            subtitle="API, architecture, deployment and the mobile guide"
            onPress={() => open(`${REPO_URL}/tree/main/docs`)}
            divider
          />
          <Row
            icon="bug-outline"
            title="Report a problem"
            subtitle="Issues and feature requests"
            onPress={() => open(`${REPO_URL}/issues`)}
            divider
          />
        </SectionCard>

        <SectionCard
          title="Licence & credits"
          footer="Wallpapers remain the property of their original photographers. Spotlight Studio only collects publicly shared Windows Spotlight images."
        >
          <Row icon="document-text-outline" title="All rights reserved" subtitle="See LICENSE in the repository" divider={false} />
        </SectionCard>

        <Button title="Close" variant="secondary" icon="chevron-down" onPress={() => (router.canGoBack() ? router.back() : router.push('/'))} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerSpacer: { width: 44 },
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
    paddingBottom: spacing.xxxl * 2,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  logo: {
    width: 84,
    height: 84,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  note: {
    padding: spacing.lg,
  },
});
