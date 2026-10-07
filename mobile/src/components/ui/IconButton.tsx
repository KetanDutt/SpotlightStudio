/** Circular icon button used in headers, cards and the viewer overlay. */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { TOUCH_TARGET, radius } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { Touchable } from './Pressable';

export interface IconButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  /** Filled when the action is "active" (favourite on, filter applied…). */
  active?: boolean;
  size?: number;
  iconSize?: number;
  color?: string;
  disabled?: boolean;
  /** Use a translucent chip background (over photos). */
  translucent?: boolean;
  testID?: string;
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  active,
  size = TOUCH_TARGET,
  iconSize,
  color,
  disabled,
  translucent,
  testID,
}: IconButtonProps) {
  const colors = useColors();
  const resolvedColor = color ?? (translucent ? colors.imageText : active ? colors.accent : colors.text);

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: Boolean(active), disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      hitSlop={6}
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          backgroundColor: translucent ? colors.imageControl : active ? colors.accentFill : 'transparent',
          borderWidth: translucent ? StyleSheet.hairlineWidth : 0,
          borderColor: colors.stroke,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <View style={styles.center}>
        <Ionicons name={icon} size={iconSize ?? Math.round(size * 0.46)} color={resolvedColor} />
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
