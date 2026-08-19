# Changelog

All notable changes to lcncgui are documented here. Version numbers follow [Semantic Versioning](https://semver.org/).

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Feed override preset **0 %**: clamps to ~1 % when idle/MDI; while an AUTO program runs, requests pause and resumes when leaving 0 only after that pause is confirmed in status (and only if it came from the preset). Spindle **0 %** also clamps to ~1 % (see [`docs/features/18_OVERRIDE_PRESET_HOTKEYS.md`](docs/features/18_OVERRIDE_PRESET_HOTKEYS.md)).

### Fixed

- Feed override presets: while at feed **0 %** (pause-ownership, last accepted preset ≤ 0 %, or status ~1 % before any preset), values **above 100 %** (encoder wrap to 125–200 %) are ignored so the machine cannot jump straight to full override (see [`docs/features/18_OVERRIDE_PRESET_HOTKEYS.md`](docs/features/18_OVERRIDE_PRESET_HOTKEYS.md)).

## [1.0.0] - 2026-07-19

First stable release.

### Added

- GUI screenshots in the README for a clearer first impression.
- Program running / paused badges in the HeaderBar status area.
- Adjustable jog speed (mm/min) in the feed dialog.
- Optional machine-Z safety retract in the macro program header (also before mid-queue tool changes).
- Full-retract option for the standard drill macro (persistable; peck retracts to feed-start height).
- INI `[MACROS]` subroutines as Machine tiles in the macro queue.
- Success feedback on program Save / Save as.
- Restore last spindle tool after homing (gmoccapy-style), with `G43` after tool changes so length offsets apply.

### Changed

- Project license from MIT to **GPL-3.0-or-later** (see [`LICENSE`](LICENSE)).
- Installation guide: after `install.sh`, set `SUBROUTINE_PATH` to `$PREFIX/resources/linuxcnc-subroutines` only — reference `.ngc` files are shipped with the install; no manual copy step.
- Nested drill / helical-bore phases in a drill pattern prefill start / clearance heights from the parent pattern (`surfaceZ` + 5 mm, or legacy `safeZ`) instead of the machine Z; unused hole X/Y (and surface Z) are hidden when nested.
- Macro hole approach: raise-if-needed, then XY, then Z.
- Face milling uses absolute target Z instead of relative step-down.
- Unified asyncio publisher shutdown (`stop()` / task cancellation) across status and panel HAL publishers.
- i18n: persist locale only after a successful `changeLanguage`; export `i18nReady` for startup ordering (see [`docs/frontend-i18n.md`](docs/frontend-i18n.md)).
- Virtual sidebar enabled by default in the production config.
- Kiosk UI: `Cache-Control` headers to avoid stale assets after upgrades.

### Fixed

- Drill pattern circular layout: start angle **0°** places the first hole **above the centre (+Y)** (counter-clockwise from there).
- Nested drills no longer force a hardcoded pattern safe Z of 5 mm when the pattern has no `safeZ`.
- Continuous jog hold on touch panels (long-press context menu suppressed).
- Feed dialog clipping so the jog speed slider stays visible.
- HAL softkeys / POSTGUI wiring; jogwheel scale sync from the UI.
- WCS offsets: hydrate all systems from the VAR file so inactive rows stay consistent.
- MDI input keeps focus after send; only the Send control is gated.
- Face / helix macros no longer assign to read-only `#<_y>` / `#<_z>`.
- Frontend async paths no longer discard promise rejections silently (SonarQube-safe handling with logging).
- E2E machine setup and flaky specs against real LinuxCNC.

### Security

- GitHub Release workflow: third-party Actions pinned to full commit SHAs (documented in [`docs/releasing.md`](docs/releasing.md)).

## [0.7.0] - 2026-07-12

First public pre-release.

### Added

- Web GUI for LinuxCNC: jog/home, coordinates, machine E-stop and on/off, tool table, program editor, macros, settings.
- Install/uninstall scripts for LinuxCNC controllers (`install.sh`, `uninstall.sh`).
- Release build script (`scripts/build-release.sh`) and GitHub Releases CI workflow.
- Fluid responsive layout sized from the viewport (replaces fixed design-canvas scaling).

[Unreleased]: https://github.com/salomom/lcncgui/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/salomom/lcncgui/compare/v0.7.0...v1.0.0
[0.7.0]: https://github.com/salomom/lcncgui/releases/tag/v0.7.0
