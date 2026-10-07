/**
 * Design tokens – the mobile twin of `static/css/app.css` ("Liquid Glass").
 *
 * The palette, gradients, radii and type scale are deliberately the *same values* as the
 * web app so the two clients look like one product.  Values live here only; components
 * read them through `useTheme()`.
 */

export type ThemeName = 'dark' | 'light';

export interface Palette {
  /** App background (behind everything). */
  bg: string;
  /** Elevated surface: cards, sheets, rows. */
  surface: string;
  /** Slightly stronger surface for pressed / selected states. */
  surfaceAlt: string;
  /** Translucent glass fill used with `<BlurView>`. */
  glass: string;
  /** Nearly opaque glass fill for sheets and bars with little content behind them. */
  glassStrong: string;
  /** Low-contrast fill for chips and inputs. */
  fill: string;
  fillHover: string;
  stroke: string;
  strokeStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  onAccent: string;
  ok: string;
  warn: string;
  danger: string;
  scrim: string;
  /** Backdrop of the full-screen viewer. */
  viewer: string;
  /** Accent gradient: [from, via, to]. */
  gradient: [string, string, string];
  shadow: string;
  /** True when the palette is dark (used to pick status-bar styles, blur tints…). */
  dark: boolean;
}

export const DARK: Palette = {
  bg: '#07080d',
  surface: '#0e1119',
  surfaceAlt: '#141a26',
  glass: 'rgba(17, 21, 33, 0.66)',
  glassStrong: 'rgba(12, 15, 25, 0.92)',
  fill: 'rgba(255, 255, 255, 0.055)',
  fillHover: 'rgba(255, 255, 255, 0.1)',
  stroke: 'rgba(255, 255, 255, 0.09)',
  strokeStrong: 'rgba(255, 255, 255, 0.17)',
  text: '#f4f7fb',
  textMuted: '#aab5c7',
  textFaint: '#8795ab',
  accent: '#4aa8ff',
  onAccent: '#061320',
  ok: '#34d399',
  warn: '#fbbf24',
  danger: '#f87171',
  scrim: 'rgba(3, 4, 8, 0.6)',
  viewer: 'rgba(3, 4, 8, 0.94)',
  gradient: ['#38bdf8', '#3b82f6', '#6366f1'],
  shadow: '#000000',
  dark: true,
};

export const LIGHT: Palette = {
  bg: '#eef2f8',
  surface: '#ffffff',
  surfaceAlt: '#f4f7fb',
  glass: 'rgba(255, 255, 255, 0.74)',
  glassStrong: 'rgba(255, 255, 255, 0.94)',
  fill: 'rgba(15, 23, 42, 0.05)',
  fillHover: 'rgba(15, 23, 42, 0.09)',
  stroke: 'rgba(15, 23, 42, 0.1)',
  strokeStrong: 'rgba(15, 23, 42, 0.2)',
  text: '#0e1626',
  textMuted: '#475569',
  textFaint: '#546378',
  accent: '#1757c4',
  onAccent: '#ffffff',
  ok: '#065f46',
  warn: '#92400e',
  danger: '#b91c1c',
  scrim: 'rgba(15, 23, 42, 0.35)',
  viewer: 'rgba(238, 242, 248, 0.94)',
  gradient: ['#2f9bf0', '#2563eb', '#4f46e5'],
  shadow: '#1e293b',
  dark: false,
};

export const PALETTES: Record<ThemeName, Palette> = { dark: DARK, light: LIGHT };

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  pill: 999,
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

export const fontSize = {
  xxs: 10,
  xs: 11.5,
  sm: 13,
  md: 15,
  lg: 17.5,
  xl: 22,
  xxl: 28,
} as const;

export const weight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** Minimum touch target (Apple HIG / Material both ask for ~44 dp). */
export const TOUCH_TARGET = 44;

export const durations = {
  fast: 140,
  normal: 240,
  slow: 420,
} as const;
