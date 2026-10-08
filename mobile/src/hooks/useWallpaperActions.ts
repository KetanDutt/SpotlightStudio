/** Guard expensive actions synchronously and cancel their transfers on unmount. */
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryAction, Wallpaper, WallpaperMode } from '../core/types';
import { capabilities } from '../core/platform';
import { useToast } from '../components/feedback/ToastProvider';
import { usePreferences } from '../providers/PreferencesProvider';
import { copyShareLink, shareWallpaper, sourcePageUrl } from '../services/media';
import { applyWallpaper, describeMode, saveWallpaper } from '../services/wallpaper';

export type WallpaperAction = 'apply' | 'save' | 'share';
export interface WallpaperActions {
  running: WallpaperAction | null;
  progress: number;
  busy: boolean;
  cancel: () => void;
  apply: (mode: WallpaperMode) => Promise<boolean>;
  save: () => Promise<boolean>;
  share: () => Promise<boolean>;
  copyLink: () => Promise<boolean>;
  openSource: () => Promise<boolean>;
}

export function useWallpaperActions(item: Wallpaper | undefined): WallpaperActions {
  const { show } = useToast();
  const { addHistory } = usePreferences();
  const [running, setRunning] = useState<WallpaperAction | null>(null);
  const [progress, setProgress] = useState(0);
  const alive = useRef(true);
  const current = useRef<AbortController | null>(null);

  useEffect(() => {
    alive.current = true; // StrictMode setup may follow a development cleanup.
    return () => { alive.current = false; current.current?.abort(); };
  }, []);

  const cancel = useCallback(() => { current.current?.abort(); }, []);
  useEffect(() => () => { current.current?.abort(); }, [item?.key]);

  const begin = useCallback((action: WallpaperAction) => {
    if (!item || current.current) return null;
    const controller = new AbortController();
    current.current = controller;
    setRunning(action);
    setProgress(0);
    return controller;
  }, [item]);
  const finish = useCallback((controller: AbortController) => {
    if (current.current !== controller) return;
    current.current = null;
    if (alive.current) { setRunning(null); setProgress(0); }
  }, []);
  const reportProgress = useCallback((received: number, total: number) => {
    if (alive.current && !current.current?.signal.aborted && total > 0) setProgress(Math.min(1, received / total));
  }, []);
  const record = useCallback((action: HistoryAction) => {
    if (item && alive.current) addHistory(item.id, action);
  }, [addHistory, item]);

  const apply = useCallback(async (mode: WallpaperMode) => {
    const controller = begin('apply');
    if (!item || !controller) return false;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    try {
      const result = await applyWallpaper(item, mode, { signal: controller.signal, onProgress: reportProgress });
      if (!alive.current || (!result.ok && controller.signal.aborted)) return false;
      if (!result.ok) {
        show({ tone: 'error', title: 'Could not set the wallpaper', message: result.error });
        return false;
      }
      const outcome = result.value;
      if (outcome.status === 'applied') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        record('download');
        show({ tone: 'success', title: `${describeMode(outcome.mode)} wallpaper updated`,
          message: capabilities.canSetWallpaper ? 'Applied by the Android wallpaper manager.' : outcome.message });
      } else {
        record('save');
        show({ tone: 'info', title: 'Saved to your photo library', message: outcome.message, durationMs: 6000 });
      }
      return true;
    } catch (error) {
      if (alive.current && !controller.signal.aborted) show({ tone: 'error', message: String(error) });
      return false;
    } finally { finish(controller); }
  }, [begin, finish, item, record, reportProgress, show]);

  const save = useCallback(async () => {
    const controller = begin('save');
    if (!item || !controller) return false;
    try {
      // Save must NEVER call applyWallpaper: on Android that changes the home screen.
      const result = await saveWallpaper(item, { signal: controller.signal, onProgress: reportProgress });
      if (!alive.current || (!result.ok && controller.signal.aborted)) return false;
      if (!result.ok) { show({ tone: 'error', title: 'Could not save', message: result.error }); return false; }
      record('save');
      show({ tone: 'success', message: `Saved “${item.title}” to your photo library.` });
      return true;
    } catch (error) {
      if (alive.current && !controller.signal.aborted) show({ tone: 'error', message: String(error) });
      return false;
    } finally { finish(controller); }
  }, [begin, finish, item, record, reportProgress, show]);

  const share = useCallback(async () => {
    const controller = begin('share');
    if (!item || !controller) return false;
    try {
      const result = await shareWallpaper(item, { signal: controller.signal, onProgress: reportProgress });
      if (!alive.current || (!result.ok && controller.signal.aborted)) return false;
      if (!result.ok) { show({ tone: 'error', title: 'Sharing failed', message: result.error }); return false; }
      record('share');
      return true;
    } catch (error) {
      if (alive.current && !controller.signal.aborted) show({ tone: 'error', message: String(error) });
      return false;
    } finally { finish(controller); }
  }, [begin, finish, item, record, reportProgress, show]);

  const copyLink = useCallback(async () => {
    if (!item) return false;
    const result = await copyShareLink(item);
    if (!alive.current) return false;
    if (!result.ok) { show({ tone: 'error', title: 'Could not copy the link', message: result.error }); return false; }
    record('copy-link');
    show({ tone: 'success', message: 'Link copied – open it to browse the web gallery.' });
    return true;
  }, [item, record, show]);
  const openSource = useCallback(async () => {
    if (!item) return false;
    const url = sourcePageUrl(item);
    if (!url) { show({ tone: 'warning', message: 'This wallpaper has no source page recorded.' }); return false; }
    try {
      await WebBrowser.openBrowserAsync(url);
      record('open-source');
      return true;
    } catch {
      if (alive.current) show({ tone: 'error', message: 'Could not open the source page.' });
      return false;
    }
  }, [item, record, show]);

  return useMemo(() => ({ running, progress, busy: running !== null, cancel, apply, save, share, copyLink, openSource }),
    [running, progress, cancel, apply, save, share, copyLink, openSource]);
}
