/** A quiet daily discovery card. Only its thumbnail loads until the user opens it. */
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { Wallpaper } from '../../core/types';
import { QUALITY_LABELS, SOURCE_LABELS } from '../../core/utils';
import { thumbnailUrl } from '../../services/media';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing, TOUCH_TARGET } from '../../theme/tokens';
import { AppText } from '../ui/AppText';
import { Touchable } from '../ui/Pressable';

export function DailySpotlight({ item, favorite, onOpen, onToggleFavorite }: {
  item: Wallpaper; favorite: boolean; onOpen: (item: Wallpaper) => void; onToggleFavorite: (item: Wallpaper) => void;
}) {
  const { colors, reduceMotion } = useTheme();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const utcDay = new Date().toISOString().slice(0, 10);
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.stroke }]} testID="daily-spotlight">
    <Touchable onPress={() => onOpen(item)} accessibilityRole="button" accessibilityLabel={`Daily spotlight: ${item.title}`}
      accessibilityHint="Opens today's wallpaper" style={[styles.photo, { backgroundColor: colors.surfaceAlt, borderBottomColor: colors.stroke }]}>
      <Image source={{ uri: thumbnailUrl(item) }} contentFit="cover" cachePolicy="disk" recyclingKey={item.key}
        transition={reduceMotion ? 0 : 150} style={StyleSheet.absoluteFill}
        onLoadStart={() => { setLoading(true); setFailed(false); }}
        onError={() => { setLoading(false); setFailed(true); }}
        onLoad={() => { setLoading(false); setFailed(false); }} />
      {loading && !failed ? (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]} pointerEvents="none">
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : null}
      {failed ? <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: colors.surfaceAlt }]}>
        <Ionicons name="image-outline" size={26} color={colors.textFaint} />
        <AppText variant="caption" tone="muted">Preview unavailable · tap to open</AppText>
      </View> : null}
    </Touchable>
    <View style={styles.caption}>
      <View style={styles.words}>
        <View style={styles.kickerRow}>
          <View style={[styles.dot, { backgroundColor: colors.accent }]} />
          <AppText variant="caption" tone="accent" style={styles.kicker}>Daily spotlight</AppText>
          <AppText variant="mono" tone="faint">{utcDay} UTC</AppText>
        </View>
        <AppText variant="subheading" numberOfLines={2}>{item.title}</AppText>
        <AppText variant="caption" tone="muted">
          {SOURCE_LABELS[item.source] || item.source} · {QUALITY_LABELS[item.q]} · {item.raw.width} × {item.raw.height}
        </AppText>
      </View>
      <Touchable onPress={() => onToggleFavorite(item)} accessibilityRole="button"
        accessibilityLabel={favorite ? 'Remove daily wallpaper from favourites' : 'Add daily wallpaper to favourites'}
        accessibilityState={{ selected: favorite }}
        style={[styles.heart, { borderColor: favorite ? colors.accent : colors.stroke, backgroundColor: favorite ? colors.accentFill : colors.fill }]}>
        <Ionicons name={favorite ? 'heart' : 'heart-outline'} size={20} color={favorite ? colors.accent : colors.textMuted} />
      </Touchable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, marginBottom: spacing.lg },
  photo: { aspectRatio: 16 / 9, borderBottomWidth: StyleSheet.hairlineWidth },
  caption: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.md },
  words: { flex: 1, gap: spacing.xs },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  kicker: { fontWeight: '600', marginEnd: 4 },
  heart: { width: TOUCH_TARGET, height: TOUCH_TARGET, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', alignItems: 'center' },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
});
