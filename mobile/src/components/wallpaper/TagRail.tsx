/** Horizontally scrolling tag chips (the most used tags of the library). */
import React, { memo } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { spacing } from '../../theme/tokens';
import { Chip } from '../ui/Chip';

export interface TagRailProps {
  tags: { tag: string; count: number }[];
  selected?: string;
  onSelect: (tag: string) => void;
  /** Also offer a "clear" chip when a tag is selected. */
  showAll?: boolean;
  /** When given, a trailing chip opens the full tag index. */
  onOpenAll?: () => void;
}

export const TagRail = memo(function TagRail({ tags, selected, onSelect, showAll = true, onOpenAll }: TagRailProps) {
  const { fontScale } = useWindowDimensions();
  if (!tags.length) return null;
  return (
    <ScrollView
      horizontal
      style={{ flexGrow: 0, flexShrink: 0, height: Math.max(60, Math.ceil(44 * fontScale + 16)) }}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {showAll ? (
        <Chip
          label={onOpenAll ? 'All' : 'All tags'}
          icon="pricetags-outline"
          selected={!selected}
          onPress={() => onSelect('')}
          size="sm"
        />
      ) : null}
      {tags.map(({ tag, count }) => (
        <Chip
          key={tag}
          label={tag}
          count={count}
          size="sm"
          selected={selected === tag}
          onPress={() => onSelect(selected === tag ? '' : tag)}
        />
      ))}
      {onOpenAll ? (
        <Chip label="Browse all tags" icon="chevron-forward" onPress={onOpenAll} size="sm" testID="tag-rail-all" />
      ) : null}
      <View style={styles.spacer} />
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  content: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  spacer: {
    width: spacing.sm,
  },
});
