/** Floating structural header with title, actions and optional search/controls.
 * iOS uses restrained blur; web, Android and reduced-transparency use an opaque material.
 */
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { radius, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { AppText } from './AppText';
import { GlassBackdrop } from './GlassBackdrop';

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
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale > 1.3;
  const content = (
    <View style={styles.content}>
      <View style={[styles.row, stacked && { flexDirection: 'column', alignItems: 'stretch' }]}>
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
        {actions ? <View style={[styles.actions, stacked && { alignSelf: 'flex-end' }]}>{actions}</View> : null}
      </View>
      {children ? <View style={styles.extra}>{children}</View> : null}
    </View>
  );

  return <View style={[styles.wrap, { borderColor: colors.stroke }]}><GlassBackdrop />{content}</View>;
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
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
