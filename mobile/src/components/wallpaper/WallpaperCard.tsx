/** Photo-first gallery tile. Captions sit on a quiet surface, never over the photograph. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { durations, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { Wallpaper } from '../../core/types';
import { QUALITY_LABELS } from '../../core/utils';
import { AppText } from '../ui/AppText';
import { Touchable } from '../ui/Pressable';

export interface WallpaperCardProps {
  item: Wallpaper;
  thumb: string;
  width: number;
  favorite: boolean;
  onPress: (item: Wallpaper) => void;
  onLongPress?: (item: Wallpaper) => void;
  onToggleFavorite?: (item: Wallpaper) => void;
  showBadge?: boolean;
}

export const WallpaperCard = memo(function WallpaperCard({ item, thumb, width, favorite, onPress,
  onLongPress, onToggleFavorite, showBadge = true }: WallpaperCardProps) {
  const { colors, reduceMotion } = useTheme();
  const ratio = (item.raw.height || 1080) / (item.raw.width || 1920);
  const height = Math.round(width * Math.min(1.4, Math.max(0.72, ratio)));
  return (
    <View style={{ width }}>
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${QUALITY_LABELS[item.q] ?? item.q}`}
        accessibilityHint="Opens the wallpaper with actions"
        onPress={() => onPress(item)}
        onLongPress={onLongPress ? () => onLongPress(item) : undefined}
        style={styles.card}
      >
        <View style={[styles.photo, { height, backgroundColor: colors.fill }]}>
          <Image source={{ uri: thumb }} contentFit="cover" transition={reduceMotion ? 0 : durations.normal}
            cachePolicy="disk" recyclingKey={item.key} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />
          {showBadge ? <View style={[styles.badge, { backgroundColor: colors.imageControl }]}>
            <AppText variant="caption" style={{ color: colors.imageText }}>{QUALITY_LABELS[item.q]?.split(' ')[0] ?? item.q.toUpperCase()}</AppText>
          </View> : null}
        </View>
        <View style={styles.footer}>
          <AppText variant="label" numberOfLines={2}>{item.title}</AppText>
          <AppText variant="caption" tone="faint" numberOfLines={1}>
            {item.source === 'peapix' ? 'Peapix' : 'Windows Spotlight'}
          </AppText>
        </View>
      </Touchable>
      {onToggleFavorite ? <Touchable
        accessibilityRole="button"
        accessibilityLabel={favorite ? `Remove ${item.title} from favourites` : `Add ${item.title} to favourites`}
        accessibilityState={{ selected: favorite }}
        onPress={() => onToggleFavorite(item)}
        style={[styles.heart, { backgroundColor: colors.imageControl }]}
      ><Ionicons name={favorite ? 'heart' : 'heart-outline'} size={18} color={favorite ? colors.imageFavorite : colors.imageText} /></Touchable> : null}
    </View>
  );
});
const styles = StyleSheet.create({
  card: { borderRadius: radius.md },
  photo: { borderRadius: radius.md, overflow: 'hidden' },
  badge: { position: 'absolute', bottom: spacing.sm, start: spacing.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  heart: { position: 'absolute', top: spacing.xs, end: spacing.xs,
    width: TOUCH_TARGET, height: TOUCH_TARGET, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center' },
  footer: { paddingTop: spacing.sm, gap: spacing.xs, minHeight: 58 },
});
