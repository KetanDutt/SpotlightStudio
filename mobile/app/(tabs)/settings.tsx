/**
 * Settings – appearance, automatic rotation, data & storage, about.
 *
 * The rotation section is the *only* place that talks to the OS scheduler; every change is
 * applied immediately (no "save" button) and the resulting state is reported back verbatim,
 * because background execution on Android is at the mercy of the battery optimiser and the
 * user deserves to know exactly what the system will do.
 */
import { Directory, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToast } from '../../src/components/feedback/ToastProvider';
import { AppText } from '../../src/components/ui/AppText';
import { Button } from '../../src/components/ui/Button';
import { Chip } from '../../src/components/ui/Chip';
import { Row, SectionCard, SwitchRow } from '../../src/components/ui/SectionCard';
import { Segmented } from '../../src/components/ui/Segmented';
import { ScreenHeader } from '../../src/components/ui/ScreenHeader';
import { APP_VERSION, GITHUB_OWNER, GITHUB_REPO } from '../../src/core/config';
import { CAPABILITIES_NOTE, PLATFORM_COPY, capabilities } from '../../src/core/platform';
import { describeMode } from '../../src/services/wallpaper';
import { ALBUM_NAME } from '../../src/services/media';
import { ROTATION_TASK } from '../../src/services/rotation';
import { fmtBytes, fmtInt, fmtRelative, topTags } from '../../src/core/utils';
import { spacing } from '../../src/theme/tokens';
import { useTheme, type ThemePreference } from '../../src/theme/ThemeProvider';
import { useRotation } from '../../src/hooks/useRotation';
import { useCatalog } from '../../src/providers/CatalogProvider';
import { usePreferences } from '../../src/providers/PreferencesProvider';

import { clearAll } from '../../src/services/storage';

