/**
 * Bottom sheet – a blurred modal panel that slides up.
 *
 * Uses the platform `Modal` (so it renders above the tab bar and handles the Android back
 * button for free) with a drag-handle look and a tappable scrim.
 */
import { BlurView } from 'expo-blur';
import React, { useEffect } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, View, useAnimatedValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { AppText } from './AppText';

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
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const progress = useAnimatedValue(0);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 260 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, visible]);

  return (
    <Modal
      visible={visible}
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
            backgroundColor: colors.glassStrong,
            borderColor: colors.stroke,
            transform: [
              {
                translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }),
              },
            ],
          },
        ]}
      >
        {Platform.OS === 'ios' ? (
          <BlurView intensity={40} tint={colors.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        ) : null}

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
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
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
