/**
 * Browse – the gallery.
 *
 * Search runs over the in-memory catalog (7,500 rows, ~5 ms) so results appear as you type;
 * the list itself is virtualised and grows 60 items at a time.  Filters live in component
 * state and can be seeded from a deep link (`?tag=sunset`) so shared links open filtered.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToast } from '../../src/components/feedback/ToastProvider';
import { AppText } from '../../src/components/ui/AppText';
import { Chip } from '../../src/components/ui/Chip';
import { IconButton } from '../../src/components/ui/IconButton';
import { ScreenHeader } from '../../src/components/ui/ScreenHeader';
import { Segmented } from '../../src/components/ui/Segmented';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ui/States';
import { TextField } from '../../src/components/ui/TextField';
import { FilterSheet, FavoritesToggle } from '../../src/components/wallpaper/FilterSheet';
import { SetWallpaperSheet } from '../../src/components/wallpaper/SetWallpaperSheet';
import { TagRail } from '../../src/components/wallpaper/TagRail';
import { WallpaperGrid } from '../../src/components/wallpaper/WallpaperGrid';
import { thumbnailUrl } from '../../src/services/media';
import {
  DEFAULT_STATE,
  QUALITY_LABELS,
  SOURCE_LABELS,
  decodeState,
  filterAndSort,
  fmtInt,
  topTags,
} from '../../src/core/utils';
import type { CatalogState, Wallpaper } from '../../src/core/types';
import { spacing } from '../../src/theme/tokens';
import { useDebouncedValue } from '../../src/hooks/useDebouncedValue';
import { useCatalog } from '../../src/providers/CatalogProvider';
import { usePreferences } from '../../src/providers/PreferencesProvider';

const PAGE_SIZE = 60;

export default function BrowseScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string>>();
  const insets = useSafeAreaInsets();
  const { show } = useToast();
  const { catalog, loading, refreshing, error, refresh, tags } = useCatalog();
  const { favorites, favoritesVersion, isFavorite, toggleFavorite } = usePreferences();

  const [filters, setFilters] = useState<CatalogState>(() => ({ ...DEFAULT_STATE, ...decodeState(params) }));
  const [query, setQuery] = useState(filters.q);
  const debouncedQuery = useDebouncedValue(query, 240);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sheetItem, setSheetItem] = useState<Wallpaper | null>(null);

  const effective = useMemo<CatalogState>(() => ({ ...filters, q: debouncedQuery }), [debouncedQuery, filters]);

  const filtered = useMemo(() => {
    if (!catalog) return [] as Wallpaper[];
    void favoritesVersion; // favourites change ⇒ re-filter
    return filterAndSort(catalog, effective, favorites);
  }, [catalog, effective, favorites, favoritesVersion]);

  // Deep links (`/?tag=sunset`, a shared link from the detail screen …) re-seed the filters
  // even when the gallery is already mounted.
  const paramTag = typeof params.tag === 'string' ? params.tag : '';
  const paramSource = typeof params.source === 'string' ? params.source : '';
  const paramQuality = typeof params.quality === 'string' ? params.quality : '';
  const paramQuery = typeof params.q === 'string' ? params.q : '';
  useEffect(() => {
    if (!paramTag && !paramSource && !paramQuality && !paramQuery) return;
    const seeded = decodeState({ tag: paramTag, source: paramSource, quality: paramQuality, q: paramQuery });
    const patchFromLink: Partial<CatalogState> = {};
    if (paramTag) patchFromLink.tag = seeded.tag;
    if (paramSource) patchFromLink.source = seeded.source;
    if (paramQuality) patchFromLink.quality = seeded.quality;
    if (paramQuery) patchFromLink.q = paramQuery;
    // Deferred by a tick: the effect body itself must not trigger a render.
    const timer = setTimeout(() => {
      setFilters((current) => ({ ...current, ...patchFromLink }));
      setVisible(PAGE_SIZE);
      if (paramQuery) setQuery(paramQuery);
    }, 0);
    return () => clearTimeout(timer);
  }, [paramQuality, paramQuery, paramSource, paramTag]);

  const items = useMemo(() => filtered.slice(0, visible), [filtered, visible]);
  const railTags = useMemo(() => {
    if (!catalog) return [];
    return topTags(catalog, 24).map(([tag, count]) => ({ tag, count }));
  }, [catalog]);

  const patch = useCallback((next: Partial<CatalogState>) => {
    setFilters((current) => ({ ...current, ...next }));
    // A different filter means a different list: start it at the top again.
    setVisible(PAGE_SIZE);
  }, []);

  const reset = useCallback(() => {
    setFilters(DEFAULT_STATE);
    setQuery('');
    setVisible(PAGE_SIZE);
  }, []);

  const open = useCallback(
    (item: Wallpaper) => {
      router.push(`/wallpaper/${item.id}`);
    },
    [router],
  );

  const onToggleFavorite = useCallback(
    (item: Wallpaper) => {
      const added = toggleFavorite(item.key);
      show({ tone: added ? 'success' : 'info', message: added ? `Added “${item.title}” to favourites.` : 'Removed from favourites.' });
    },
    [show, toggleFavorite],
  );

  const random = useCallback(() => {
    if (!filtered.length) {
      show({ tone: 'warning', message: 'No wallpaper matches the current filters.' });
      return;
    }
    const pick = filtered[Math.floor(Math.random() * filtered.length)];
    router.push(`/wallpaper/${pick.id}`);
  }, [filtered, router, show]);

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (debouncedQuery) {
      chips.push({
        key: 'q',
        label: `\u201c${debouncedQuery}\u201d`,
        onRemove: () => {
          setQuery('');
          patch({ q: '' });
        },
      });
    }
    if (filters.source) chips.push({ key: 'source', label: SOURCE_LABELS[filters.source] ?? filters.source, onRemove: () => patch({ source: '' }) });
    if (filters.quality) chips.push({ key: 'quality', label: QUALITY_LABELS[filters.quality] ?? filters.quality, onRemove: () => patch({ quality: '' }) });
    if (filters.tag) chips.push({ key: 'tag', label: `#${filters.tag}`, onRemove: () => patch({ tag: '' }) });
    return chips;
  }, [debouncedQuery, filters.quality, filters.source, filters.tag, patch]);

  if (loading && !catalog) {
    return (
      <View style={styles.fill}>
        <LoadingState message="Loading the wallpaper catalog…" />
      </View>
    );
  }

  if (!catalog && error) {
    return (
      <View style={styles.fill}>
        <ErrorState
          title="The catalog could not be loaded"
          message="Spotlight Studio keeps working offline once a catalog has been downloaded. Check your connection and try again."
          detail={error}
          onRetry={() => void refresh()}
        />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <View style={{ paddingTop: insets.top }}>
        <ScreenHeader
          title="Wallpapers"
          subtitle={`${fmtInt(filtered.length)} of ${fmtInt(catalog?.total ?? 0)} wallpapers`}
          actions={
            <>
              <IconButton icon="search" accessibilityLabel="Search wallpapers" onPress={() => router.push('/search')} translucent testID="open-search" />
              <IconButton icon="shuffle" accessibilityLabel="Open a random wallpaper" onPress={random} translucent />
              <IconButton
                icon="options-outline"
                accessibilityLabel="Filters and sorting"
                onPress={() => setFilterOpen(true)}
                active={Boolean(filters.source || filters.quality || filters.tag || filters.sort !== DEFAULT_STATE.sort)}
                translucent
              />
            </>
          }
        >
          <TextField
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              patch({ q: text });
            }}
            placeholder="Search titles, tags, dates…"
            accessibilityLabel="Search wallpapers"
            testID="search-field"
          />
          <View style={styles.controls}>
            <FavoritesToggle value={filters.fav} count={favorites.size} onToggle={() => patch({ fav: !filters.fav })} />
            <Segmented
              options={[
                { value: 'grid', label: 'Grid' },
                { value: 'list', label: 'List' },
              ]}
              value={filters.view}
              onChange={(view) => patch({ view: view as CatalogState['view'] })}
              testID="view-toggle"
            />
            {filters.view === 'grid' ? (
              <Segmented
                options={[
                  { value: '2', label: '2' },
                  { value: '3', label: '3' },
                ]}
                value={String(filters.cols)}
                onChange={(cols) => patch({ cols: Number(cols) === 3 ? 3 : 2 })}
                accessibilityLabel="Columns"
              />
            ) : null}
          </View>
        </ScreenHeader>
      </View>

      <TagRail
        tags={railTags}
        selected={filters.tag}
        onSelect={(tag) => patch({ tag })}
        onOpenAll={() => router.push('/tags')}
      />

      {activeChips.length ? (
        <View style={styles.activeChips}>
          {activeChips.map((chip) => (
            <Chip key={chip.key} label={chip.label} selected size="sm" onRemove={chip.onRemove} onPress={chip.onRemove} />
          ))}
          <Chip label="Clear all" icon="close-circle-outline" size="sm" onPress={reset} />
        </View>
      ) : null}

      {error && catalog ? (
        <View style={styles.banner}>
          <Ionicons name="cloud-offline-outline" size={15} color="#fbbf24" />
          <AppText variant="caption" tone="warn" numberOfLines={2} style={styles.bannerText}>
            {error}
          </AppText>
        </View>
      ) : null}

      <WallpaperGrid
        items={items}
        thumbFor={(item) => thumbnailUrl(item)}
        view={filters.view}
        cols={filters.cols}
        isFavorite={isFavorite}
        onOpen={open}
        onToggleFavorite={onToggleFavorite}
        onLongPress={setSheetItem}
        onEndReached={() => setVisible((current) => (current >= filtered.length ? current : current + PAGE_SIZE))}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        ListEmptyComponent={
          <EmptyState
            icon="search-outline"
            title="No wallpapers match"
            body="Try a shorter search, a different tag or reset the filters."
            actionLabel="Reset filters"
            onAction={reset}
          />
        }
        ListFooterComponent={
          items.length < filtered.length ? (
            <View style={styles.footer}>
              <AppText variant="caption" tone="faint" align="center">
                Showing {fmtInt(items.length)} of {fmtInt(filtered.length)} · scroll for more
              </AppText>
            </View>
          ) : (
            <View style={styles.footer}>
              <AppText variant="caption" tone="faint" align="center">
                That is all {fmtInt(filtered.length)} wallpaper{filtered.length === 1 ? '' : 's'}.
              </AppText>
            </View>
          )
        }
      />

      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        catalog={catalog}
        state={filters}
        onChange={patch}
        onReset={reset}
        tags={tags}
        resultCount={filtered.length}
      />

      <SetWallpaperSheet item={sheetItem ?? undefined} visible={sheetItem !== null} onClose={() => setSheetItem(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  activeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
  },
  bannerText: { flex: 1 },
  footer: { paddingVertical: spacing.xl },
});
