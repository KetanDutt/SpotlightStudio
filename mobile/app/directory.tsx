/**
 * Directory – the library at a glance.
 *
 * Everything here is derived from the catalog that is already on the device: where the
 * pictures come from, how they spread across the resolution classes, the tag index, and the
 * export actions (JSON for the crawler, CSV for a spreadsheet).  Tapping a source, a
 * resolution or a tag opens the gallery pre-filtered through the same deep-link mechanism
 * the shared links use.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToast } from '../src/components/feedback/ToastProvider';
import { AppText } from '../src/components/ui/AppText';
import { IconButton } from '../src/components/ui/IconButton';
import { Row, SectionCard } from '../src/components/ui/SectionCard';
import { LoadingState } from '../src/components/ui/States';
import { TagRail } from '../src/components/wallpaper/TagRail';
import { SOURCES, SOURCE_LABELS, QUALITIES, QUALITY_LABELS, fmtInt, fmtRelative, topTags } from '../src/core/utils';
import { useCatalog } from '../src/providers/CatalogProvider';
import { describeExport, exportCatalogCsv, exportCatalogJson } from '../src/services/export';
import { spacing } from '../src/theme/tokens';

const TAG_RAIL_LIMIT = 24;

export default function DirectoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { show } = useToast();
  const { catalog, meta, loading } = useCatalog();
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null);

  const total = catalog?.total ?? 0;
  const share = useCallback((count: number) => (total ? `${((count / total) * 100).toFixed(1)}%` : undefined), [total]);

  const railTags = useMemo(() => {
    if (!catalog) return [];
    return topTags(catalog, TAG_RAIL_LIMIT).map(([tag, count]) => ({ tag, count }));
  }, [catalog]);

  const browse = useCallback(
    (params: Record<string, string>) => {
      router.push({ pathname: '/', params });
    },
    [router],
  );

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.push('/');
  }, [router]);

  const random = useCallback(() => {
    if (!catalog?.items.length) {
      show({ tone: 'warning', message: 'The catalog is still empty.' });
      return;
    }
    const pick = catalog.items[Math.floor(Math.random() * catalog.items.length)];
    router.push(`/wallpaper/${pick.id}`);
  }, [catalog, router, show]);

  const runExport = useCallback(
    async (kind: 'json' | 'csv') => {
      if (!catalog) return;
      setBusy(kind);
      try {
        const result = kind === 'json' ? await exportCatalogJson(catalog.items) : await exportCatalogCsv(catalog.items);
        if (result.ok) {
          show({
            tone: 'success',
            title: kind === 'json' ? 'Catalog exported as JSON' : 'Catalog exported as CSV',
            message: `${result.value.name} · ${describeExport(result.value)}`,
          });
        } else {
          show({ tone: 'error', title: 'Export failed', message: result.error });
        }
      } finally {
        setBusy(null);
      }
    },
    [catalog, show],
  );

  const originLabel =
    meta.origin === 'local-api'
      ? `Your server · ${meta.baseUrl}`
      : meta.origin === 'remote'
        ? 'Published catalog, cached on this device'
        : meta.origin === 'bundled'
          ? 'Offline copy bundled with the app'
          : 'Not loaded yet';

  return (
    <View style={styles.fill}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={back} translucent />
        <View style={styles.headerText}>
          <AppText variant="heading">Directory</AppText>
          <AppText variant="caption" tone="faint">
            {catalog ? `${fmtInt(total)} wallpapers · ${fmtInt(railTags.length ? catalog.tagCount.size : 0)} tags` : 'Loading…'}
          </AppText>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {!catalog && loading ? <LoadingState message="Loading the wallpaper catalog…" /> : null}

      {catalog ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* ── Library ─────────────────────────────────────────────────── */}
          <SectionCard title="Library">
            <Row icon="images-outline" title="Wallpapers" value={fmtInt(total)} subtitle={`${fmtInt(SOURCES.length)} sources · ${fmtInt(catalog.tagCount.size)} distinct tags`} />
            <Row
              icon="cloud-outline"
              title="Catalog source"
              subtitle={originLabel}
              value={meta.loadedAt ? fmtRelative(new Date(meta.loadedAt).toISOString()) : undefined}
            />
            <Row
              icon="calendar-outline"
              title="Newest addition"
              subtitle={catalog.newestAdded ? new Date(catalog.newestAdded).toDateString() : 'Unknown'}
            />
            <Row icon="shuffle" title="Open a random wallpaper" subtitle="Ignores every filter" onPress={random} divider />
          </SectionCard>

          {/* ── Sources ─────────────────────────────────────────────────── */}
          <SectionCard title="Sources" footer="Tap a source to open the gallery filtered to it.">
            {SOURCES.map((source, index) => (
              <Row
                key={source}
                icon="cloud-download-outline"
                title={SOURCE_LABELS[source] ?? source}
                subtitle={source}
                value={fmtInt(catalog.sourceCounts[source] ?? 0)}
                right={
                  <AppText variant="caption" tone="faint">
                    {share(catalog.sourceCounts[source] ?? 0)}
                  </AppText>
                }
                onPress={() => browse({ source })}
                divider={index < SOURCES.length - 1}
              />
            ))}
          </SectionCard>

          {/* ── Resolution classes ──────────────────────────────────────── */}
          <SectionCard
            title="Resolution classes"
            footer="Same buckets as the web gallery: 4K ≥ 3840 px wide, 2K ≥ 2560, Full HD ≥ 1920, HD ≥ 1280, otherwise SD."
          >
            {QUALITIES.map((quality, index) => (
              <Row
                key={quality}
                icon="resize-outline"
                title={QUALITY_LABELS[quality] ?? quality}
                value={fmtInt(catalog.qualityCounts[quality] ?? 0)}
                onPress={() => browse({ quality })}
                divider={index < QUALITIES.length - 1}
                testID={`quality-${quality}`}
              />
            ))}
          </SectionCard>

          {/* ── Tags ────────────────────────────────────────────────────── */}
          <SectionCard title="Tags" footer="Only tags used by a real share of the library are used for generated titles.">
            <View style={styles.rail}>
              <TagRail tags={railTags} onSelect={(tag) => browse({ tag })} showAll={false} />
            </View>
            <Row
              icon="pricetags-outline"
              title="Browse every tag"
              subtitle={`All ${fmtInt(catalog.tagCount.size)} tags with their counts`}
              onPress={() => router.push('/tags')}
              divider={false}
            />
          </SectionCard>

          {/* ── Export ──────────────────────────────────────────────────── */}
          <SectionCard
            title="Export"
            footer="Exports are written to the app cache and handed to the system share sheet – nothing is uploaded."
          >
            <Row
              icon="document-text-outline"
              title="Export catalog as JSON"
              subtitle="The exact shape of data/wallpapers.json, ready for the crawler"
              onPress={() => void runExport('json')}
              value={busy === 'json' ? 'Working…' : undefined}
              disabled={busy !== null}
              testID="export-json"
            />
            <Row
              icon="grid-outline"
              title="Export catalog as CSV"
              subtitle="One row per wallpaper with titles, tags, sizes and links"
              onPress={() => void runExport('csv')}
              value={busy === 'csv' ? 'Working…' : undefined}
              disabled={busy !== null}
              divider
              testID="export-csv"
            />
          </SectionCard>

          <View style={styles.legend}>
            <Ionicons name="information-circle-outline" size={15} color="#7f8ea8" />
            <AppText variant="caption" tone="faint" style={styles.legendText}>
              Filters apply to the gallery: a source, a resolution class or a tag opens Browse with that filter already set.
            </AppText>
          </View>
        </ScrollView>
      ) : null}
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
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
    paddingBottom: spacing.xxxl * 2,
  },
  rail: { paddingVertical: spacing.sm },
  legend: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  legendText: { flex: 1 },
});
