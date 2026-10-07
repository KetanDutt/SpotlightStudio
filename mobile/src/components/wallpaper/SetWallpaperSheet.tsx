/**
 * "Set wallpaper" sheet – the heart of the app.
 *
 * Android : pick the target screen (home / lock / both) and apply it natively.
 * iOS     : explain that Apple does not allow it, save the picture to the album and show
 *           the exact steps to finish with the Shortcuts action.
 *
 * The sheet never lies about what happened: the result line is driven by the real outcome.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { PLATFORM_COPY, getCapabilities } from '../../core/platform';
import type { Wallpaper, WallpaperMode } from '../../core/types';
import { radius, spacing } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { useWallpaperActions } from '../../hooks/useWallpaperActions';
import { availableModes, describeMode } from '../../services/wallpaper';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { ProgressBar } from '../ui/States';
import { Segmented } from '../ui/Segmented';
import { Sheet } from '../ui/Sheet';

export interface SetWallpaperSheetProps {
  item: Wallpaper | undefined;
  visible: boolean;
  onClose: () => void;
}

export function SetWallpaperSheet({ item, visible, onClose }: SetWallpaperSheetProps) {
  const colors = useColors();
  const actions = useWallpaperActions(item);
  const modes = useMemo(() => availableModes(), []);
  const [mode, setMode] = useState<WallpaperMode>(modes.includes('home') ? 'home' : modes[0]);

  const options = useMemo(() => {
    return modes.map((value) => ({ value, label: describeMode(value).replace(' screen', '') }));
  }, [modes]);

  const canApply = getCapabilities().canSetWallpaper;
  const percent = Math.round(actions.progress * 100);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={item ? item.title : 'Set wallpaper'}
      subtitle={item ? `${item.raw.width} × ${item.raw.height} · ${item.raw.source === 'peapix' ? 'Peapix' : 'Windows 10 Spotlight'}` : undefined}
      testID="set-wallpaper-sheet"
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {canApply ? (
          <>
            <AppText variant="caption" tone="faint" style={styles.sectionLabel}>
              APPLY TO
            </AppText>
            {options.length > 1 ? (
              <Segmented options={options} value={mode} onChange={setMode} accessibilityLabel="Wallpaper target" />
            ) : (
              <View style={[styles.notice, { backgroundColor: colors.fill, borderColor: colors.stroke }]}>
                <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
                <AppText variant="caption" tone="muted" style={styles.noticeText}>
                  This Android version only supports the home screen. Android 7.0+ also allows the lock screen.
                </AppText>
              </View>
            )}
          </>
        ) : (
          <View style={[styles.notice, { backgroundColor: colors.fill, borderColor: colors.stroke }]}>
            <Ionicons name="logo-apple" size={18} color={colors.textMuted} />
            <View style={styles.noticeText}>
              <AppText variant="label">{PLATFORM_COPY.iosShortcut.title}</AppText>
              <AppText variant="caption" tone="muted">
                {PLATFORM_COPY.iosShortcut.body}
              </AppText>
              <AppText variant="caption" tone="faint">
                Shortcuts → new shortcut → action “Set Wallpaper” → run it on this picture (or add it to an
                automation to rotate automatically).
              </AppText>
            </View>
          </View>
        )}

        {actions.busy && actions.running === 'apply' ? (
          <View style={styles.progress}>
            <ProgressBar value={actions.progress} />
            <AppText variant="caption" tone="muted">
              Downloading the full-resolution image{percent > 0 ? ` · ${percent}%` : ''}…
            </AppText>
          </View>
        ) : null}

        <Button
          title={canApply ? `Set ${describeMode(mode).toLowerCase()} wallpaper` : 'Save to photo library'}
          icon={canApply ? 'phone-portrait-outline' : 'download-outline'}
          variant="primary"
          size="lg"
          loading={actions.running === 'apply'}
          disabled={!item}
          onPress={async () => {
            const done = await actions.apply(mode);
            if (done) onClose();
          }}
          testID="confirm-set-wallpaper"
        />

        {canApply ? null : (
          <Button
            title="Open Shortcuts"
            icon="logo-apple"
            variant="secondary"
            onPress={() => {
              // `shortcuts://` is Apple's documented scheme; if Shortcuts is not installed
              // the promise rejects and nothing happens – the instructions above still apply.
              void Linking.openURL('shortcuts://').catch(() => undefined);
            }}
            testID="open-shortcuts"
          />
        )}

        {canApply ? (
          <Button
            title="Save a copy to the gallery"
            icon="images-outline"
            loading={actions.running === 'save'}
            disabled={!item}
            onPress={() => void actions.save()}
          />
        ) : (
          <Button
            title="Save to photo library"
            icon="images-outline"
            loading={actions.running === 'save'}
            disabled={!item}
            onPress={() => void actions.save()}
          />
        )}

        {item?.raw.source_url ? (
          <AppText variant="caption" tone="faint" align="center">
            Original: {item.raw.source_url.replace(/^https?:\/\//, '').slice(0, 64)}
            {item.raw.source_url.length > 72 ? '…' : ''}
          </AppText>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  sectionLabel: {
    letterSpacing: 0.8,
  },
  notice: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
  noticeText: {
    flex: 1,
    gap: 2,
  },
  progress: {
    gap: spacing.sm,
  },
});
