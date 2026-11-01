/** Photo-first gallery tile. Captions sit on a quiet surface, never over the photograph. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import React, { memo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
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
  const [loading, setLoading] = useState(true);
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
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.stroke }]}
      >
        <View style={[styles.photo, { height, backgroundColor: colors.surfaceAlt, borderBottomColor: colors.stroke }]}>
          <Image source={{ uri: thumb }} contentFit="cover" transition={reduceMotion ? 0 : durations.normal}
            cachePolicy="disk" recyclingKey={item.key} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors
            onLoadStart={() => setLoading(true)} onLoad={() => setLoading(false)} onError={() => setLoading(false)} />
          {loading ? (
            <View style={[StyleSheet.absoluteFill, styles.spinnerCenter]} pointerEvents="none">
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : null}
          {showBadge ? <View style={[styles.badge, { backgroundColor: colors.imageControl }]}>
            <AppText variant="mono" style={{ color: item.q === '4k' ? colors.imageFavorite : colors.imageText, fontWeight: '600' }}>
              {QUALITY_LABELS[item.q]?.split(' ')[0] ?? item.q.toUpperCase()}
            </AppText>
          </View> : null}
        </View>
        <View style={styles.footer}>
          <AppText variant="label" numberOfLines={2}>{item.title}</AppText>
          <AppText variant="caption" tone="faint" numberOfLines={1}>
            {item.source === 'peapix' ? 'Peapix' : 'Windows Spotlight'} · {item.raw.width} × {item.raw.height}
          </AppText>
        </View>
      </Touchable>
      {onToggleFavorite ? <Touchable
        accessibilityRole="button"
        accessibilityLabel={favorite ? `Remove ${item.title} from favourites` : `Add ${item.title} to favourites`}
        accessibilityState={{ selected: favorite }}
        onPress={() => onToggleFavorite(item)}
        style={[styles.heart, { backgroundColor: colors.imageControl }]}
      ><Ionicons name={favorite ? 'heart' : 'heart-outline'} size={17} color={favorite ? colors.imageFavorite : colors.imageText} /></Touchable> : null}
    </View>
  );
});
const styles = StyleSheet.create({
  card: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  photo: { overflow: 'hidden', borderBottomWidth: StyleSheet.hairlineWidth },
  spinnerCenter: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: spacing.sm, start: spacing.sm,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  heart: { position: 'absolute', top: spacing.xs, end: spacing.xs,
    width: TOUCH_TARGET, height: TOUCH_TARGET, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: 10, paddingVertical: spacing.sm, gap: 2, minHeight: 56 },
});
