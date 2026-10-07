/**
 * Favourites – the wallpapers the user hearted, newest first.
 *
 * Favourites are stored as file names, so they survive catalog refreshes and work offline.
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToast } from '../../src/components/feedback/ToastProvider';
import { AppText } from '../../src/components/ui/AppText';
import { IconButton } from '../../src/components/ui/IconButton';
import { ScreenHeader } from '../../src/components/ui/ScreenHeader';
import { EmptyState, LoadingState } from '../../src/components/ui/States';
import { SetWallpaperSheet } from '../../src/components/wallpaper/SetWallpaperSheet';
import { WallpaperGrid } from '../../src/components/wallpaper/WallpaperGrid';
import { thumbnailUrl } from '../../src/services/media';
import type { Wallpaper } from '../../src/core/types';
import { SOURCE_LABELS, comparator, fmtInt } from '../../src/core/utils';
import { spacing } from '../../src/theme/tokens';
import { useCatalog } from '../../src/providers/CatalogProvider';
import { usePreferences } from '../../src/providers/PreferencesProvider';

export default function FavoritesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { show } = useToast();
  const { catalog, loading } = useCatalog();
  const { favorites, favoritesVersion, isFavorite, toggleFavorite, clearFavorites } = usePreferences();
  const [sheetItem, setSheetItem] = useState<Wallpaper | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const items = useMemo(() => {
    if (!catalog) return [] as Wallpaper[];
    void favoritesVersion;
    const list = catalog.items.filter((item) => favorites.has(item.key));
    // "Newest first" in the same stable order as the gallery.
    return list.sort(comparator('newest'));
  }, [catalog, favorites, favoritesVersion]);

  const bySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.source, (counts.get(item.source) || 0) + 1);
    return [...counts].map(([source, count]) => `${SOURCE_LABELS[source] ?? source} ${count}`).join(' · ');
  }, [items]);

  const open = useCallback(
    (item: Wallpaper) => {
      router.push(`/wallpaper/${item.id}`);
    },
    [router],
  );

  const onToggleFavorite = useCallback(
    (item: Wallpaper) => {
      toggleFavorite(item.key);
      show({ tone: 'info', message: `Removed “${item.title}” from favourites.` });
    },
    [show, toggleFavorite],
  );

  if (loading && !catalog) {
    return (
      <View style={styles.fill}>
        <LoadingState message="Loading your favourites…" />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <View style={{ paddingTop: insets.top }}>
        <ScreenHeader
          title="Favourites"
          subtitle={items.length ? `${fmtInt(items.length)} saved${bySource ? ` · ${bySource}` : ''}` : 'Heart a wallpaper to keep it here'}
          actions={
            <>
              <IconButton
                icon={view === 'grid' ? 'list-outline' : 'grid-outline'}
                accessibilityLabel={view === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
                onPress={() => setView(view === 'grid' ? 'list' : 'grid')}

              />
              {items.length ? (
                <IconButton
                  icon="trash-outline"
                  accessibilityLabel="Remove all favourites"
                  onPress={() => {
                    clearFavorites();
                    show({ tone: 'info', message: 'All favourites removed.' });
                  }}

                />
              ) : null}
            </>
          }
        />
      </View>

      <WallpaperGrid
        items={items}
        thumbFor={(item) => thumbnailUrl(item)}
        view={view}
        cols={2}
        isFavorite={isFavorite}
        onOpen={open}
        onToggleFavorite={onToggleFavorite}
        onLongPress={setSheetItem}
        ListEmptyComponent={
          <EmptyState
            icon="heart-outline"
            title="No favourites yet"
            body="Tap the heart on any wallpaper – it is kept on this device, even offline."
            actionLabel="Browse wallpapers"
            onAction={() => router.push('/')}
          />
        }
        ListFooterComponent={
          items.length ? (
            <View style={styles.footer}>
              <AppText variant="caption" tone="faint" align="center">
                Long-press a wallpaper to set it right away.
              </AppText>
            </View>
          ) : null
        }
      />

      <SetWallpaperSheet item={sheetItem ?? undefined} visible={sheetItem !== null} onClose={() => setSheetItem(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  footer: { paddingVertical: spacing.xl },
});
