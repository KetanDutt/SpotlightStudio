/** Structural material only. Cards/rows deliberately do not instantiate BlurViews. */
import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { material } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

export function GlassBackdrop({ strength = 'primary' }: { strength?: keyof typeof material }) {
  const { colors, reduceTransparency } = useTheme();
  const blur = Platform.OS === 'ios' && !reduceTransparency;
  const fill = strength === 'floating' ? colors.glassFloating : strength === 'secondary'
    ? colors.glassSecondary : strength === 'tinted' ? colors.accentFill : colors.glass;
  return (
    <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
      {blur ? <BlurView intensity={material[strength]} tint={colors.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: blur ? fill : colors.surface }]} />
    </View>
  );
}
