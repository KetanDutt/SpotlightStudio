/** List-mode row: thumbnail + title + metadata. */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import type { Wallpaper } from '../../core/types';
import { QUALITY_LABELS, fmtBytes, fmtDate, fmtWallpaperSize } from '../../core/utils';
import { AppText } from '../ui/AppText';
import { Touchable } from '../ui/Pressable';

export interface WallpaperRowProps {
  item: Wallpaper;
  thumb: string;
  favorite: boolean;
  onPress: (item: Wallpaper) => void;
  onToggleFavorite?: (item: Wallpaper) => void;
}

export const WallpaperRow = memo(function WallpaperRow({ item, thumb, favorite, onPress, onToggleFavorite }: WallpaperRowProps) {
  const colors = useColors();
  const meta = [QUALITY_LABELS[item.q] ?? item.q, fmtWallpaperSize(item.raw.width, item.raw.height).split(' · ')[0], fmtBytes(item.raw.file_size)]
    .filter(Boolean)
    .join(' · ');

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${meta}`}
      onPress={() => onPress(item)}
      plain
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.stroke }]}
    >
      <Image
        source={{ uri: thumb }}
        contentFit="cover"
        transition={180}
        cachePolicy="disk"
        recyclingKey={item.key}
        style={[styles.thumb, { backgroundColor: colors.fill }]}
        accessibilityIgnoresInvertColors
      />
      <View style={styles.text}>
        <AppText variant="subheading" numberOfLines={2}>
          {item.title}
        </AppText>
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {meta}
        </AppText>
        <AppText variant="caption" tone="faint" numberOfLines={1}>
          {item.raw.date_spotted ? fmtDate(item.raw.date_spotted) : ''}
          {item.raw.date_spotted && item.raw.source ? ' · ' : ''}
          {item.raw.source === 'peapix' ? 'Peapix' : 'Windows 10 Spotlight'}
        </AppText>
      </View>
      {onToggleFavorite ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={favorite ? 'Remove from favourites' : 'Add to favourites'}
          accessibilityState={{ selected: favorite }}
          hitSlop={10}
          onPress={() => onToggleFavorite(item)}
          style={styles.heart}
        >
          <Ionicons name={favorite ? 'heart' : 'heart-outline'} size={20} color={favorite ? colors.danger : colors.textMuted} />
        </Touchable>
      ) : null}
    </Touchable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 92,
    height: 62,
    borderRadius: radius.md,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  heart: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
