/**
 * Search – the dedicated "find one wallpaper" screen.
 *
 * The whole catalog is already on the device, so every keystroke re-filters 7,500 rows in
 * memory (~5 ms) and no request is made.  Recent queries and the most-used tags are offered
 * when the field is empty, and the list is the same virtualised component the gallery uses,
 * so tapping a row behaves identically.
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToast } from '../src/components/feedback/ToastProvider';
import { AppText } from '../src/components/ui/AppText';
import { Button } from '../src/components/ui/Button';
import { Chip } from '../src/components/ui/Chip';
import { IconButton } from '../src/components/ui/IconButton';
import { EmptyState, ErrorState, LoadingState } from '../src/components/ui/States';
import { TextField } from '../src/components/ui/TextField';
import { SetWallpaperSheet } from '../src/components/wallpaper/SetWallpaperSheet';
import { WallpaperGrid } from '../src/components/wallpaper/WallpaperGrid';
import { asStringArray, pushRecent } from '../src/core/storage-utils';
import type { Wallpaper } from '../src/core/types';
import { DEFAULT_STATE, filterAndSort, fmtInt } from '../src/core/utils';
import { useDebouncedValue } from '../src/hooks/useDebouncedValue';
import { useCatalog } from '../src/providers/CatalogProvider';
import { usePreferences } from '../src/providers/PreferencesProvider';
import { thumbnailUrl } from '../src/services/media';
import { KEYS, getJson, setJson } from '../src/services/storage';
import { spacing } from '../src/theme/tokens';
import { useColors } from '../src/theme/ThemeProvider';

const PAGE_SIZE = 60;
const RECENT_LIMIT = 8;
const SUGGESTION_COUNT = 18;

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { show } = useToast();
  const { catalog, loading, refreshing, error, refresh, tags } = useCatalog();
  const { favorites, favoritesVersion, isFavorite, toggleFavorite } = usePreferences();

  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 240);
  const [recents, setRecents] = useState<string[]>([]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [sheetItem, setSheetItem] = useState<Wallpaper | null>(null);

  // Recent searches are stored on the device; the read is defensive (see services/storage).
  useEffect(() => {
    let cancelled = false;
    void getJson<string[]>(KEYS.recentSearches, []).then((rows) => {
      if (!cancelled) setRecents(asStringArray(rows).slice(0, RECENT_LIMIT));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = debounced.trim();

  const results = useMemo(() => {
    if (!catalog || !trimmed) return [] as Wallpaper[];
    void favoritesVersion; // favourites change ⇒ re-filter
    return filterAndSort(catalog, { ...DEFAULT_STATE, q: trimmed }, favorites);
  }, [catalog, favorites, favoritesVersion, trimmed]);

  const items = useMemo(() => results.slice(0, visible), [results, visible]);
  const suggestions = useMemo(() => tags.slice(0, SUGGESTION_COUNT), [tags]);

  const remember = useCallback((text: string) => {
    setRecents((current) => {
      const next = pushRecent(current, text, RECENT_LIMIT);
      void setJson(KEYS.recentSearches, next);
      return next;
    });
  }, []);

  const runQuery = useCallback((text: string) => {
    setQuery(text);
    setVisible(PAGE_SIZE);
  }, []);

  const clearRecents = useCallback(() => {
    setRecents([]);
    void setJson(KEYS.recentSearches, []);
    show({ message: 'Recent searches cleared.' });
  }, [show]);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.push('/');
  }, [router]);

  const open = useCallback(
    (item: Wallpaper) => {
      if (trimmed) remember(trimmed);
      Keyboard.dismiss();
      router.push(`/wallpaper/${item.id}`);
    },
    [remember, router, trimmed],
  );

  const onToggleFavorite = useCallback(
    (item: Wallpaper) => {
      const added = toggleFavorite(item.key);
      show({ tone: added ? 'success' : 'info', message: added ? `Added “${item.title}” to favourites.` : 'Removed from favourites.' });
    },
    [show, toggleFavorite],
  );

  const submit = useCallback(() => {
    if (trimmed) remember(trimmed);
    Keyboard.dismiss();
  }, [remember, trimmed]);

  return (
    <View style={styles.fill}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm, borderBottomColor: colors.stroke }]}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={back} translucent testID="search-back" />
        <View style={styles.headerField}>
          <TextField
            autoFocus
            value={query}
            onChangeText={runQuery}
            onClear={() => runQuery('')}
            onSubmitEditing={submit}
            returnKeyType="search"
            placeholder="Titles, tags, sources, dates…"
            accessibilityLabel="Search the catalog"
            testID="search-input"
          />
        </View>
      </View>

      {!catalog && loading ? <LoadingState message="Loading the wallpaper catalog…" /> : null}

      {!catalog && !loading && error ? (
        <ErrorState
          title="The catalog could not be loaded"
          message="Search needs the catalog. It stays available offline once it has been downloaded."
          detail={error}
          onRetry={() => void refresh()}
        />
      ) : null}

      {!trimmed
        ? catalog
          ? (
            <ScrollView contentContainerStyle={styles.intro} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              {recents.length ? (
                <View style={styles.block}>
                  <View style={styles.blockHeader}>
                    <AppText variant="label" tone="muted">
                      Recent searches
                    </AppText>
                    <Button title="Clear" variant="ghost" size="sm" inline onPress={clearRecents} />
                  </View>
                  <View style={styles.chips}>
                    {recents.map((entry) => (
                      <Chip key={entry} label={entry} icon="time-outline" size="sm" onPress={() => runQuery(entry)} />
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.block}>
                <AppText variant="label" tone="muted">
                  Popular tags
                </AppText>
                <View style={styles.chips}>
                  {suggestions.map(({ tag, count }) => (
                    <Chip key={tag} label={tag} count={count} size="sm" onPress={() => runQuery(tag)} />
                  ))}
                </View>
                <Button title="Browse every tag" icon="pricetags-outline" variant="secondary" onPress={() => router.push('/tags')} />
              </View>

              <AppText variant="caption" tone="faint">
                Search matches titles, tags, sources and dates. Nothing leaves the phone – the catalog is already
                downloaded, so results appear as you type.
              </AppText>
            </ScrollView>
          )
          : null
        : (
          <WallpaperGrid
            items={items}
            thumbFor={thumbnailUrl}
            view="list"
            cols={2}
            isFavorite={isFavorite}
            onOpen={open}
            onToggleFavorite={onToggleFavorite}
            onLongPress={setSheetItem}
            onEndReached={() => setVisible((current) => (current >= results.length ? current : current + PAGE_SIZE))}
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            testID="search-results"
            ListHeaderComponent={
              <AppText variant="caption" tone="faint" style={styles.resultCount}>
                {fmtInt(results.length)} result{results.length === 1 ? '' : 's'} for “{trimmed}”
              </AppText>
            }
            ListEmptyComponent={
              <EmptyState
                icon="search-outline"
                title={`No wallpaper matches “${trimmed}”`}
                body="Try a shorter word, a date like “2024”, or pick a tag instead."
                actionLabel="Browse every tag"
                onAction={() => router.push('/tags')}
              />
            }
            ListFooterComponent={
              items.length < results.length ? (
                <AppText variant="caption" tone="faint" align="center" style={styles.footer}>
                  Showing {fmtInt(items.length)} of {fmtInt(results.length)} · scroll for more
                </AppText>
              ) : null
            }
          />
        )}

      <SetWallpaperSheet item={sheetItem ?? undefined} visible={sheetItem !== null} onClose={() => setSheetItem(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerField: { flex: 1 },
  intro: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  block: { gap: spacing.sm },
  blockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  resultCount: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  footer: { paddingVertical: spacing.xl },
});
