# Liquid Glass — design system and consistency audit

Release **2.6.0** · 2026-10-09 · web/PWA and the Expo client.

## Direction

An original, Apple-inspired material language, not a replica of an Apple application.
Photography is the content; chrome provides orientation. Warm off-white and deep
charcoal-green backgrounds, restrained sage accents, strong text hierarchy and generous
spacing replace saturated gradients, glow, and glass on every tile. The interface should
feel **premium, calm, lightweight, fluid, spatial and highly polished** — glass-like but
readable, animated but calm, minimal but not empty.

The real database, catalog, image archive, API contracts, deep links, preferences and
wallpaper workflows are unchanged by the redesign. Screenshots use an **isolated,
generated illustration library**, not the real photographers' images. No preview
fixtures are stored in the production catalog.

## Design tokens

`static/css/tokens.css` is the single source of truth for both themes (dark default,
`data-theme="light"` override). Everything reads from tokens — no scattered literal
values in component rules.

| Group | Tokens |
|---|---|
| Type | `--font`, `--mono`, `--type-caption/body/subhead/heading`, `--track-tight/heading/label` |
| Neutral base | `--bg`, `--bg-elev`, `--bg-inset` |
| Ink (always opaque) | `--text`, `--text-2`, `--text-3` |
| Accent & states | `--accent`, `--accent-ink`, `--accent-fill`, `--accent-edge`, `--accent-grad`, `--ok/warn/danger` (+ `-fill`, `-edge`), `--favorite`, `--selection`, `--focus-ring` |
| Glass materials | `--glass-primary`, `--glass-secondary`, `--glass-tinted`, `--glass-float`, `--glass-strong`, `--glass-highlight`, `--glass-edge` |
| Blur | `--blur-sm/md/lg/xl`, `--blur`, `--blur-strong` (blur + saturate) |
| Surfaces & strokes | `--fill`, `--fill-hover`, `--stroke`, `--stroke-2` |
| Shadows & edges | `--shadow-1/2/3` (soft, layered, ambient), `--highlight` (inner top edge) |
| Radii | `--r-sm` 8 · `--r-md` 12 · `--r-lg` 18 · `--r-xl` 26 · `--r-pill` |
| Spacing | `--space-1…12` (4…48) |
| Motion | `--duration-fast` 150ms (micro) · `--duration-normal` 260ms (standard) · `--duration-slow` 380ms (structural); `--ease`, `--ease-spring` (subtle overshoot), `--ease-in`, `--ease-out` |
| Layers | `--z-content` 1 · `--z-navigation` 50 · `--z-fab` 60 · `--z-popover` 80 · `--z-scrim` 90 · `--z-sheet` 100 · `--z-toast` 400 |
| Context | `--scrim`, `--lb-backdrop`, `--image-*`, `--source-a/b`, `--ambient-a/b/c` |

Core radii: **8 / 12 / 18 / 26**, plus true pills. Motion: **150 / 260 / 380ms**.
Web uses system fonts and semantic CSS type scales; native uses `AppText` variants.
Spacing scales are platform-tuned rather than mechanically identical.

### Material hierarchy

Four glass strengths, used by layer — glass is structural, never decorative:

- **Primary:** major navigation and structural headers (top bar, API-reference header).
  Most transparent fill, strongest blur + saturation; gains opacity and shadow on scroll.
- **Secondary:** cards, panels, the crawler region, quiet controls. Lightest visual
  weight; flatter.
- **Tinted:** selected/emphasized states only (pressed chips, active filter pills,
  favorite hearts). An accent wash, never a colorful backdrop behind content.
- **Floating:** menus, dialogs, sheets, toasts, viewer panel, FAB, overlay controls.
  Strongest fill so text stays readable over variable imagery.
- **Strong (near-opaque):** scrolled navigation, the mobile filter drawer, image-overlay
  controls — used where content behind is unpredictable.

CSS blur uses pixel tokens (10/20/28/40). Expo BlurView intensity uses platform units
(12/28/40/20), **not** a pixel conversion. iOS may blur structural surfaces;
Android/web and reduced-transparency mode use an opaque semantic surface. Web also
has `@supports` and reduced-transparency fallbacks. Do not animate blur itself.

