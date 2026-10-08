/** Search / text input with a leading icon and a clear button. */
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { TOUCH_TARGET, fontSize, radius, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { Touchable } from './Pressable';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  icon?: keyof typeof Ionicons.glyphMap;
  onClear?: () => void;
  /** Show the clear button only when there is text (default). */
  clearable?: boolean;
}

export function TextField({ icon = 'search', onClear, clearable = true, value, onChangeText, ...rest }: TextFieldProps) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const hasText = Boolean(value && value.length);

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: focused ? colors.surface : colors.fill,
          borderColor: focused ? colors.accent : colors.stroke,
        },
      ]}
    >
      <Ionicons name={icon} size={17} color={colors.textMuted} />
      <TextInput
        {...rest}
        value={value}
        onChangeText={onChangeText}
        onFocus={(event) => {
          setFocused(true);
          rest.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          rest.onBlur?.(event);
        }}
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.accent}
        returnKeyType={rest.returnKeyType ?? 'search'}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="never"
        style={[styles.input, { color: colors.text }]}
        accessibilityLabel={rest.accessibilityLabel ?? 'Search wallpapers'}
      />
      {clearable && hasText ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => {
            onChangeText?.('');
            onClear?.();
          }}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="close-circle" size={17} color={colors.textMuted} />
        </Touchable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    fontSize: fontSize.md,
    paddingVertical: spacing.sm,
  },
});
