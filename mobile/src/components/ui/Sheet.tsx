import { useMotionValue } from '../../hooks/useMotionValue';
/**
 * Bottom sheet – a blurred modal panel that slides up.
 *
 * Uses the platform `Modal` (so it renders above the tab bar and handles the Android back
 * button for free) with a drag-handle look and a tappable scrim.
 */
import React, { useEffect, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { durations, radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { AppText } from './AppText';
import { GlassBackdrop } from './GlassBackdrop';
import { ModalToastLayer } from '../feedback/ToastProvider';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Height of the panel; leave undefined to fit the content. */
  maxHeightRatio?: number;
  testID?: string;
}

export function Sheet({ visible, onClose, title, subtitle, children, maxHeightRatio = 0.86, testID }: SheetProps) {
  const { colors, reduceMotion } = useTheme();
  const [presented, setPresented] = useState(visible);
  if (visible && !presented) setPresented(true);
  const insets = useSafeAreaInsets();
  const progress = useMotionValue(0);

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : visible ? durations.normal : durations.fast,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => { if (finished && !visible) setPresented(false); });
    return () => animation.stop();
  }, [progress, visible, reduceMotion]);

  return (
    <Modal
      visible={visible || presented}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
      testID={testID}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          {
            maxHeight: `${Math.round(maxHeightRatio * 100)}%`,
            paddingBottom: insets.bottom + spacing.lg,
            opacity: progress,
            borderColor: colors.stroke,
            transform: [
              {
                translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : 32, 0] }),
              },
            ],
          },
        ]}
      >
        <GlassBackdrop strength="floating" />

        <View style={styles.handleWrap}>
          <View style={[styles.handle, { backgroundColor: colors.strokeStrong }]} />
        </View>

        {title ? (
          <View style={styles.header}>
            <AppText variant="heading">{title}</AppText>
            {subtitle ? (
              <AppText variant="caption" tone="muted">
                {subtitle}
              </AppText>
            ) : null}
          </View>
        ) : null}

        <View style={styles.body}>{children}</View>
      </Animated.View>
      {visible || presented ? <ModalToastLayer /> : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: radius.pill,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: 4,
  },
  body: {
    paddingHorizontal: spacing.xl,
  },
});
