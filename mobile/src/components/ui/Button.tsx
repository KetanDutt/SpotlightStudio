/**
 * Buttons – primary (soft fill), secondary (glass) and ghost, with an icon slot, a loading
 * state and a disabled state.  Accessibility roles/labels are set here once.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { TOUCH_TARGET, radius, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { AppText, type TextTone } from './AppText';
import { Touchable } from './Pressable';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Icon after the label (e.g. a chevron). */
  trailingIcon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  /** Constrain the width; buttons are full width by default. */
  inline?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  testID?: string;
}

const SIZES: Record<ButtonSize, { height: number; paddingHorizontal: number; icon: number; variant: 'label' | 'body' | 'subheading' }> = {
  sm: { height: TOUCH_TARGET, paddingHorizontal: spacing.md, icon: 15, variant: 'label' },
  md: { height: TOUCH_TARGET, paddingHorizontal: spacing.lg, icon: 18, variant: 'body' },
  lg: { height: 54, paddingHorizontal: spacing.xl, icon: 20, variant: 'subheading' },
};

export function Button({
  title,
  onPress,
  variant = 'secondary',
  size = 'md',
  icon,
  trailingIcon,
  loading,
  disabled,
  inline,
  style,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const colors = useColors();
  const spec = SIZES[size];
  const isDisabled = Boolean(disabled || loading);
  const tone: TextTone = variant === 'primary' ? 'onAccent' : variant === 'danger' ? 'danger' : 'default';

  const background =
    variant === 'primary'
      ? { backgroundColor: colors.accent }
      : variant === 'secondary'
        ? { backgroundColor: colors.fill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.stroke }
        : variant === 'danger'
          ? { backgroundColor: colors.dangerFill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.stroke }
          : null;

  const content = (
    <View style={[styles.content, { paddingHorizontal: spec.paddingHorizontal }]}>
      {loading ? (
        <ActivityIndicator size="small" color={variant === 'primary' ? colors.onAccent : colors.text} style={styles.icon} />
      ) : icon ? (
        <Ionicons
          name={icon}
          size={spec.icon}
          color={variant === 'primary' ? colors.onAccent : variant === 'danger' ? colors.danger : colors.text}
          style={styles.icon}
        />
      ) : null}
      <AppText variant={spec.variant} tone={tone} numberOfLines={1} style={styles.label} truncate>
        {title}
      </AppText>
      {trailingIcon ? (
        <Ionicons
          name={trailingIcon}
          size={spec.icon}
          color={variant === 'primary' ? colors.onAccent : colors.textMuted}
          style={styles.trailing}
        />
      ) : null}
    </View>
  );

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: Boolean(loading) }}
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      disabled={isDisabled}
      testID={testID}
      onPress={onPress}
      style={[
        styles.base,
        { height: spec.height, borderRadius: radius.md, opacity: isDisabled ? 0.5 : 1 },
        background,
        inline ? styles.inline : null,
        style,
      ]}
    >
      {content}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inline: {
    alignSelf: 'flex-start',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  label: {
    flexShrink: 1,
  },
  icon: {
    marginEnd: spacing.sm,
  },
  trailing: {
    marginStart: spacing.xs,
  },
});
