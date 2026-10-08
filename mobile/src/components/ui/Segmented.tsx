/** Segmented control (grid/list, home/lock/both, theme…). */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { AppText } from './AppText';
import { Touchable } from './Pressable';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
  testID?: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({ options, value, onChange, accessibilityLabel, testID, disabled = false }: SegmentedProps<T>) {
  const colors = useColors();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[styles.wrap, { backgroundColor: colors.fill, borderColor: colors.stroke }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Touchable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            plain
            disabled={disabled}
            style={[
              styles.segment,
              selected ? { backgroundColor: colors.surface, borderColor: colors.strokeStrong } : { borderColor: 'transparent' },
            ]}
          >
            <AppText variant="label" tone={selected ? 'default' : 'muted'}>
              {option.label}
            </AppText>
          </Touchable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
  },
});
