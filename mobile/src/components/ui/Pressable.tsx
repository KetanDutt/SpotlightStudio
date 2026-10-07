/**
 * Touchable primitive with consistent feedback: opacity + a tiny scale on press.
 * Used by the buttons, cards and chips so press behaviour feels identical everywhere.
 */
import React, { useCallback } from 'react';
import {
  Animated,
  Easing,
  Pressable as RNPressable,
  useAnimatedValue,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { durations } from '../../theme/tokens';

export interface TouchableProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  /** Skip the scale animation (useful for full-width list rows). */
  plain?: boolean;
  children?: React.ReactNode;
}

export function Touchable({ style, plain, children, onPressIn, onPressOut, ...rest }: TouchableProps) {
  const scale = useAnimatedValue(1);
  const opacity = useAnimatedValue(1);

  const animate = useCallback(
    (toScale: number, toOpacity: number) => {
      if (plain) return;
      Animated.parallel([
        Animated.timing(scale, {
          toValue: toScale,
          duration: durations.fast,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, { toValue: toOpacity, duration: durations.fast, useNativeDriver: true }),
      ]).start();
    },
    [opacity, plain, scale],
  );

  return (
    <RNPressable
      {...rest}
      onPressIn={(event) => {
        animate(0.97, 0.86);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(1, 1);
        onPressOut?.(event);
      }}
    >
      <Animated.View style={[style, { transform: [{ scale }], opacity }]}>{children}</Animated.View>
    </RNPressable>
  );
}
