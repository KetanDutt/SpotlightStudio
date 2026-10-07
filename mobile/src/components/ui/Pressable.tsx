import { useMotionValue } from '../../hooks/useMotionValue';
/** One tactile response across buttons, chips and cards; honors OS reduced motion.
 * Layout styles belong to the press target, not an inner child (important for flex rows).
 */
import React, { useCallback, useState } from 'react';
import {
  Animated, Easing, Pressable as RNPressable, StyleSheet,
  type PressableProps, type StyleProp, type ViewStyle,
} from 'react-native';
import { durations } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

export interface TouchableProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  plain?: boolean;
  children?: React.ReactNode;
}
const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

export function Touchable({ style, plain, children, onPressIn, onPressOut, onFocus, onBlur, ...rest }: TouchableProps) {
  const { colors, reduceMotion } = useTheme();
  const [focused, setFocused] = useState(false);
  const scale = useMotionValue(1);
  const opacity = useMotionValue(1);
  const baseTransform = StyleSheet.flatten(style)?.transform;
  const baseOpacity = StyleSheet.flatten(style)?.opacity ?? 1;
  const animate = useCallback((pressed: boolean) => {
    Animated.parallel([
      Animated.timing(scale, { toValue: pressed && !plain && !reduceMotion ? 0.98 : 1,
        duration: reduceMotion ? 0 : durations.fast, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: pressed ? 0.88 : 1,
        duration: reduceMotion ? 0 : durations.fast, useNativeDriver: true }),
    ]).start();
  }, [opacity, plain, reduceMotion, scale]);
  return (
    <AnimatedPressable
      {...rest}
      onFocus={event => { setFocused(true); onFocus?.(event); }}
      onBlur={event => { setFocused(false); onBlur?.(event); }}
      onPressIn={event => { animate(true); onPressIn?.(event); }}
      onPressOut={event => { animate(false); onPressOut?.(event); }}
      style={[style, focused && { outlineColor: colors.accent, outlineWidth: 2, outlineOffset: 3 },
        { transform: [...(Array.isArray(baseTransform) ? baseTransform : []), { scale }], opacity: Animated.multiply(opacity, baseOpacity) }]}
    >
      {children}
    </AnimatedPressable>
  );
}
