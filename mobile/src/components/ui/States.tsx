/**
 * Shared screen states: loading, empty and error.
 *
 * Screens use these instead of hand-rolled placeholders so a slow network, an empty
 * favourites list and a failed download all look like the same product.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { radius, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { AppText } from './AppText';
import { Button } from './Button';

export function LoadingState({ message = 'Loading wallpapers…' }: { message?: string }) {
  const colors = useColors();
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel={message}>
      <ActivityIndicator size="large" color={colors.accent} />
      <AppText variant="label" tone="muted">
        {message}
      </AppText>
    </View>
  );
}

export interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon = 'images-outline', title, body, actionLabel, onAction }: EmptyStateProps) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      <View style={[styles.iconWrap, { backgroundColor: colors.fill, borderColor: colors.stroke }]}>
        <Ionicons name={icon} size={30} color={colors.textMuted} />
      </View>
      <AppText variant="subheading" align="center">
        {title}
      </AppText>
      {body ? (
        <AppText variant="label" tone="muted" align="center" style={styles.body}>
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} variant="secondary" inline icon="refresh" style={styles.action} />
      ) : null}
    </View>
  );
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  /** Extra detail shown in a monospace block (never a stack trace). */
  detail?: string;
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, detail }: ErrorStateProps) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      <View style={[styles.iconWrap, { backgroundColor: 'rgba(248, 113, 113, 0.14)', borderColor: 'rgba(248, 113, 113, 0.3)' }]}>
        <Ionicons name="cloud-offline-outline" size={30} color={colors.danger} />
      </View>
      <AppText variant="subheading" align="center">
        {title}
      </AppText>
      <AppText variant="label" tone="muted" align="center" style={styles.body}>
        {message}
      </AppText>
      {detail ? (
        <AppText variant="mono" tone="faint" align="center" style={styles.detail} numberOfLines={4}>
          {detail}
        </AppText>
      ) : null}
      {onRetry ? <Button title="Try again" onPress={onRetry} variant="secondary" inline icon="refresh" style={styles.action} /> : null}
    </View>
  );
}

/** Inline progress bar (downloads, background task status). */
export function ProgressBar({ value, tone, label }: { value: number; tone?: string; label?: string }) {
  const colors = useColors();
  const ratio = Math.max(0, Math.min(1, value));
  return (
    <View
      style={[styles.track, { backgroundColor: colors.fill }]}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Progress'}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
    >
      <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: tone ?? colors.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
    gap: spacing.sm,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  body: {
    maxWidth: 340,
  },
  detail: {
    maxWidth: 340,
    opacity: 0.8,
  },
  action: {
    marginTop: spacing.md,
  },
  track: {
    height: 4,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
  },
});
