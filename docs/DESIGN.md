# Still Glass — design system and consistency audit

Release **2.4.0** · 2026-10-07 · web/PWA and the Expo client.

## Direction

An original, Apple-inspired material language, not a replica of an Apple application.
Photography is the content; chrome provides orientation. Warm off-white and deep
charcoal-green backgrounds, restrained sage accents, strong text hierarchy and generous
spacing replace saturated gradients, glow, and glass on every tile.

The real database, catalog, image archive, API contracts, deep links, preferences and
wallpaper workflows are unchanged by the redesign. Screenshots use an **isolated,
generated illustration library**, not the real photographers' images. No preview
fixtures are stored in the production catalog.

## Single sources of truth

| Foundation | Browser | Expo |
|---|---|---|
| Semantic palettes, material strengths, spacing, radii, type, motion, layers | `static/css/tokens.css` | `mobile/src/theme/tokens.ts` |
| Component/layout rules | `static/css/app.css` | `mobile/src/components/` |
| Appearance and accessibility preferences | `theme-init.js`, CSS media queries, `app.js` | `ThemeProvider.tsx` |
| Structural material | `.glass`, navigation, modal and viewer rules | `ui/GlassBackdrop.tsx` |
| Press/focus feedback | shared button/chip rules | `ui/Pressable.tsx` |
| API-reference adaptation | `static/css/api-docs.css` | Not applicable |
| Existing sun/mountain app icon, recolored | `scripts/make_icons.py` → `static/icons/` | Same generator → `mobile/assets/` |

Core radii: **8 / 12 / 18 / 26**, plus true pills. Motion: **150 / 260 / 380ms**.
Web uses system fonts and semantic CSS type scales; native uses `AppText` variants.
Spacing scales are platform-tuned rather than mechanically identical.

### Material hierarchy

- **Primary:** navigation and structural headers. Translucent fill, quiet hairline,
  small inner highlight; blur is limited to the layers that need it.
- **Secondary:** low-emphasis controls and selected regions; flatter and lighter.
- **Tinted:** selection/primary emphasis, not a colorful backdrop behind every section.
- **Floating:** dialogs, sheets, toasts and viewer details. Stronger fill preserves
  text readability over variable imagery.
- **Plain surfaces:** gallery captions, lists, filters, ordinary content and settings
  groups. No repeated backdrop filters on photo tiles or list rows.

CSS blur uses pixel tokens (10/20/28). Expo BlurView intensity uses platform units
(12/28/40/20), **not** a pixel conversion. iOS may blur structural surfaces;
Android/web and reduced-transparency mode use an opaque semantic surface. Web also
has `@supports` and reduced-transparency fallbacks. Do not animate blur itself.

## Layout and components

Desktop: floating top navigation, a quiet 232px filter rail, a content-first gallery,
and a compact sort/view toolbar. Cards separate titles/metadata from photographs.
List mode is a lightweight row, not a smaller glass card. The crawler remains a distinct
operational region with readable progress, logs, states and its existing controls.

At 960px the browser rail becomes a modal filter drawer. At small widths the header
uses two rows; the gallery deliberately keeps two columns; sort/filter/view controls
fit together, with an icon-only, labeled Filters button at 380px and below.

Native: a floating bottom tab bar, material headers, safe-area-aware content clearance,
captioned image tiles, neutral list rows and quiet grouped settings. At very small
widths or large font scaling, header actions and control groups wrap instead of
shrinking their touch targets. The tag rail has bounded, font-scale-aware height.

Primary actions use a solid accent. Secondary actions use quiet fill/border; ghost
controls stay lightweight. Photo-overlay buttons use a high-contrast dark fill in
both themes. Shared native controls and main browser actions target at least 44px/dp;
compact desktop-only secondary elements may be smaller. Loading, empty and error
states use shared vocabulary, useful guidance and recovery actions. Native skeletons
are intentionally static; browser skeleton motion is disabled with reduced motion.

## Interaction and accessibility contracts

- Browser modal dialogs, menus and viewer have cancellable exit lifecycles. Reopening
  cancels stale close timers; existing browser Back/deep-link semantics remain intact.
- The mobile-width browser filter drawer traps Tab/Shift+Tab, closes on Escape/scrim,
  marks the background inert, locks body scrolling, and restores the filter trigger.
  Entry visibility changes immediately so initial keyboard focus is not lost.
- Browser toasts are reparented into the active HTML dialog's top layer and return
  to the page when it closes. Native sheets register a modal toast layer, because
  a root view's z-index cannot cross an OS Modal surface; feedback is not duplicated.
- Native sheets/toasts retain content through their exit animation. Interrupted exits
  stop their animation callbacks. Press feedback uses transform/opacity, never layout.
- Focus, hover, pressed, selected and disabled states are explicit. Destructive and
  warning colors remain semantic; color is not the sole signal.
- Web respects `prefers-reduced-motion`. Native subscribes to OS motion/transparency
  changes, removes listeners on unmount, and safely handles absent web capabilities.
- Text is opaque. Automated tests verify normal-size semantic text at **4.5:1** against
  base/elevated opaque surfaces, plus primary-button text in both themes. This is a
  token-level check, **not** a claim of a complete WCAG certification or every possible
  translucent/image composite. Continue manual contrast and assistive-technology checks.

## Coverage and consistency audit

| Area | Work / verification |
|---|---|
| Web grid/list, search, filters, sort, pagination, favorites | Shared tokens/cards/forms; browser flow tests, light/dark and responsive inspection |
| Web crawler, statistics, progress/logs | Restyled existing structures; idle control-panel visual inspection with a mocked writable status; no live crawl initiated |
| Web viewer | Floating detail material, restrained image frame, actions/nav/metadata; image navigation, favorites, Escape and hash cleanup regression tests |
| Web menus, About, shortcuts, toasts | Consistent floating material, keyboard and exit behavior; browser flow tests including top-layer toast visibility |
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
