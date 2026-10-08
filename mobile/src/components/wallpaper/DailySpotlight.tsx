/** A quiet daily discovery card. Only its thumbnail loads until the user opens it. */
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
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
  return <View style={[styles.card, { backgroundColor: colors.glassSecondary, borderColor: colors.stroke }]} testID="daily-spotlight">
    <Touchable onPress={() => onOpen(item)} accessibilityRole="button" accessibilityLabel={`Daily spotlight: ${item.title}`}
      accessibilityHint="Opens today's wallpaper" style={styles.photo}>
      <Image source={{ uri: thumbnailUrl(item) }} contentFit="cover" cachePolicy="disk" recyclingKey={item.key}
        transition={reduceMotion ? 0 : 150} style={StyleSheet.absoluteFill} onError={() => setFailed(true)} onLoad={() => setFailed(false)} />
      {failed ? <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: colors.fill }]}>
        <Ionicons name="image-outline" size={28} color={colors.textFaint} />
        <AppText variant="caption" tone="muted">Preview unavailable · tap to open</AppText>
      </View> : null}
    </Touchable>
    <View style={styles.caption}>
      <View style={styles.words}>
        <AppText variant="caption" tone="accent">DAILY SPOTLIGHT</AppText>
        <AppText variant="subheading" numberOfLines={2}>{item.title}</AppText>
        <AppText variant="caption" tone="muted">{SOURCE_LABELS[item.source] || item.source} · {QUALITY_LABELS[item.q]} · changes at midnight UTC</AppText>
      </View>
      <Touchable onPress={() => onToggleFavorite(item)} accessibilityRole="button"
        accessibilityLabel={favorite ? 'Remove daily wallpaper from favourites' : 'Add daily wallpaper to favourites'}
        accessibilityState={{ selected: favorite }} style={styles.heart}>
        <Ionicons name={favorite ? 'heart' : 'heart-outline'} size={22} color={favorite ? colors.danger : colors.textMuted} />
      </Touchable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, marginBottom: spacing.lg },
  photo: { aspectRatio: 16 / 9 },
  caption: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  words: { flex: 1, gap: spacing.xs },
  heart: { width: TOUCH_TARGET, height: TOUCH_TARGET, justifyContent: 'center', alignItems: 'center' },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
});
