/**
 * Chip – the filter/tag pill used across the gallery.  Selected chips use the accent
 * gradient; the optional `onRemove` turns it into a removable "active filter" chip.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { createElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { AppText } from './AppText';
import { Touchable } from './Pressable';

export interface ChipProps {
  label: string;
  selected?: boolean;
  count?: number;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  testID?: string;
}

export function Chip({ label, selected, count, icon, onPress, onRemove, disabled, size = 'md', testID }: ChipProps) {
  const colors = useColors();
  const height = size === 'sm' ? 30 : 36;

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected), disabled: Boolean(disabled) }}
      accessibilityLabel={count == null ? label : `${label}, ${count} wallpapers`}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={[
        styles.base,
        {
          height,
          borderRadius: radius.pill,
          paddingStart: icon ? spacing.sm : spacing.md,
          paddingEnd: spacing.md,
        },
        selected
          ? { borderColor: 'transparent' }
          : { backgroundColor: colors.fill, borderColor: colors.stroke, borderWidth: StyleSheet.hairlineWidth },
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      {selected ? (
        <LinearGradient
          colors={[...colors.gradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {icon
        ? createElement(Ionicons, {
            name: icon,
            size: size === 'sm' ? 13 : 15,
            color: selected ? colors.onAccent : colors.textMuted,
            style: styles.icon,
          })
        : null}

      <AppText variant={size === 'sm' ? 'caption' : 'label'} tone={selected ? 'onAccent' : 'default'} truncate>
        {label}
      </AppText>

      {count != null ? (
        <AppText variant="caption" tone={selected ? 'onAccent' : 'faint'} style={styles.count}>
          {count.toLocaleString('en-US')}
        </AppText>
      ) : null}

      {onRemove ? (
        <View style={styles.remove}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${label} filter`}
            hitSlop={8}
            onPress={onRemove}
          >
            {createElement(Ionicons, {
              name: 'close-circle',
              size: size === 'sm' ? 14 : 16,
              color: selected ? colors.onAccent : colors.textMuted,
            })}
          </Touchable>
        </View>
      ) : null}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  icon: {
    marginEnd: spacing.xs,
  },
  count: {
    marginStart: spacing.xs,
  },
  remove: {
    marginStart: spacing.sm,
  },
});
