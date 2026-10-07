/**
 * Design tokens – the mobile twin of `static/css/app.css` ("Liquid Glass").
 *
 * The palette, semantic materials and motion vocabulary are shared with the
 * web app so the two clients look like one product.  Values live here only; components
 * read them through `useTheme()`.
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
  bg: '#151918', surface: '#202624', surfaceAlt: '#2a332d',
  glass: 'rgba(32,39,35,0.82)', glassStrong: 'rgba(35,43,38,0.95)',
  glassSecondary: 'rgba(37,46,41,0.45)', glassFloating: 'rgba(42,51,45,0.93)',
  fill: 'rgba(222,236,227,0.045)', fillHover: 'rgba(222,236,227,0.085)',
  stroke: 'rgba(232,242,234,0.08)', strokeStrong: 'rgba(232,242,234,0.15)',
  text: '#eef2ef', textMuted: '#bac4be', textFaint: '#98a69d',
  accent: '#b5d5c5', onAccent: '#203e31', accentFill: 'rgba(181,213,197,0.12)',
  ok: '#accdbb', warn: '#dbbf8a', danger: '#edaaa7',
  dangerFill: 'rgba(237,170,167,0.10)', warnFill: 'rgba(219,191,138,0.10)',
  scrim: 'rgba(9,15,12,0.42)', viewer: 'rgba(15,21,18,0.96)',
  gradient: ['#c3ddcf', '#bad8c9', '#b5d5c5'], shadow: '#09110c',
  imageControl: 'rgba(19,30,23,0.78)', imageText: '#ffffff', imageFavorite: '#ffd3ce',
  dark: true,
};

export const LIGHT: Palette = {
  bg: '#f5f5f1', surface: '#fcfcf9', surfaceAlt: '#eef1ea',
  glass: 'rgba(253,254,250,0.78)', glassStrong: 'rgba(253,254,250,0.96)',
  glassSecondary: 'rgba(250,252,247,0.5)', glassFloating: 'rgba(253,254,250,0.94)',
  fill: 'rgba(34,57,43,0.035)', fillHover: 'rgba(34,57,43,0.065)',
  stroke: 'rgba(35,57,44,0.07)', strokeStrong: 'rgba(35,57,44,0.14)',
  text: '#252f29', textMuted: '#58675d', textFaint: '#5f6d63',
  accent: '#3c6250', onAccent: '#ffffff', accentFill: 'rgba(60,98,80,0.08)',
  ok: '#426a51', warn: '#886524', danger: '#a04742',
  dangerFill: 'rgba(160,71,66,0.07)', warnFill: 'rgba(136,101,36,0.07)',
  scrim: 'rgba(36,47,39,0.24)', viewer: 'rgba(241,245,239,0.97)',
  gradient: ['#476f5b', '#416954', '#3c6250'], shadow: '#24392c',
  imageControl: 'rgba(19,30,23,0.78)', imageText: '#ffffff', imageFavorite: '#ffd3ce',
  dark: false,
};

export const PALETTES: Record<ThemeName, Palette> = { dark: DARK, light: LIGHT };

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
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
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17.5,
  xl: 28,
  xxl: 34,
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
  fast: 150,
  normal: 260,
  slow: 380,
} as const;

/** BlurView intensity units, not CSS pixels; use only on structural surfaces. */
export const material = { secondary: 12, primary: 28, floating: 40, tinted: 20 } as const;
export const depth = { navigation: 10, overlay: 20, toast: 30 } as const;
export const navigation = { height: 64, inset: 12, contentInset: 100 } as const;
