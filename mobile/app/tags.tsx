/**
 * Tag index – every tag in the catalog with its count, searchable.
 *
 * The catalog holds thousands of tags, so the list is virtualised and filtered in memory.
 * Picking a tag opens the gallery through the same `?tag=` deep link Browse already
 * understands, which means this screen works from anywhere (tab, modal, shared link).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '../src/components/ui/AppText';
import { IconButton } from '../src/components/ui/IconButton';
import { Touchable } from '../src/components/ui/Pressable';
import { EmptyState, LoadingState } from '../src/components/ui/States';
import { TextField } from '../src/components/ui/TextField';
import { fmtInt } from '../src/core/utils';
import { useCatalog } from '../src/providers/CatalogProvider';
import { spacing } from '../src/theme/tokens';
import { useColors } from '../src/theme/ThemeProvider';

interface TagRow {
  tag: string;
  count: number;
}

export default function TagsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { catalog, loading } = useCatalog();
  const [query, setQuery] = useState('');

  const allTags = useMemo<TagRow[]>(() => {
    if (!catalog) return [];
    return [...catalog.tagCount.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [catalog]);

  const needle = query.trim().toLowerCase();
  const visible = useMemo<TagRow[]>(() => {
    if (!needle) return allTags;
    return allTags.filter((row) => row.tag.includes(needle));
  }, [allTags, needle]);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.push('/');
  }, [router]);

  const open = useCallback(
    (tag: string) => {
      router.push({ pathname: '/', params: { tag } });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<TagRow>) => (
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={`Tag ${item.tag}, ${item.count} wallpapers`}
        onPress={() => open(item.tag)}
        style={[styles.row, { borderBottomColor: colors.stroke }]}
        testID={`tag-row-${item.tag}`}
      >
        <Ionicons name="pricetag-outline" size={16} color={colors.textMuted} />
        <AppText variant="body" numberOfLines={1} style={styles.rowLabel}>
          #{item.tag}
        </AppText>
        <AppText variant="caption" tone="faint">
          {fmtInt(item.count)}
        </AppText>
        <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
      </Touchable>
    ),
    [colors.stroke, colors.textFaint, colors.textMuted, open],
  );

  return (
    <View style={styles.fill}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={back} />
        <View style={styles.headerText}>
          <AppText variant="heading">Tags</AppText>
          <AppText variant="caption" tone="faint">
            {allTags.length
              ? `${fmtInt(allTags.length)} tags · ${fmtInt(visible.length)} shown`
              : 'The catalog has not been loaded yet'}
          </AppText>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.search}>
        <TextField
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder="Filter tags…"
          accessibilityLabel="Filter tags"
          testID="tag-filter"
        />
      </View>

      {!catalog && loading ? (
        <LoadingState message="Loading the wallpaper catalog…" />
      ) : (
        <FlashList<TagRow>
          data={visible}
          renderItem={renderItem}
          keyExtractor={(item) => item.tag}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          testID="tag-list"
          ListEmptyComponent={
            allTags.length ? (
              <EmptyState
                icon="pricetags-outline"
                title={`No tag contains “${query.trim()}”`}
                body="Tags are single words taken from the source metadata – try a shorter fragment."
                actionLabel="Clear the filter"
                onAction={() => setQuery('')}
              />
            ) : (
              <EmptyState icon="cloud-offline-outline" title="Nothing to list yet" body="Load the catalog first, then come back." />
            )
          }
        />
      )}
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
  },
  headerText: { flex: 1 },
  headerSpacer: { width: 40 },
  search: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  list: { paddingBottom: spacing.xxxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flex: 1 },
});
