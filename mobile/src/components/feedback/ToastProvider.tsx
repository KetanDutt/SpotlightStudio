/**
 * Toasts – the app's only "message" mechanism (no Alert popups for routine feedback).
 *
 * A toast is a small glass card that slides up from the bottom, shows an icon + message and
 * an optional action ("Undo", "View").  Using a provider means every screen can show one
 * with `useToast().show(...)` and they never stack more than two deep.
 */
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useAnimatedValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LIMITS } from '../../core/config';
import { radius, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { AppText } from '../ui/AppText';
import { Touchable } from '../ui/Pressable';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  message: string;
  title?: string;
  tone?: ToastTone;
  durationMs?: number;
  action?: { label: string; onPress: () => void };
}

interface ToastState extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  show: (options: ToastOptions | string) => void;
  hide: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastTone, keyof typeof Ionicons.glyphMap> = {
  info: 'information-circle',
  success: 'checkmark-circle',
  warning: 'alert-circle',
  error: 'close-circle',
};

interface ToastStackProps {
  toast: ToastState | null;
}

function ToastStack({ toast }: ToastStackProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const translate = useAnimatedValue(120);
  const opacity = useAnimatedValue(0);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translate, {
        toValue: toast ? 0 : 120,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, { toValue: toast ? 1 : 0, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [opacity, toast, translate]);

  if (!toast) return null;
  const tone = toast.tone ?? 'info';

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { bottom: insets.bottom + spacing.xl, opacity, transform: [{ translateY: translate }] },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <BlurView intensity={Platform.OS === 'ios' ? 40 : 0} tint={colors.dark ? 'dark' : 'light'} style={styles.blur}>
        <View style={[styles.card, { backgroundColor: colors.glassStrong, borderColor: colors.stroke }]}>
          <Ionicons
            name={ICONS[tone]}
            size={20}
            color={tone === 'error' ? colors.danger : tone === 'success' ? colors.ok : tone === 'warning' ? colors.warn : colors.accent}
          />
          <View style={styles.text}>
            {toast.title ? (
              <AppText variant="label" numberOfLines={1}>
                {toast.title}
              </AppText>
            ) : null}
            <AppText variant="caption" tone="muted" numberOfLines={3}>
              {toast.message}
            </AppText>
          </View>
          {toast.action ? (
            <Touchable
              accessibilityRole="button"
              onPress={toast.action.onPress}
              style={[styles.action, { borderColor: colors.strokeStrong }]}
            >
              <AppText variant="label" tone="accent">
                {toast.action.label}
              </AppText>
            </Touchable>
          ) : null}
        </View>
      </BlurView>
    </Animated.View>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const show = useCallback(
    (options: ToastOptions | string) => {
      const next: ToastState = {
        id: Date.now(),
        ...(typeof options === 'string' ? { message: options } : options),
      };
      if (timer.current) clearTimeout(timer.current);
      setToast(next);
      timer.current = setTimeout(() => setToast(null), next.durationMs ?? LIMITS.toastMs);
    },
    [],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ show, hide }), [show, hide]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack toast={toast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast() must be used inside <ToastProvider>.');
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
  },
  blur: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  action: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
