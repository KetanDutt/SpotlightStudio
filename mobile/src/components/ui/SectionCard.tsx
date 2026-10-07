/**
 * Settings building blocks: a titled card, a row with an icon, and a switch row.
 * Everything a settings screen needs, so screens stay declarative.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Switch, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { AppText, type TextTone } from './AppText';
import { Touchable } from './Pressable';

export function SectionCard({ title, footer, children, style }: { title?: string; footer?: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <AppText variant="caption" tone="faint" style={styles.sectionTitle}>
          {title.toUpperCase()}
        </AppText>
      ) : null}
      <View style={[styles.card, { backgroundColor: colors.glassSecondary, borderColor: colors.stroke }]}>{children}</View>
      {footer ? (
        <AppText variant="caption" tone="faint" style={styles.footer}>
          {footer}
        </AppText>
      ) : null}
    </View>
  );
}

export interface RowProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  /** Right-hand text value. */
  value?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  tone?: TextTone;
  disabled?: boolean;
  destructive?: boolean;
  /** Draw a divider above the row (except for the first row of a card). */
  divider?: boolean;
  testID?: string;
}

export function Row({
  icon,
  title,
  subtitle,
  value,
  onPress,
  right,
  tone = 'default',
  disabled,
  destructive,
  divider,
  testID,
}: RowProps) {
  const colors = useColors();
  const content = (
    <View style={[styles.row, divider ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.stroke } : null]}>
      {icon ? (
        <View style={[styles.iconWrap, { backgroundColor: colors.fill }]}>
          <Ionicons name={icon} size={17} color={destructive ? colors.danger : colors.text} />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <AppText variant="body" tone={destructive ? 'danger' : tone} numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="muted" numberOfLines={3}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <AppText variant="label" tone="muted" numberOfLines={1} style={styles.value}>
          {value}
        </AppText>
      ) : null}
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={17} color={colors.textFaint} /> : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      disabled={disabled}
      onPress={onPress}
      plain
      testID={testID}
      style={disabled ? styles.disabled : undefined}
    >
      {content}
    </Touchable>
  );
}

export function SwitchRow({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
  disabled,
  divider,
  testID,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  divider?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.row, divider ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.stroke } : null]}>
      {icon ? (
        <View style={[styles.iconWrap, { backgroundColor: colors.fill }]}>
          <Ionicons name={icon} size={17} color={colors.text} />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <AppText variant="body" numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="muted" numberOfLines={3}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        testID={testID}
        accessibilityLabel={title}
        trackColor={{ false: colors.fill, true: colors.accent }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.fill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    letterSpacing: 0.8,
    paddingHorizontal: spacing.xs,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  footer: {
    paddingHorizontal: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    minHeight: 64,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  value: {
    maxWidth: 130,
  },
  disabled: {
    opacity: 0.5,
  },
});
