/**
 * Typography primitive.  Every string in the app goes through `<AppText>` so the type
 * scale, colours and truncation behave the same everywhere (and the theme is applied
 * automatically instead of hard-coded colours in each screen).
 */
import React from 'react';
import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { fontSize, weight } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';

export type TextVariant = 'display' | 'title' | 'heading' | 'subheading' | 'body' | 'label' | 'caption' | 'mono';
export type TextTone = 'default' | 'muted' | 'faint' | 'accent' | 'ok' | 'warn' | 'danger' | 'onAccent';

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
  /** Shortcut for `numberOfLines={1}` + ellipsis. */
  truncate?: boolean;
}

export function AppText({
  variant = 'body',
  tone = 'default',
  align,
  truncate,
  style,
  ...rest
}: AppTextProps) {
  const colors = useColors();
  const toneColor: Record<TextTone, string> = {
    default: colors.text,
    muted: colors.textMuted,
    faint: colors.textFaint,
    accent: colors.accent,
    ok: colors.ok,
    warn: colors.warn,
    danger: colors.danger,
    onAccent: colors.onAccent,
  };

  return (
    <Text
      {...rest}
      style={[
        styles.base,
        variantStyle[variant],
        { color: toneColor[tone] },
        align ? { textAlign: align } : null,
        truncate ? styles.truncate : null,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    fontVariant: ['tabular-nums'],
  },
  truncate: {},
});

const variantStyle = StyleSheet.create<Record<TextVariant, TextStyle>>({
  display: { fontSize: fontSize.xxl, fontWeight: weight.medium, letterSpacing: -1.1, lineHeight: 40 },
  title: { fontSize: fontSize.xl, fontWeight: weight.medium, letterSpacing: -0.8, lineHeight: 34 },
  heading: { fontSize: fontSize.lg, fontWeight: weight.semibold },
  subheading: { fontSize: fontSize.md, fontWeight: weight.semibold },
  body: { fontSize: fontSize.md, fontWeight: weight.regular, lineHeight: 23 },
  label: { fontSize: fontSize.sm, fontWeight: weight.medium },
  caption: { fontSize: fontSize.xs, fontWeight: weight.regular, lineHeight: 18 },
  mono: { fontSize: fontSize.sm, fontFamily: 'monospace' },
});
