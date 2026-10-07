/**
 * The gallery list itself.
 *
 * `FlashList` in masonry mode gives Pinterest-style columns with view recycling; list mode
 * reuses the same data with a different row component.  Infinite scroll: the screen owns a
 * `visible` counter and this component asks for more when the user nears the end.
 */
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import React, { useCallback, useMemo } from 'react';
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { navigation, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import type { Wallpaper } from '../../core/types';
import { WallpaperCard } from './WallpaperCard';
import { WallpaperRow } from './WallpaperRow';

export interface WallpaperGridProps {
  items: Wallpaper[];
  /** Resolves the remote thumbnail for an item. */
  thumbFor: (item: Wallpaper) => string;
  view: 'grid' | 'list';
  cols: 2 | 3;
  isFavorite: (key: string) => boolean;
  onOpen: (item: Wallpaper) => void;
  onToggleFavorite: (item: Wallpaper) => void;
  onLongPress?: (item: Wallpaper) => void;
  onEndReached?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  ListHeaderComponent?: React.ComponentType<unknown> | React.ReactElement | null;
  ListFooterComponent?: React.ComponentType<unknown> | React.ReactElement | null;
  ListEmptyComponent?: React.ComponentType<unknown> | React.ReactElement | null;
  contentPadding?: number;
  testID?: string;
}

export function WallpaperGrid({
  items,
  thumbFor,
  view,
  cols,
  isFavorite,
  onOpen,
  onToggleFavorite,
  onLongPress,
  onEndReached,
  refreshing,
  onRefresh,
  ListHeaderComponent,
  ListFooterComponent,
  ListEmptyComponent,
  contentPadding = spacing.lg,
  testID,
}: WallpaperGridProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Card width: screen minus the outer padding and the gutters between columns.
  const columnCount = view === 'grid' ? cols : 1;
  const cardWidth = useMemo(() => {
    return Math.floor((width - contentPadding * 2) / columnCount - spacing.xs * 2);
  }, [columnCount, contentPadding, width]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Wallpaper>) => {
      if (view === 'list') {
        return (
          <View style={styles.listItem}>
            <WallpaperRow
              item={item}
              thumb={thumbFor(item)}
              favorite={isFavorite(item.key)}
              onPress={onOpen}
              onToggleFavorite={onToggleFavorite}
            />
          </View>
        );
      }
      return (
        <View style={styles.gridItem}>
          <WallpaperCard
            item={item}
            thumb={thumbFor(item)}
            width={cardWidth}
            favorite={isFavorite(item.key)}
            onPress={onOpen}
            onLongPress={onLongPress}
            onToggleFavorite={onToggleFavorite}
            showBadge={cols === 2}
          />
        </View>
      );
    },
    [cardWidth, cols, isFavorite, onLongPress, onOpen, onToggleFavorite, thumbFor, view],
  );

  return (
    <FlashList
      data={items}
      renderItem={renderItem}
      keyExtractor={(item: Wallpaper) => item.key}
      masonry={view === 'grid'}
      numColumns={columnCount}
      optimizeItemArrangement
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      contentContainerStyle={{ paddingHorizontal: contentPadding, paddingBottom: navigation.contentInset + insets.bottom }}
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={ListFooterComponent}
      ListEmptyComponent={ListEmptyComponent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={Boolean(refreshing)}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        ) : undefined
      }
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  gridItem: {
    padding: spacing.xs,
    paddingBottom: spacing.lg,
    flex: 1,
  },
  listItem: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
  },
});