### Background

A fixed ambient layer (`.ambient`) paints three extremely soft radial colour fields
(sage, warm sand, cool grey) over the base plus a fine static grain (SVG turbulence,
overlay blend, ~5%). The fields are almost invisible until glass moves over them; they
exist to give the materials something to refract. The base colour crossfades on theme
switch. No animated background layers — battery friendly.

## Layout and components

Desktop: floating glass top navigation, a quiet 232px filter rail, a content-first
gallery, and a compact sort/view toolbar. Cards separate titles/metadata from
photographs; hover elevation is a 3px rise with a soft shadow deepen and a slow photo
zoom — almost subconscious. List mode is a lightweight hairline row, not a smaller
glass card. The crawler remains a distinct operational region on secondary glass with
readable progress, states and its existing controls.

Primary actions use a solid accent with a subtle top sheen. Secondary actions use a
quiet translucent fill with a hairline; ghost controls stay lightweight and gain a
surface only on hover. Photo-overlay buttons are high-contrast glass discs that invert
to near-white on hover. Shared native controls and main browser actions target at
least 44px/dp; compact desktop-only secondary elements may be smaller. Loading,
empty and error states use shared vocabulary: a floating glass icon tile, one title,
one explanation and one obvious action. Skeletons mirror the card structure with a
soft shimmer. Toasts are floating glass, entering from the bottom edge.

At 960px the browser rail becomes a floating glass filter drawer (blurred scrim,
spring slide, focus trap). At small widths the header uses two rows; the gallery
deliberately keeps two columns; sort/filter/view controls fit together, with an
icon-only, labeled Filters button at 380px and below.

Native: a floating bottom tab bar, material headers, safe-area-aware content clearance,
captioned image tiles, neutral list rows and quiet grouped settings. At very small
widths or large font scaling, header actions and control groups wrap instead of
shrinking their touch targets. The tag rail has bounded, font-scale-aware height.

## Interaction and accessibility contracts

- Motion budget: micro-interactions 150ms, standard transitions 260ms, larger
  modal/viewer transitions 380ms. Interactive elements use spring-like easing with
  subtle overshoot; structural transitions settle smoothly. Only `transform`,
  `opacity` and `filter` are animated — no layout thrash, no JS animation loops.
- Signature micro-interactions: staggered card entrance, spring-sliding segmented
  indicator, heart pop on favorite, menu/dialog/toast springs, progressive image
  blur-up in the viewer, scroll-evolving top bar, theme crossfade.
- Browser modal dialogs, menus and viewer have cancellable exit lifecycles. Reopening
  cancels stale close timers; existing browser Back/deep-link semantics remain intact.
- The mobile-width browser filter drawer traps Tab/Shift+Tab, closes on Escape/scrim,
  marks the background inert, locks body scrolling, and restores the filter trigger.
  Entry visibility changes immediately so initial keyboard focus is never lost.
- Browser toasts are reparented into the active HTML dialog's top layer and return
  to the page when it closes. Native sheets register a modal toast layer, because
  a root view's z-index cannot cross an OS Modal surface; feedback is not duplicated.
- Native sheets/toasts retain content through their exit animation. Interrupted exits
  stop their animation callbacks. Press feedback uses transform/opacity, never layout.
- Focus, hover, pressed, selected and disabled states are explicit. Every interactive
  element has a visible `:focus-visible` ring (`--focus-ring`). Destructive and
  warning colors remain semantic; color is not the sole signal.
- Web respects `prefers-reduced-motion` (all animation disabled, essential state
  changes remain visible) and `prefers-reduced-transparency` (opaque semantic
  surfaces). `forced-colors` gets explicit borders and highlight outlines.
- Text is opaque. Automated tests verify normal-size semantic text at **4.5:1** against
  base/elevated opaque surfaces, plus primary-button text in both themes. This is a
  token-level check, **not** a claim of a complete WCAG certification or every possible
  translucent/image composite. Continue manual contrast and assistive-technology checks.

## Single sources of truth

