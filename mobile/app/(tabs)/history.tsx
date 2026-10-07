/** History – what was downloaded, saved, shared or applied, newest first. */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToast } from '../../src/components/feedback/ToastProvider';
import { AppText } from '../../src/components/ui/AppText';
import { Button } from '../../src/components/ui/Button';
import { IconButton } from '../../src/components/ui/IconButton';
import { Touchable } from '../../src/components/ui/Pressable';
import { ScreenHeader } from '../../src/components/ui/ScreenHeader';
import { EmptyState, LoadingState } from '../../src/components/ui/States';
import { SetWallpaperSheet } from '../../src/components/wallpaper/SetWallpaperSheet';
import { thumbnailUrl } from '../../src/services/media';
import type { HistoryAction, Wallpaper } from '../../src/core/types';
import { fmtRelative } from '../../src/core/utils';
import { navigation, radius, spacing } from '../../src/theme/tokens';
import { useColors } from '../../src/theme/ThemeProvider';
import { useCatalog } from '../../src/providers/CatalogProvider';
import { usePreferences } from '../../src/providers/PreferencesProvider';

const ACTION_META: Record<HistoryAction, { icon: keyof typeof Ionicons.glyphMap; label: string; tone: 'default' | 'ok' | 'accent' }> = {
  download: { icon: 'phone-portrait-outline', label: 'Applied as wallpaper', tone: 'ok' },
  save: { icon: 'download-outline', label: 'Saved to Photos', tone: 'accent' },
  share: { icon: 'share-outline', label: 'Shared', tone: 'default' },
  'copy-link': { icon: 'link-outline', label: 'Link copied', tone: 'default' },
  'open-source': { icon: 'open-outline', label: 'Source opened', tone: 'default' },
};

export default function HistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { show } = useToast();
  const { catalog, loading } = useCatalog();
  const { history, clearHistory, isFavorite, toggleFavorite } = usePreferences();
  const [sheetItem, setSheetItem] = useState<Wallpaper | null>(null);

  const rows = useMemo(() => {
    if (!catalog) return [] as { id: number; action: HistoryAction; at: number; item: Wallpaper }[];
    const seen = new Set<number>();
    const out: { id: number; action: HistoryAction; at: number; item: Wallpaper }[] = [];
    for (const entry of history) {
      // One row per wallpaper (the latest action) keeps the list readable.
      if (seen.has(entry.id)) continue;
      const item = catalog.byId.get(entry.id);
      if (!item) continue;
      seen.add(entry.id);
      out.push({ ...entry, item });
    }
    return out;
  }, [catalog, history]);

  const open = useCallback((item: Wallpaper) => router.push(`/wallpaper/${item.id}`), [router]);

  if (loading && !catalog) {
    return (
      <View style={styles.fill}>
        <LoadingState message="Loading history…" />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <View style={{ paddingTop: insets.top }}>
        <ScreenHeader
          title="History"
          subtitle={history.length ? `${history.length} action${history.length === 1 ? '' : 's'} on this device` : 'Your recent activity'}
          actions={
            history.length ? (
              <IconButton
                icon="trash-outline"
                accessibilityLabel="Clear history"
                onPress={() => {
                  clearHistory();
                  show({ message: 'History cleared.' });
                }}

              />
            ) : undefined
          }
        />
      </View>

      {rows.length === 0 ? (
        <EmptyState
          icon="time-outline"
          title="Nothing here yet"
          body="Wallpapers you set, save, share or copy show up here so you can find them again."
          actionLabel="Browse wallpapers"
          onAction={() => router.push('/')}
        />
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: navigation.contentInset + insets.bottom }]} showsVerticalScrollIndicator={false}>
          {rows.map(({ id, action, at, item }) => {
            const meta = ACTION_META[action] ?? ACTION_META.save;
            const favorite = isFavorite(item.key);
            return (
              <Touchable
                key={`${id}-${action}-${at}`}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}, ${meta.label}, ${fmtRelative(new Date(at).toISOString())}`}
                onPress={() => open(item)}
                plain
                style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.stroke }]}
              >
                <Image
                  source={{ uri: thumbnailUrl(item) }}
                  contentFit="cover"
                  transition={160}
                  cachePolicy="disk"
                  style={[styles.thumb, { backgroundColor: colors.fill }]}
                />
                <View style={styles.text}>
                  <AppText variant="subheading" numberOfLines={2}>
                    {item.title}
                  </AppText>
                  <View style={styles.metaRow}>
                    <Ionicons name={meta.icon} size={13} color={colors.textMuted} />
                    <AppText variant="caption" tone={meta.tone === 'default' ? 'muted' : meta.tone}>
                      {meta.label} · {fmtRelative(new Date(at).toISOString())}
                    </AppText>
                  </View>
                </View>
                <Button
                  title="Set"
                  size="sm"
                  variant="secondary"
                  icon="phone-portrait-outline"
                  inline
                  onPress={() => setSheetItem(item)}
                />
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel={favorite ? 'Remove from favourites' : 'Add to favourites'}
                  accessibilityState={{ selected: favorite }}
                  hitSlop={8}
                  onPress={() => toggleFavorite(item.key)}
                  style={styles.heart}
                >
                  <Ionicons name={favorite ? 'heart' : 'heart-outline'} size={19} color={favorite ? colors.danger : colors.textMuted} />
                </Touchable>
              </Touchable>
            );
          })}
        </ScrollView>
      )}

      <SetWallpaperSheet item={sheetItem ?? undefined} visible={sheetItem !== null} onClose={() => setSheetItem(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxxl * 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 78, height: 54, borderRadius: radius.md },
  text: { flex: 1, gap: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  heart: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
});
