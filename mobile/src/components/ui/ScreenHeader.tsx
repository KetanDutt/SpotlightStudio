/**
 * Screen header – large title, optional subtitle, and a slot for actions.
 *
 * On iOS the header stretches with the scroll offset; on Android it stays put.  Both sit
 * behind a blur so photos scrolling underneath look right.
 */
import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { AppText } from './AppText';

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Rendered on the right (icon buttons). */
  actions?: React.ReactNode;
  /** Rendered below the title (search field, chips…). */
  children?: React.ReactNode;
}

export function ScreenHeader({ title, subtitle, actions, children }: ScreenHeaderProps) {
  const colors = useColors();
  const content = (
    <View style={styles.content}>
      <View style={styles.row}>
        <View style={styles.titles}>
          <AppText variant="title" numberOfLines={1}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
      {children ? <View style={styles.extra}>{children}</View> : null}
    </View>
  );

  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={36} tint={colors.dark ? 'dark' : 'light'} style={styles.wrap}>
        {content}
      </BlurView>
    );
  }
  return <View style={[styles.wrap, { backgroundColor: colors.bg }]}>{content}</View>;
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  extra: {
    gap: spacing.sm,
  },
});
