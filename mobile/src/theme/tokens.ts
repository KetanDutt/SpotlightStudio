/**
 * Design tokens – the mobile twin of the web Liquid Glass material system.
 *
 * Neutral darkroom graphite (dark) and warm archival mat-board (light) surfaces keep UI chrome
 * free of color cast so landscape photography carries the color. A single sunlit-ochre /
 * burnished-umber accent marks active selection and primary actions. Every text and accent
 * token meets WCAG AA (>= 4.5:1) against bg, surface, and surfaceAlt in both themes.
 */

export type ThemeName = 'dark' | 'light';

export interface Palette {
  /** App background (behind everything). */
  bg: string;
  glassSecondary: string;
  glassFloating: string;
  accentFill: string;
  dangerFill: string;
  warnFill: string;
  imageControl: string;
  imageText: string;
  imageFavorite: string;
  /** Elevated surface: cards, sheets, rows. */
  surface: string;
  /** Slightly stronger surface for pressed / selected states. */
  surfaceAlt: string;
  /** Structural surface fill used with restrained blur on iOS. */
  glass: string;
  /** Nearly opaque surface fill for sheets and bars. */
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
  /** Solid accent tuple (preserved for compatibility). */
  gradient: [string, string, string];
  shadow: string;
  /** True when the palette is dark (used to pick status-bar styles, blur tints…). */
  dark: boolean;
}

export const DARK: Palette = {
  bg: '#121316',
  surface: '#191b1f',
  surfaceAlt: '#22252a',
  glass: 'rgba(31,34,40,0.78)',
  glassStrong: 'rgba(24,27,32,0.92)',
  glassSecondary: 'rgba(39,42,48,0.72)',
  glassFloating: 'rgba(24,27,32,0.90)',
  fill: 'rgba(255,255,255,0.035)',
  fillHover: 'rgba(255,255,255,0.065)',
  stroke: 'rgba(255,255,255,0.08)',
  strokeStrong: 'rgba(255,255,255,0.15)',
  text: '#f0f1f3',
  textMuted: '#b0b5be',
  textFaint: '#979da8',
  accent: '#e2b05e',
  onAccent: '#1c1406',
  accentFill: 'rgba(226,176,94,0.13)',
  ok: '#6fc993',
  warn: '#e5b567',
  danger: '#f08078',
  dangerFill: 'rgba(240,128,120,0.12)',
  warnFill: 'rgba(229,181,103,0.12)',
  scrim: 'rgba(7,8,10,0.68)',
  viewer: 'rgba(9,10,12,0.98)',
  gradient: ['#e2b05e', '#e2b05e', '#e2b05e'],
  shadow: '#000000',
  imageControl: 'rgba(13,14,16,0.82)',
  imageText: '#f0f1f3',
  imageFavorite: '#e2b05e',
  dark: true,
};

export const LIGHT: Palette = {
  bg: '#f6f5f2',
  surface: '#ffffff',
  surfaceAlt: '#eceae4',
  glass: 'rgba(255,255,255,0.76)',
  glassStrong: 'rgba(250,250,248,0.94)',
  glassSecondary: 'rgba(255,255,255,0.78)',
  glassFloating: 'rgba(250,250,248,0.92)',
  fill: 'rgba(22,23,26,0.035)',
  fillHover: 'rgba(22,23,26,0.065)',
  stroke: 'rgba(22,23,26,0.09)',
  strokeStrong: 'rgba(22,23,26,0.16)',
  text: '#16171a',
  textMuted: '#494d55',
  textFaint: '#5d626c',
  accent: '#86530d',
  onAccent: '#ffffff',
  accentFill: 'rgba(134,83,13,0.09)',
  ok: '#1f6f43',
  warn: '#8a560c',
  danger: '#b42c25',
  dangerFill: 'rgba(180,44,37,0.09)',
  warnFill: 'rgba(138,86,12,0.09)',
  scrim: 'rgba(16,17,20,0.48)',
  viewer: 'rgba(13,14,17,0.98)',
  gradient: ['#86530d', '#86530d', '#86530d'],
  shadow: '#16171a',
  imageControl: 'rgba(13,14,16,0.82)',
  imageText: '#f0f1f3',
  imageFavorite: '#e2b05e',
  dark: false,
};

export const PALETTES: Record<ThemeName, Palette> = { dark: DARK, light: LIGHT };

export const radius = {
  sm: 9,
  md: 14,
  lg: 20,
  xl: 24,
  pill: 999,
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const fontSize = {
  xxs: 11,
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 22,
  xxl: 28,
} as const;

export const weight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** Minimum touch target (Apple HIG / Material both ask for >= 44 dp). */
export const TOUCH_TARGET = 44;

export const durations = {
  fast: 150,
  normal: 260,
  slow: 380,
} as const;

/** BlurView intensity units, kept subtle and used only on structural bars. */
export const material = { secondary: 12, primary: 24, floating: 32, tinted: 16 } as const;
export const depth = { navigation: 10, overlay: 20, toast: 30 } as const;
export const navigation = { height: 60, inset: 12, contentInset: 92 } as const;
