/**
 * Wallpaper detail – full-bleed image with the actions that matter.
 *
 * The image is fetched at full resolution (the grid only ever loads thumbnails), the panel
 * below carries the metadata and the action bar is bottom-anchored so it is reachable with
 * one thumb.  Previous/next move through the library in the same order as the gallery.
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToast } from '../../src/components/feedback/ToastProvider';
import { AppText } from '../../src/components/ui/AppText';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { Chip } from '../../src/components/ui/Chip';
import { IconButton } from '../../src/components/ui/IconButton';
import { Touchable } from '../../src/components/ui/Pressable';
import { ErrorState, LoadingState, ProgressBar } from '../../src/components/ui/States';
import { SetWallpaperSheet } from '../../src/components/wallpaper/SetWallpaperSheet';
import { fullImageUrl, thumbnailUrl } from '../../src/services/media';
import { SOURCE_LABELS, fmtBytes, fmtDate, fmtInt, fmtWallpaperSize } from '../../src/core/utils';
import { radius, spacing } from '../../src/theme/tokens';
import { GlassBackdrop } from '../../src/components/ui/GlassBackdrop';
import { useColors, useTheme } from '../../src/theme/ThemeProvider';
import { useWallpaperActions } from '../../src/hooks/useWallpaperActions';
import { useCatalog } from '../../src/providers/CatalogProvider';
import { usePreferences } from '../../src/providers/PreferencesProvider';

export default function WallpaperDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useColors();
  const { reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { show } = useToast();
  const { catalog, loading, error, refresh } = useCatalog();
  const { isFavorite, toggleFavorite } = usePreferences();

  const wallpaperId = Number(id);
  const item = Number.isFinite(wallpaperId) ? catalog?.byId.get(wallpaperId) : undefined;

  const actions = useWallpaperActions(item);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);

  // Previous / next follow the "newest first" order of the library.
  const neighbours = useMemo(() => {
    if (!catalog || !item) return { previous: undefined, next: undefined };
    const ordered = [...catalog.items].sort((a, b) => b.id - a.id);
    const index = ordered.findIndex((entry) => entry.id === item.id);
    if (index < 0) return { previous: undefined, next: undefined };
    return {
      previous: index > 0 ? ordered[index - 1] : undefined,
      next: index < ordered.length - 1 ? ordered[index + 1] : undefined,
    };
  }, [catalog, item]);

  const favorite = item ? isFavorite(item.key) : false;

  const toggleFav = useCallback(() => {
    if (!item) return;
    const added = toggleFavorite(item.key);
    show({ tone: added ? 'success' : 'info', message: added ? 'Added to favourites.' : 'Removed from favourites.' });
  }, [item, show, toggleFavorite]);

  if (loading && !catalog && !error) {
    return <LoadingState message="Opening the library…" />;
  }

  if (!item) {
    return (
      <ErrorState
        title="Wallpaper not found"
        message={
          catalog
            ? 'It is not in the catalog on this device. Refresh the catalog and try again.'
            : 'The catalog is not loaded yet.'
        }
        detail={error ?? undefined}
        onRetry={() => void refresh()}
      />
    );
  }

  const imageHeight = height * 0.56;
  const tags = item.tags.slice(0, 12);

  return (
    <View style={[styles.fill, { backgroundColor: colors.viewer }]}>
      {/* Blurred backdrop so the panel never sits on raw black. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
        {/* The small thumbnail, blurred – cheap, and it is already in the disk cache. */}
        <Image
          source={{ uri: thumbnailUrl(item) }}
          contentFit="cover"
          cachePolicy="memory-disk"
          style={StyleSheet.absoluteFill}
          blurRadius={40}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.viewer }]} />
      </View>

      <View style={[styles.imageWrap, { height: imageHeight }]}>
        <Image
          source={{ uri: fullImageUrl(item) }}
          placeholder={{ uri: thumbnailUrl(item) }}
          placeholderContentFit="contain"
          contentFit="contain"
          transition={reduceMotion ? 0 : 260}
          cachePolicy="memory-disk"
          style={StyleSheet.absoluteFill}
          onLoadStart={() => setImageLoading(true)}
          onLoad={() => {
            setImageLoading(false);
            setImageFailed(false);
          }}
          onError={() => {
            setImageLoading(false);
            setImageFailed(true);
          }}
          accessibilityLabel={item.title}
          accessibilityIgnoresInvertColors
        />
        {imageLoading ? (
          <View style={styles.imageOverlay} pointerEvents="none">
            <ActivityIndicator color={colors.accent} />
            <AppText variant="caption" tone="muted">
              Loading full resolution…
            </AppText>
          </View>
        ) : null}
        {imageFailed ? (
          <View style={styles.imageOverlay}>
            <Ionicons name="alert-circle-outline" size={26} color={colors.warn} />
            <AppText variant="caption" tone="warn" align="center">
              The full-resolution image could not be loaded. Pull to refresh the catalog, or try again on Wi-Fi.
            </AppText>
          </View>
        ) : null}
      </View>

      {/* Top overlay */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <IconButton icon="chevron-back" accessibilityLabel="Go back" onPress={() => (router.canGoBack() ? router.back() : router.push('/'))} translucent />
        <View style={styles.topRight}>
          {neighbours.previous ? (
            <IconButton
              icon="chevron-up"
              accessibilityLabel="Previous wallpaper"
              onPress={() => router.replace(`/wallpaper/${neighbours.previous!.id}`)}
              translucent
            />
          ) : null}
          {neighbours.next ? (
            <IconButton
              icon="chevron-down"
              accessibilityLabel="Next wallpaper"
              onPress={() => router.replace(`/wallpaper/${neighbours.next!.id}`)}
              translucent
            />
          ) : null}
          <IconButton
            icon={favorite ? 'heart' : 'heart-outline'}
            accessibilityLabel={favorite ? 'Remove from favourites' : 'Add to favourites'}
            onPress={toggleFav}
            active={favorite}
            color={favorite ? colors.danger : undefined}
            translucent
          />
        </View>
      </View>

      {/* Bottom panel */}
      <View style={[styles.panel, { paddingBottom: insets.bottom + spacing.lg, borderColor: colors.strokeStrong }]}>
        <GlassBackdrop strength="floating" />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.panelContent}>
          <View style={styles.badges}>
            <Badge label={item.q.toUpperCase()} gradient />
            <Badge label={SOURCE_LABELS[item.source] ?? item.source} tone="neutral" icon="globe-outline" />
            {item.generated ? <Badge label="Auto title" tone="neutral" icon="sparkles-outline" /> : null}
            {favorite ? <Badge label="Favourite" tone="danger" icon="heart" /> : null}
          </View>

          <AppText variant="title" numberOfLines={3}>
            {item.title}
          </AppText>

          <View style={styles.metaGrid}>
            <Meta icon="resize-outline" label="Resolution" value={fmtWallpaperSize(item.raw.width, item.raw.height)} />
            <Meta icon="document-outline" label="File size" value={fmtBytes(item.raw.file_size)} />
            <Meta icon="calendar-outline" label="Spotted" value={item.raw.date_spotted ? fmtDate(item.raw.date_spotted) : '—'} />
            <Meta icon="pricetag-outline" label="Tags" value={fmtInt(item.tags.length)} />
          </View>

          {tags.length ? (
            <View style={styles.tags}>
              {tags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  size="sm"
                  onPress={() => router.push({ pathname: '/', params: { tag } })}
                />
              ))}
            </View>
          ) : null}

          {actions.busy && actions.running === 'apply' ? (
            <View style={styles.progress}>
              <ProgressBar value={actions.progress} />
              <AppText variant="caption" tone="muted">
                Downloading… {Math.round(actions.progress * 100)}%
              </AppText>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button
              title="Set as wallpaper"
              icon="phone-portrait-outline"
              variant="primary"
              size="lg"
              loading={actions.running === 'apply'}
              onPress={() => setSheetOpen(true)}
              testID="open-set-wallpaper"
            />
            <View style={styles.actionRow}>
              <Button title="Save" icon="download-outline" loading={actions.running === 'save'} onPress={() => void actions.save()} style={styles.actionItem} />
              <Button title="Share" icon="share-outline" loading={actions.running === 'share'} onPress={() => void actions.share()} style={styles.actionItem} />
            </View>
            <View style={styles.actionRow}>
              <Button title="Copy link" icon="link-outline" onPress={() => void actions.copyLink()} style={styles.actionItem} />
              <Button
                title="Source"
                icon="open-outline"
                disabled={!item.raw.source_url && !item.raw.page_url}
                onPress={() => void actions.openSource()}
                style={styles.actionItem}
              />
            </View>
          </View>

          <Touchable
            accessibilityRole="button"
            accessibilityLabel="About this collection"
            onPress={() => router.push('/about')}
            style={styles.about}
          >
            <Ionicons name="information-circle-outline" size={15} color={colors.textMuted} />
            <AppText variant="caption" tone="muted">
              Spotlight Studio · {fmtInt(catalog?.total ?? 0)} wallpapers · tap for details
            </AppText>
          </Touchable>
        </ScrollView>
      </View>

      <SetWallpaperSheet item={item} visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  );
}

function Meta({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={14} color={colors.textFaint} />
      <View>
        <AppText variant="caption" tone="faint">
          {label}
        </AppText>
        <AppText variant="label">{value}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  imageWrap: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  topRight: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  panel: {
    position: 'absolute',
    left: spacing.md, right: spacing.md, bottom: spacing.sm,
    maxHeight: '58%',
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  panelContent: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  meta: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    minWidth: 140,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  progress: {
    gap: spacing.sm,
  },
  actions: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionItem: {
    flex: 1,
  },
  about: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
});
