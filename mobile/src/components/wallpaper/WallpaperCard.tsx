/**
 * Gallery card – one wallpaper in the masonry grid.
 *
 * The thumbnail is 480×270 on the server side, which is small enough to keep scrolling at
 * 60 fps but sharp on a phone; the full-resolution file is only fetched when the user opens
 * the wallpaper or applies it.
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import type { Wallpaper } from '../../core/types';
import { QUALITY_LABELS } from '../../core/utils';
import { AppText } from '../ui/AppText';
import { Touchable } from '../ui/Pressable';

export interface WallpaperCardProps {
  item: Wallpaper;
  /** Remote thumbnail URL (already resolved by the screen). */
  thumb: string;
  width: number;
  favorite: boolean;
  onPress: (item: Wallpaper) => void;
  onLongPress?: (item: Wallpaper) => void;
  onToggleFavorite?: (item: Wallpaper) => void;
  /** Show the resolution badge (off for very small cards). */
  showBadge?: boolean;
}

function aspectFor(item: Wallpaper): number {
  const w = item.raw.width || 1920;
  const h = item.raw.height || 1080;
  // Clamp so a panorama does not produce a 6-pixel-tall card and a phone shot does not
  // produce a full-screen one – the masonry still looks organic.
  return Math.min(1.9, Math.max(0.72, h / w));
}

export const WallpaperCard = memo(function WallpaperCard({
  item,
  thumb,
  width,
  favorite,
  onPress,
  onLongPress,
  onToggleFavorite,
  showBadge = true,
}: WallpaperCardProps) {
  const colors = useColors();
  const height = Math.round(width * aspectFor(item));

  return (
    <Touchable
      accessibilityRole="imagebutton"
      accessibilityLabel={`${item.title}${item.generated ? '' : ''}, ${QUALITY_LABELS[item.q] ?? item.q}`}
      accessibilityHint="Opens the wallpaper with actions"
      onPress={() => onPress(item)}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      style={[styles.card, { width, height, backgroundColor: colors.surface, borderColor: colors.stroke }]}
    >
      <Image
        source={{ uri: thumb }}
        placeholder={item.raw.source_url ? { uri: thumb } : undefined}
        placeholderContentFit="cover"
        contentFit="cover"
        transition={220}
        cachePolicy="disk"
        recyclingKey={item.key}
        style={StyleSheet.absoluteFill}
        accessibilityIgnoresInvertColors
      />

      <LinearGradient
        colors={['transparent', 'rgba(3,4,8,0.82)']}
        locations={[0.45, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {showBadge ? (
        <View style={[styles.badge, { backgroundColor: 'rgba(3,4,8,0.55)' }]}>
          <AppText variant="caption" style={styles.badgeText}>
            {QUALITY_LABELS[item.q]?.split(' ')[0] ?? item.q.toUpperCase()}
          </AppText>
        </View>
      ) : null}

      {onToggleFavorite ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={favorite ? `Remove ${item.title} from favourites` : `Add ${item.title} to favourites`}
          accessibilityState={{ selected: favorite }}
          hitSlop={8}
          onPress={() => onToggleFavorite(item)}
          style={styles.heart}
        >
          <Ionicons
            name={favorite ? 'heart' : 'heart-outline'}
            size={18}
            color={favorite ? colors.danger : '#ffffff'}
            style={styles.heartIcon}
          />
        </Touchable>
      ) : null}

      <View style={styles.footer} pointerEvents="none">
        <AppText variant="caption" numberOfLines={2} style={styles.title}>
          {item.title}
        </AppText>
      </View>
    </Touchable>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    position: 'absolute',
    top: spacing.sm,
    start: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  badgeText: {
    color: '#ffffff',
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  heart: {
    position: 'absolute',
    top: spacing.xs,
    end: spacing.xs,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartIcon: {
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
  footer: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
  },
  title: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
