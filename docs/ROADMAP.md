# Roadmap

This page tracks **work that is not already shipped**. Shipped capabilities are in the
[README](../README.md), implementation contracts in the relevant guides, and dated changes in
the [CHANGELOG](../CHANGELOG.md). Priorities are suggestions; owner decisions and real-device
access are needed for a few items.

## Highest-value follow-up

| Proposal | Why it matters | Effort / dependency |
|---|---|---|
| **Resolve the mobile dependency audit findings** | `npm audit` currently reports five high-severity findings in the Expo toolchain. Its automatic remediation proposes downgrading Expo to 44, incompatible with this SDK 57 app. Investigate upstream compatible releases and validate with the native release matrix; do not force a downgrade. | High; upstream/toolchain |
| **Build and exercise signed Android/iOS releases on real devices** | JS tests and Hermes exports do not prove Kotlin/Swift compilation, OS permission behavior, background scheduling, or lifecycle correctness. | High; toolchains, signing and device QA |
| **Test desktop wallpaper integration on Windows** | Windows COM monitor enumeration, per-display selection, fit modes, and shell/tray behavior need Windows validation. | Medium; Windows runner/device |
| **Document and verify source-site terms / LFS budgets** | The catalog contains third-party wallpapers; publishing, retention, request rates, attribution, and Git LFS bandwidth need owner review. | High; owner/legal review |
| **Add an authenticated remote-control option** | The local API deliberately has no built-in authentication. Remote writable use should require an authenticated TLS reverse proxy or a carefully designed token/session model, plus rate limits. | Medium; threat-model decision |

## Product and scale

| Proposal | Why it matters | Effort |
|---|---|---|
| **Duplicate-review workflow** | Let users compare close perceptual matches and choose to keep both before destructive cleanup. | Medium |
| **Virtualized catalog browsing** | Current client-side filtering and pagination are appropriate for the present ~7,500-row catalog. Virtualization or cursor pagination becomes valuable if catalog size grows substantially. | Medium; scale-triggered |
| **Stable favorite identity and migration** | Current portable favorites are filename-keyed. Rebuilds or alternate-resolution files can leave unmatched keys; a stable content identity needs migration rules. | Medium; compatibility design |
| **Installer / signed desktop package with update channel** | A PyInstaller/MSIX distribution could simplify installation, but requires signing, platform testing, rollback and update policy. | Large |
| **Localization** | Translate UI labels and accessibility strings once the initial supported language set is chosen. | Medium |
| **Additional source plug-ins** | New sources need explicit permission/terms review, resilient parsers, tests and attribution policy before implementation. | Medium–large |

## Operations and maintenance

- **Dependency reproducibility:** add reviewed Python locks/SBOMs for each supported OS and automate upgrade PRs only after compatibility checks.
- **Observability:** a privacy-preserving metrics endpoint and structured diagnostics could help long-running self-hosted instances.
- **Backup/restore workflow:** document or automate consistent stopped-instance backups of the SQLite database, images and LFS-backed content.
- **Network politeness:** periodically verify rate limits, robots/terms and source availability; keep crawl concurrency conservative and configurable.

## Deliberately not planned

- Accounts, comments, user uploads, analytics or cross-device cloud synchronization. The project has no account backend and avoids tracking.
- Re-hosting or redistributing images outside the existing repository/LFS model without explicit rights and storage review.
- Promising precise OS wallpaper scheduling where platform APIs provide only best-effort background execution.

## Already implemented

The following items were proposed by older roadmap versions and are now shipped: WebP previews with original downloads, palette/aspect metadata and filters, viewer pan/zoom, batch favorites/downloads, named collections, shared favorites JSON backups, desktop rotation/tray controls, Windows fit/per-monitor controls, Roku Ambient Mode timers/dimming, catalog validation, CI deployment, and mobile gallery enhancements. See [README feature notes](../README.md) and the [API guide](API.md).
