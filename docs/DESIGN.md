# Spotlight Studio — Liquid Glass design system

Release **2.8.1** · web/PWA, desktop crawler studio, API reference, and Expo mobile client.

Design methodology informed by **Unslop by Damir Sokolovsky** (`https://github.com/heydamir/unslop`), licensed under CC BY 4.0.

## Five-line direction

- **Product:** A curated, perceptually de-duplicated archive and wallpaper studio for ~7,500 4K and Full HD Windows Spotlight photographs across web, desktop, mobile, and TV.
- **Character:** Calm, spatial, photographic and composed.
- **World:** Darkroom slate (`#121316`) and matte museum mount board (`#f6f5f2`) — color-neutral surfaces that cast zero tint onto landscape photography, paired with a single sunlit-ochre (`#e2b05e`) / burnished-umber (`#86530d`) accent drawn from the rising sun in Spotlight Studio's emblem.
- **Moments:** (1) The **Daily Spotlight** contact-sheet plate (asymmetric framed photograph + UTC archival colophon) and (2) the **Optical Loupe** viewer (`#090a0c` darkroom stage + hairline technical specification rail).
- **Signature:** Neutral translucent surfaces and restrained edge highlights frame unaltered photographs, with readable metadata and subtle motion.

## Design tokens

`static/css/tokens.css` (web) and `mobile/src/theme/tokens.ts` (Expo) are the single sources of truth for dark and light themes.

| Group | Web tokens (`static/css/tokens.css`) | Mobile tokens (`mobile/src/theme/tokens.ts`) |
|---|---|---|
| Neutral surfaces | `--bg` (`#121316` / `#f6f5f2`), `--bg-elev` (`#191b1f` / `#ffffff`), `--bg-inset` (`#0d0e10` / `#eceae4`), `--photo-well` | `bg`, `surface`, `surfaceAlt`, `fill`, `fillHover` |
| Ink (opaque, AA >= 5.0:1) | `--text`, `--text-2`, `--text-3` | `text`, `textMuted`, `textFaint` |
| Accent & status | `--accent` (`#e2b05e` / `#86530d`), `--accent-ink`, `--ok`, `--warn`, `--danger` | `accent`, `onAccent`, `accentFill`, `ok`, `warn`, `danger` |
| Hairlines | `--border` (8–9% alpha), `--border-strong` (15–16% alpha) | `stroke`, `strokeStrong` |
| Radii (nested math) | `--radius-xs` 4 · `--radius-sm` 9 · `--radius-md` 14 · `--radius-lg` 20 · `--radius-xl` 24 | `sm` 9 · `md` 14 · `lg` 20 · `xl` 24 |
| Spacing (4px grid) | `--space-1…10` (`4, 8, 12, 16, 20, 24, 32, 40px`) | `xxs` 2 · `xs` 4 · `sm` 8 · `md` 12 · `lg` 16 · `xl` 20 · `xxl` 24 · `xxxl` 32 |
| Typography | `--font-sans` + `--font-mono`, sentence-case labels, `tabular-nums` | `AppText` variants + `mono`, sentence-case labels, `tabular-nums` |
| Motion | `140 / 200 / 280ms`, `cubic-bezier(.2, 0, 0, 1)` (calm optical settle, no overshoot) | `150 / 260 / 380ms`, cubic-out settle, reduced-motion zeroing |

## Core component & layout rules

- **No color cast on chrome:** App backgrounds, sidebars, cards, and modals remain strictly achromatic/neutral so warm desert, alpine snow, and ocean photography retain accurate white balance.
- **Selective glass:** Navigation, dialogs and floating surfaces use translucent fills, restrained blur and edge highlights; a low-contrast ambient field provides depth. Photo tiles avoid expensive per-card backdrop blur. Mobile uses structural blur on iOS and opaque fallbacks on Android and when reduced transparency is enabled.
- **Sentence case & restrained weight:** Section titles, form labels, status indicators, and metadata labels use sentence case (`500`–`600` weight, zero `.14em` uppercase tracking).
- **Radius discipline:** Shared radii create a consistent hierarchy while leaving photographs and lists easy to scan.
- **Operational hierarchy in Crawler:** Live crawl telemetry uses a hairline-divided 3×2 monospace readout (`New`, `Duplicates`, `Errors`, `Rate`, `Queue`, `Pages left`), a quiet dot-and-label status indicator, and a single primary `Start` action.
- **Contextual batch selection:** Batch selection triggers from the main results toolbar and reveals its action bar only while selection mode is active.

## Accessibility & security invariants

- Every semantic foreground token (`--text`, `--text-2`, `--text-3`, `--accent`) achieves **>= 5.0:1** WCAG AA contrast against base, elevated, and inset surfaces in both dark and light themes, verified by automated tests.
- Strict Content Security Policy (`default-src 'self'; script-src 'self'; style-src 'self'`): zero external font/script CDNs, zero inline styles/scripts.
- Responsive layouts down to `320px` with zero horizontal overflow and `>= 44×44px` touch targets on mobile/tablet navigation controls (`<= 960px`).
- Full keyboard navigation, mobile filter drawer focus containment (`#sidebar-close` ↔ `#btn-reset`), top-layer toast reparenting, `prefers-reduced-motion: reduce`, and `forced-colors: active` support.
