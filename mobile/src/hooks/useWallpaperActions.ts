/**
 * All the things a user can do with one wallpaper, in one hook.
 *
 * Screens call `actions.apply(mode)` / `save()` / `share()`… and get consistent behaviour:
 * a toast, a history entry, haptics and a busy flag.  The hook is deliberately independent
 * from the UI so the same logic serves the detail screen, the long-press menu and the
 * background rotation's manual "rotate now" button.
 */
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { HistoryAction, Wallpaper, WallpaperMode } from '../core/types';
import { capabilities } from '../core/platform';
import { copyShareLink, shareWallpaper, sourcePageUrl } from '../services/media';
import { applyWallpaper, describeMode } from '../services/wallpaper';
import { useToast } from '../components/feedback/ToastProvider';
import { usePreferences } from '../providers/PreferencesProvider';

export type WallpaperAction = 'apply' | 'save' | 'share' | 'copy' | 'open';

export interface WallpaperActions {
  /** Which action is running (null when idle). */
  running: WallpaperAction | null;
  /** 0…1 while a download is in progress. */
  progress: number;
  /** True while *any* action runs. */
  busy: boolean;
  apply: (mode: WallpaperMode) => Promise<boolean>;
  save: () => Promise<boolean>;
  share: () => Promise<boolean>;
  copyLink: () => Promise<boolean>;
  openSource: () => Promise<boolean>;
}

function haptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function useWallpaperActions(item: Wallpaper | undefined): WallpaperActions {
  const { show } = useToast();
  const { addHistory } = usePreferences();
  const [running, setRunning] = useState<WallpaperAction | null>(null);
  const [progress, setProgress] = useState(0);
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const record = useCallback(
    (action: HistoryAction) => {
      if (item) addHistory(item.id, action);
    },
    [addHistory, item],
  );

  const apply = useCallback(
    async (mode: WallpaperMode) => {
      if (!item || running) return false;
      setRunning('apply');
      setProgress(0);
      haptic();
      try {
        const result = await applyWallpaper(item, mode, {
          onProgress: (received, total) => {
            if (!alive.current) return;
            if (total > 0) setProgress(Math.min(1, received / total));
            else setProgress((current) => (current > 0.9 ? current : current + 0.25));
          },
        });
        if (!result.ok) {
          show({ tone: 'error', title: 'Could not set the wallpaper', message: result.error });
          return false;
        }
        const outcome = result.value;
        if (outcome.status === 'applied') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
          record('download');
          show({
            tone: 'success',
            title: `${describeMode(outcome.mode)} wallpaper updated`,
            message: capabilities.canSetWallpaper
              ? 'The Android wallpaper manager applied it directly – no extra steps needed.'
              : outcome.message,
          });
        } else {
          record('save');
          show({
            tone: 'info',
            title: 'Saved to your photo library',
            message: outcome.message,
            durationMs: 6000,
          });
        }
        return true;
      } finally {
        if (alive.current) {
          setRunning(null);
          setProgress(0);
        }
      }
    },
    [item, record, running, show],
  );

  const save = useCallback(async () => {
    if (!item || running) return false;
    setRunning('save');
    setProgress(0);
    try {
      const result = await applyWallpaper(item, 'home', {
        onProgress: (received, total) => {
          if (total > 0) setProgress(Math.min(1, received / total));
        },
      });
      if (!result.ok) {
        show({ tone: 'error', title: 'Could not save', message: result.error });
        return false;
      }
      record('save');
      show({ tone: 'success', message: `Saved “${item.title}” to the “Spotlight Studio” album.` });
      return true;
    } finally {
      if (alive.current) {
        setRunning(null);
        setProgress(0);
      }
    }
  }, [item, record, running, show]);

  const share = useCallback(async () => {
    if (!item || running) return false;
    setRunning('share');
    try {
      const result = await shareWallpaper(item);
      if (!result.ok) {
        show({ tone: 'error', title: 'Sharing failed', message: result.error });
        return false;
      }
      record('share');
      return true;
    } finally {
      if (alive.current) setRunning(null);
    }
  }, [item, record, running, show]);

  const copyLink = useCallback(async () => {
    if (!item) return false;
    const result = await copyShareLink(item);
    if (!result.ok) {
      show({ tone: 'error', title: 'Could not copy the link', message: result.error });
      return false;
    }
    record('copy-link');
    show({ tone: 'success', message: 'Link copied – open it on a PC to browse the full gallery.' });
    return true;
  }, [item, record, show]);

  const openSource = useCallback(async () => {
    if (!item) return false;
    const url = sourcePageUrl(item);
    if (!url) {
      show({ tone: 'warning', message: 'This wallpaper has no source page recorded.' });
      return false;
    }
    record('open-source');
    await WebBrowser.openBrowserAsync(url).catch(() => undefined);
    return true;
  }, [item, record, show]);

  return useMemo<WallpaperActions>(
    () => ({
      running,
      progress,
      busy: running !== null,
      apply,
      save,
      share,
      copyLink,
      openSource,
    }),
    [apply, copyLink, openSource, progress, running, save, share],
  );
}
