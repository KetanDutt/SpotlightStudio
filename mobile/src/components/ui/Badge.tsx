/** Small status pill: quality (4K/UHD), source, "Saved", favourites count, etc. */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { AppText, type TextTone } from './AppText';

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Use the accent gradient (used for resolution badges on photos). */
  gradient?: boolean;
}

export function Badge({ label, tone = 'neutral', icon, gradient }: BadgeProps) {
  const colors = useColors();
  const tones: Record<BadgeTone, { bg: string; fg: TextTone }> = {
    neutral: { bg: 'rgba(120, 133, 158, 0.28)', fg: 'default' },
    accent: { bg: 'rgba(74, 168, 255, 0.22)', fg: 'accent' },
    ok: { bg: 'rgba(52, 211, 153, 0.2)', fg: 'ok' },
    warn: { bg: 'rgba(251, 191, 36, 0.2)', fg: 'warn' },
    danger: { bg: 'rgba(248, 113, 113, 0.22)', fg: 'danger' },
  };
  const spec = tones[gradient ? 'accent' : tone];

  return (
    <View style={[styles.base, { backgroundColor: spec.bg }]}>
      {icon ? <Ionicons name={icon} size={11} color={colors.text} style={styles.icon} /> : null}
      <AppText variant="caption" tone={gradient ? 'accent' : spec.fg} style={styles.label}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  icon: {
    marginEnd: 3,
  },
  label: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
