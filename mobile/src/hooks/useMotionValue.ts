import { useState } from 'react';
import { Animated } from 'react-native';

/** Stable animation value on native and react-native-web (which lacks useAnimatedValue). */
export function useMotionValue(initial: number): Animated.Value {
  const [value] = useState(() => new Animated.Value(initial));
  return value;
}
