/**
 * Filter sheet: source, resolution class, sort order and the active tag.
 * Mirrors the web sidebar so both clients filter identically (same buckets, same order).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import type { Catalog, CatalogState, SortKey } from '../../core/types';
import { QUALITIES, QUALITY_LABELS, SOURCES, SOURCE_LABELS, SORTS, fmtInt } from '../../core/utils';
import { radius, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';

import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Sheet } from '../ui/Sheet';
import { Touchable } from '../ui/Pressable';

export interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  catalog: Catalog | null;
  state: CatalogState;
  onChange: (patch: Partial<CatalogState>) => void;
  onReset: () => void;
  /** Tags offered in the tag section (already sorted by count). */
  tags: { tag: string; count: number }[];
  resultCount: number;
}

export function FilterSheet({ visible, onClose, catalog, state, onChange, onReset, tags, resultCount }: FilterSheetProps) {
  const sourceCounts = catalog?.sourceCounts ?? {};
  const qualityCounts = catalog?.qualityCounts ?? {};

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filters"
      subtitle={`${fmtInt(resultCount)} ${resultCount === 1 ? 'wallpaper' : 'wallpapers'} match`}
      maxHeightRatio={0.9}
      testID="filter-sheet"
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Section title="Source">
          <View style={styles.chips}>
            <Chip
              label="All sources"
              selected={!state.source}
              onPress={() => onChange({ source: '' })}
            />
            {SOURCES.map((source) => (
              <Chip
                key={source}
                label={SOURCE_LABELS[source] ?? source}
                count={sourceCounts[source]}
                selected={state.source === source}
                onPress={() => onChange({ source: state.source === source ? '' : source })}
              />
            ))}
          </View>
        </Section>

        <Section title="Resolution">
          <View style={styles.chips}>
            <Chip label="Any" selected={!state.quality} onPress={() => onChange({ quality: '' })} />
            {QUALITIES.map((quality) => (
              <Chip
                key={quality}
                label={QUALITY_LABELS[quality]}
                count={qualityCounts[quality]}
                selected={state.quality === quality}
                onPress={() => onChange({ quality: state.quality === quality ? '' : quality })}
              />
            ))}
          </View>
        </Section>

        <Section title="Sort by">
          <View style={styles.chips}>
            {(Object.keys(SORTS) as SortKey[]).map((key) => (
              <Chip
                key={key}
                label={SORTS[key].label}
                selected={state.sort === key}
                onPress={() => onChange({ sort: key })}
              />
            ))}
          </View>
        </Section>

        <Section title="Tag" subtitle="The 40 most used tags">
          <View style={styles.chips}>
            <Chip label="Any tag" selected={!state.tag} onPress={() => onChange({ tag: '' })} />
            {tags.slice(0, 40).map(({ tag, count }) => (
              <Chip
                key={tag}
                label={tag}
                count={count}
                selected={state.tag === tag}
                onPress={() => onChange({ tag: state.tag === tag ? '' : tag })}
              />
            ))}
          </View>
        </Section>

        <View style={styles.actions}>
          <Button title="Reset filters" icon="refresh" variant="secondary" inline onPress={onReset} />
          <Button title="Show results" variant="primary" icon="checkmark" inline onPress={onClose} />
        </View>
      </ScrollView>
    </Sheet>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <AppText variant="caption" tone="faint" style={styles.sectionTitle}>
          {title.toUpperCase()}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="faint">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** Row of chips that toggles `fav` – kept here so the gallery header stays tiny. */
export function FavoritesToggle({ value, count, onToggle }: { value: boolean; count: number; onToggle: () => void }) {
  const colors = useColors();

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityState={{ selected: value }}
      accessibilityLabel={`Favourites only, ${count} saved`}
      onPress={onToggle}
      style={[
        styles.favToggle,
        value
          ? { backgroundColor: colors.dangerFill, borderColor: colors.strokeStrong }
          : { backgroundColor: colors.fill, borderColor: colors.stroke },
      ]}
    >
      <Ionicons name={value ? 'heart' : 'heart-outline'} size={16} color={value ? colors.danger : colors.textMuted} />
      <AppText variant="label" tone={value ? 'danger' : 'muted'}>
        {count > 0 ? `Favourites · ${count}` : 'Favourites'}
      </AppText>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    paddingBottom: spacing.xl,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    letterSpacing: 0.8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  favToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