const INTERVALS = [
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 180, label: '3h' },
  { value: 360, label: '6h' },
  { value: 720, label: '12h' },
  { value: 1440, label: '24h' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { show } = useToast();
  const { meta, catalog, refresh, refreshing } = useCatalog();
  const { favoriteCount, clearFavorites, history, resetRotation } = usePreferences();
  const { preference, setPreference } = useTheme();
  const rotation = useRotation();
  // `Directory.size` is synchronous in expo-file-system, so the cache can be measured
  // lazily instead of keeping an effect around for it.
  const measureCache = useCallback((): number | null => {
    try {
      const dir = new Directory(Paths.cache, 'spotlight-studio');
      return dir.exists ? dir.size ?? 0 : 0;
    } catch {
      return null;
    }
  }, []);

  const [cacheSize, setCacheSize] = useState<number | null>(() => measureCache());

  const clearCache = useCallback(async () => {
    try {
      const dir = new Directory(Paths.cache, 'spotlight-studio');
      if (dir.exists) dir.delete();
      await Image.clearDiskCache();
      show({ tone: 'success', message: 'Cached downloads and thumbnails removed.' });
    } catch (error) {
      show({ tone: 'error', message: `Could not clear the cache: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setCacheSize(measureCache());
    }
  }, [measureCache, show]);

  const originLabel =
    meta.origin === 'local-api'
      ? `Local server · ${meta.baseUrl}`
      : meta.origin === 'remote'
        ? 'Published catalog (cached on this device)'
        : meta.origin === 'bundled'
          ? 'Bundled catalog (offline copy)'
          : 'Not loaded';

  const rotationTags = catalog ? topTags(catalog, 18).map(([tag]) => tag) : [];

  return (
    <View style={styles.fill}>
      <View style={{ paddingTop: insets.top }}>
        <ScreenHeader title="Settings" subtitle={`Spotlight Studio ${APP_VERSION} · ${capabilities.name}`} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ── Appearance ─────────────────────────────────────────────── */}
        <SectionCard title="Appearance">
          <View style={styles.block}>
            <AppText variant="label">Theme</AppText>
            <Segmented<ThemePreference>
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              value={preference}
              onChange={(next) => {
                setPreference(next);
                show({ message: next === 'auto' ? 'Following the system appearance.' : `${next === 'dark' ? 'Dark' : 'Light'} theme applied.` });
              }}
              accessibilityLabel="Theme"
            />
            <AppText variant="caption" tone="faint">
              The same “Liquid Glass” palette as the web gallery – light, dark, or whatever your phone is set to.
            </AppText>
          </View>
        </SectionCard>

        {/* ── Automatic rotation ─────────────────────────────────────── */}
        <SectionCard
          title="Automatic wallpaper rotation"
          footer={
            rotation.supported
              ? `Runs in the background as “${ROTATION_TASK}”. The system decides the exact moment – expect it roughly every ${rotation.settings.intervalMinutes} minutes when the phone is idle and not in battery saver.`
              : PLATFORM_COPY.iosRotationBlocked.body
          }
        >
          {rotation.supported ? (
            <>
              <SwitchRow
                icon="sync-outline"
                title="Rotate automatically"
                subtitle="Pick a new wallpaper in the background"
                value={rotation.settings.enabled}
                onValueChange={(enabled) => void rotation.setEnabled(enabled)}
                testID="rotation-toggle"
              />
              <View style={styles.block}>
                <AppText variant="label">Interval</AppText>
                <View style={styles.chips}>
                  {INTERVALS.map((option) => (
                    <Chip
                      key={option.value}
                      label={option.label}
                      selected={rotation.settings.intervalMinutes === option.value}
                      onPress={() => rotation.update({ intervalMinutes: option.value })}
                    />
                  ))}
                </View>
              </View>
              <View style={styles.block}>
                <AppText variant="label">Apply to</AppText>
                <Segmented
                  options={[
                    { value: 'home', label: 'Home' },
                    { value: 'lock', label: 'Lock' },
                    { value: 'both', label: 'Both' },
                  ]}
                  value={rotation.settings.mode}
                  onChange={(mode) => rotation.update({ mode: mode as typeof rotation.settings.mode })}
                  accessibilityLabel="Wallpaper target for rotation"
                />
              </View>
              <SwitchRow
                icon="sparkles-outline"
                title="4K / 2K only"
                subtitle="Skip Full HD images when a higher resolution is available"
                value={rotation.settings.highResOnly}
                onValueChange={(value) => rotation.update({ highResOnly: value })}
                divider
              />
              <SwitchRow
                icon="heart-outline"
                title="Favourites only"
                subtitle="Rotate through the wallpapers you hearted"
                value={rotation.settings.favoritesOnly}
                onValueChange={(value) => rotation.update({ favoritesOnly: value })}
                divider
              />
              {!rotation.settings.favoritesOnly && rotationTags.length ? (
                <View style={styles.block}>
                  <View style={styles.blockHeader}>
                    <AppText variant="label">Only tags</AppText>
                    {rotation.settings.tags.length ? (
                      <Button title="Clear" variant="ghost" size="sm" inline onPress={() => rotation.update({ tags: [] })} />
                    ) : null}
                  </View>
                  <View style={styles.chips}>
                    {rotationTags.map((tag) => {
                      const selected = rotation.settings.tags.includes(tag);
                      return (
                        <Chip
                          key={tag}
                          label={tag}
                          size="sm"
                          selected={selected}
                          onPress={() =>
                            rotation.update({
                              tags: selected ? rotation.settings.tags.filter((t) => t !== tag) : [...rotation.settings.tags, tag],
                            })
                          }
                        />
                      );
                    })}
                  </View>
                  <AppText variant="caption" tone="faint">
                    Nothing selected means the whole library. If a filter is too strict the rotation falls back to everything
                    rather than doing nothing.
                  </AppText>
                </View>
              ) : null}
              <Row
                icon="play-outline"
                title="Rotate now"
                subtitle={rotation.running ? 'Working…' : 'Test the setup – applies the next wallpaper immediately'}
                onPress={() => void rotation.rotateNow()}
                divider
                testID="rotate-now"
              />
              <Row
                icon="time-outline"
                title="Last run"
                value={rotation.settings.lastRunAt ? fmtRelative(new Date(rotation.settings.lastRunAt).toISOString()) : 'never'}
                subtitle={
                  rotation.settings.lastRunError
                    ? `Last error: ${rotation.settings.lastRunError}`
                    : `${rotation.settings.runCount} successful run${rotation.settings.runCount === 1 ? '' : 's'}`
                }
                divider
              />
              {rotation.status ? (
                <View style={styles.block}>
                  <AppText variant="caption" tone="faint">
                    {rotation.status}
                  </AppText>
                  {rotation.lastResult ? (
                    <AppText variant="caption" tone="accent">
                      {rotation.lastResult}
                    </AppText>
                  ) : null}
                </View>
              ) : null}
              <Row
                icon="refresh-outline"
                title="Reset rotation settings"
                subtitle="Back to the defaults (off, every 3 hours, home screen)"
                onPress={() => {
                  resetRotation();
                  show({ message: 'Rotation settings reset.' });
                }}
                divider
              />
            </>
          ) : (
            <View style={styles.block}>
              <AppText variant="subheading">{PLATFORM_COPY.iosRotationBlocked.title}</AppText>
              <AppText variant="caption" tone="muted">
                {CAPABILITIES_NOTE}
              </AppText>
            </View>
          )}
        </SectionCard>

        {/* ── Wallpapers & library ───────────────────────────────────── */}
        <SectionCard title="Library">
          <Row
            icon="cloud-download-outline"
            title="Catalog source"
            subtitle={originLabel}
            value={catalog ? `${fmtInt(catalog.total)} items` : undefined}
            divider={false}
          />
          <Row
            icon="sync-outline"
            title="Refresh catalog"
            subtitle={meta.loadedAt ? `Last updated ${fmtRelative(new Date(meta.loadedAt).toISOString())}` : 'Not loaded yet'}
            onPress={() => {
              void refresh().then(() => show({ tone: 'success', message: 'Catalog refreshed.' }));
              setCacheSize(measureCache());
            }}
            value={refreshing ? 'Refreshing…' : undefined}
            divider
            disabled={refreshing}
          />
          <Row
            icon="trash-outline"
            title="Clear cached images"
            subtitle={`Downloaded wallpapers and thumbnails · ${cacheSize == null ? 'unknown' : fmtBytes(cacheSize)}`}
            onPress={() => void clearCache()}
            divider
          />
          <Row
            icon="albums-outline"
            title="Photo album"
            subtitle={`Saved pictures go to “${ALBUM_NAME}” in your photo library`}
            divider
          />
          <Row
            icon="heart-outline"
            title="Favourites"
            value={fmtInt(favoriteCount)}
            subtitle="Stored on this device only"
            onPress={() => {
              if (!favoriteCount) return;
              clearFavorites();
              show({ message: 'Favourites cleared.' });
            }}
            divider
          />
          <Row
            icon="search-outline"
            title="Search the catalog"
            subtitle="Titles, tags, sources and dates – offline"
            onPress={() => router.push('/search')}
            divider
          />
          <Row
            icon="grid-outline"
            title="Directory"
            subtitle="Sources, resolution classes, tags and exports"
            onPress={() => router.push('/directory')}
            divider
          />
          <Row
            icon="pricetags-outline"
            title="Tags"
            value={catalog ? fmtInt(catalog.tagCount.size) : undefined}
            subtitle="Every tag in the library with its count"
            onPress={() => router.push('/tags')}
            divider
          />
          <Row
            icon="time-outline"
            title="History"
            value={fmtInt(history.length)}
            onPress={() => router.push('/history')}
            divider
          />
        </SectionCard>

        {/* ── About ──────────────────────────────────────────────────── */}
        <SectionCard title="About">
          <Row
            icon="information-circle-outline"
            title="About Spotlight Studio"
            subtitle={`Wallpapers from GitHub · ${GITHUB_OWNER}/${GITHUB_REPO}`}
            onPress={() => router.push('/about')}
            divider={false}
          />
          <Row
            icon="download-outline"
            title="Favourites and settings are local"
            subtitle="Nothing is uploaded; the app only ever downloads wallpapers."
            divider
          />
          <Row
            icon="warning-outline"
            title="Reset app data"
            destructive
            subtitle="Favourites, history, rotation settings and cached catalog"
            onPress={() => {
              void clearAll().then(() => {
                show({
                  tone: 'warning',
                  title: 'App data cleared',
                  message: 'Restart the app to start from a clean state.',
                });
              });
            }}
            divider
          />
          <Row icon="code-slash-outline" title="Version" value={APP_VERSION} divider />
          <Row
            icon="phone-portrait-outline"
            title="Platform"
            value={capabilities.name}
            subtitle={
              capabilities.canSetWallpaper
                ? `Direct “set wallpaper” supported${capabilities.canSetHomeAndLockSeparately ? ' (home, lock or both)' : ''}. Fallback: ${describeMode('home')}.`
                : PLATFORM_COPY.iosShortcut.body
            }
            divider
          />
        </SectionCard>

        <AppText variant="caption" tone="faint" align="center" style={styles.footer}>
          Spotlight Studio · {fmtInt(catalog?.total ?? 0)} wallpapers · catalogue © their original photographers,
          collected from Peapix and Windows10Spotlight.
        </AppText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
    paddingBottom: spacing.xxxl * 2.5,
  },
  block: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    lineHeight: 16,
  },
});