| Foundation | Browser | Expo |
|---|---|---|
| Semantic palettes, material strengths, spacing, radii, type, motion, layers | `static/css/tokens.css` | `mobile/src/theme/tokens.ts` |
| Component/layout rules | `static/css/app.css` | `mobile/src/components/` |
| Appearance and accessibility preferences | `theme-init.js`, CSS media queries, `app.js` | `ThemeProvider.tsx` |
| Structural material | top bar/menu/modal/viewer rules | `ui/GlassBackdrop.tsx` |
| Press/focus feedback | shared button/chip rules | `ui/Pressable.tsx` |
| API-reference adaptation | `static/css/api-docs.css` | Not applicable |
| Existing sun/mountain app icon, recolored | `scripts/make_icons.py` → `static/icons/` | Same generator → `mobile/assets/` |

## Coverage and consistency audit

| Area | Work / verification |
|---|---|
| Web grid/list, search, filters, sort, pagination, favorites | Shared tokens/cards/forms; browser flow tests, light/dark and responsive inspection |
| Web crawler, statistics, progress/logs | Restyled existing structures on secondary glass; idle control-panel visual inspection with a mocked writable status; no live crawl initiated |
| Web viewer | Floating detail material, restrained image frame, blur-up progressive loading, actions/nav/metadata; image navigation, favorites, Escape and hash cleanup regression tests |
| Web menus, About, shortcuts, toasts | Consistent floating material, spring open/close, keyboard and exit behavior; browser flow tests including top-layer toast visibility |
| Web loading/empty/error/offline/read-only | Shared state surfaces and recovery copy; existing defensive loading/storage tests retained |
| API reference | Token-based surrounding chrome and Swagger overrides; self-hosted/CSP browser test retained |
| Native Browse, favourites, history | Captioned tiles/list rows, floating navigation, neutral headers and empty states; component tests and Expo web route smoke |
| Native search, tags, directory | Shared fields/chips/rows/type; Expo web route smoke and visual inspection |
| Native settings and About | Quieter groups, semantic statuses, theme controls; light/dark inspection |
| Native detail, filters and wallpaper actions | Shared floating material/sheet lifecycle; detail/filter visual inspection and existing action-chain component tests |
| Native motion, transparency, focus and loading | Shared primitives, opaque fallback, static skeletons; preference subscription/cleanup and contrast tests |
| Brand/PWA/splash | Matching sage icon assets, matching launch background, versioned web shell |

### Checks performed

- Python regression suite, Node core/service-worker tests, native Jest tests, Ruff,
  TypeScript and zero-warning ESLint.
- Ten Chromium tests under the actual server CSP, including 320/390/768px layouts,
  both themes, main touch-target dimensions, drawer focus, dialog/viewer flows,
  reduced motion and semantic contrast.
- Static-site allow-list build and Expo web export.
- Supplemental Chromium smoke across all nine Expo routes with network-isolated
  preview fixtures; no uncaught page errors. Inspected native-style Browse, settings,
  directory, detail and filter layouts through React Native Web. This caught the
  native-only photo-module eager import and web animation/accessibility differences.
- Final web screenshots cover dark/light gallery, phone layout, viewer, About,
  API reference and the crawler region. Wait for content and transition completion
  when capturing: mid-animation screenshots are not valid visual regressions.

## Remaining validation and maintenance rules

**Not verified on native hardware:** iOS blur, Dynamic Type/VoiceOver, Android TalkBack,
physical safe areas, OS wallpaper/Photos flows, background rotation and native frame
rate. Expo web rendering cannot certify native behavior. Safari/Firefox and touch-device
blur performance also need manual checks. Existing advisory/real-library/authentication
release gates in [REVIEW.md](REVIEW.md) and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)
still apply; no claim of a completed live crawl, native build or production rollout.

Before adding UI: choose an existing token/primitive; keep blur structural; provide
labels/focus/recovery; check both themes at 320px, tablet and desktop; test reduced
motion; verify sheet reopening and safe-area/tab clearance; rerun the test suites.
When shell assets change, bump the app/versioned URLs and service-worker cache together.
Do not introduce a CDN, inline script/style workaround, or loosen the CSP for styling.
Do not hard-code colors outside `tokens.css` — accents, states and materials are tokens.
