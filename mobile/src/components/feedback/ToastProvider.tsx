import { useMotionValue } from '../../hooks/useMotionValue';
/**
 * Toasts – the app's only "message" mechanism (no Alert popups for routine feedback).
 *
 * A toast is a small glass card that slides up from the bottom, shows an icon + message and
 * an optional action ("Undo", "View").  Using a provider means every screen can show one
 * with `useToast().show(...)` and they never stack more than two deep.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LIMITS } from '../../core/config';
import { depth, durations, navigation, radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { AppText } from '../ui/AppText';
import { Touchable } from '../ui/Pressable';
import { GlassBackdrop } from '../ui/GlassBackdrop';

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
interface ToastLayerContextValue {
  toast: ToastState | null;
  registerLayer: () => () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const ToastLayerContext = createContext<ToastLayerContextValue | null>(null);

const ICONS: Record<ToastTone, keyof typeof Ionicons.glyphMap> = {
  info: 'information-circle',
  success: 'checkmark-circle',
  warning: 'alert-circle',
  error: 'close-circle',
};

interface ToastStackProps {
  toast: ToastState | null;
  modal?: boolean;
}

function ToastStack({ toast, modal = false }: ToastStackProps) {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const [displayed, setDisplayed] = useState(toast);
  if (toast && toast !== displayed) setDisplayed(toast);
  const translate = useMotionValue(16);
  const opacity = useMotionValue(0);

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(translate, {
        toValue: toast || reduceMotion ? 0 : 16,
        duration: reduceMotion ? 0 : durations.normal,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, { toValue: toast ? 1 : 0, duration: reduceMotion ? 0 : durations.fast, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => { if (finished && !toast) setDisplayed(null); });
    return () => animation.stop();
  }, [opacity, toast, translate, reduceMotion]);

  if (!displayed) return null;
  const tone = displayed.tone ?? 'info';

  return (
    <Animated.View
      pointerEvents={toast ? "box-none" : "none"}
      style={[
        styles.wrap,
        { ...(modal ? { top: insets.top + spacing.lg } : { bottom: insets.bottom + navigation.contentInset }),
          opacity, transform: [{ translateY: translate }] },
      ]}
      accessibilityLiveRegion="polite"
      accessible={!displayed.action}
      accessibilityRole="alert"
    >
      <View style={styles.blur}>
        <GlassBackdrop strength="floating" />
        <View style={[styles.card, { borderColor: colors.stroke }]}>
          <Ionicons
            name={ICONS[tone]}
            size={20}
            color={tone === 'error' ? colors.danger : tone === 'success' ? colors.ok : tone === 'warning' ? colors.warn : colors.accent}
          />
          <View style={styles.text}>
            {displayed.title ? (
              <AppText variant="label" numberOfLines={1}>
                {displayed.title}
              </AppText>
            ) : null}
            <AppText variant="caption" tone="muted" numberOfLines={3}>
              {displayed.message}
            </AppText>
          </View>
          {displayed.action ? (
            <Touchable
              accessibilityRole="button"
              onPress={displayed.action.onPress}
              style={[styles.action, { borderColor: colors.strokeStrong }]}
            >
              <AppText variant="label" tone="accent">
                {displayed.action.label}
              </AppText>
            </Touchable>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [layers, setLayers] = useState(0);
  const registerLayer = useCallback(() => {
    setLayers(count => count + 1);
    return () => setLayers(count => Math.max(0, count - 1));
  }, []);
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
  const layerValue = useMemo(() => ({ toast, registerLayer }), [toast, registerLayer]);

  return (
    <ToastContext.Provider value={value}>
      <ToastLayerContext.Provider value={layerValue}>
        {children}
        {layers === 0 ? <ToastStack toast={toast} /> : null}
      </ToastLayerContext.Provider>
    </ToastContext.Provider>
  );
}

/** Native Modals are separate OS surfaces; zIndex alone cannot lift a root toast above them. */
export function ModalToastLayer() {
  const context = useContext(ToastLayerContext);
  const register = context?.registerLayer;
  useEffect(() => register?.(), [register]);
  return context ? <ToastStack toast={context.toast} modal /> : null;
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast() must be used inside <ToastProvider>.');
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    zIndex: depth.toast,
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
    paddingVertical: spacing.sm,
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
