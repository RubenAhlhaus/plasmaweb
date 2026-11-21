# Changelog

All notable changes to lcncgui are documented here. Version numbers follow [Semantic Versioning](https://semver.org/).

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.1.13] - 2026-11-21

### Fixed

- Close with shutdown always said "System shutdown is not configured", even with the sudo grant in place: the backend looked for the shutdown helper under `LCNCGUI_ROOT`, and the launcher only exports `PLASMAWEB_ROOT`. It now finds the helper the same way the updater does.
- The step that waits for LinuxCNC to exit before powering off now runs in its own session (`setsid`), like the restart helper, so LinuxCNC's exit cleanup cannot stop it.

## [1.1.12] - 2026-11-21

### Added

- A torch pulse time setting on the plasma Parameters screen (0.1-10 s, default 1 s), stored as QtPlasmaC's `[GUI_OPTIONS] Torch pulse time`. The section heading is now "Interface".

### Fixed

- TORCH PULSE did nothing on LinuxCNC 2.9: the button never sent a pulse time, and `plasmac.torch-pulse-time` starts at 0. Each press now sends the saved time.

## [1.1.11] - 2026-11-21

### Security

- The same-origin check on `POST /api/update/install` and `/api/update/restart` could be passed by DNS rebinding (another site's domain pointed at the controller, so `Origin` and `Host` agree). The `Host` must now also name the controller: an IP address, `localhost`, its own hostname (also with `.local`), or a name in the new `PLASMAWEB_ALLOWED_HOSTS`.

### Fixed

- `plasmaweb-update` gave up on a dropped connection ("Recv failure: Connection reset by peer"): curl's `--retry` skips that error. It now passes `--retry-all-errors` where curl supports it.

## [1.1.10] - 2026-11-21

### Security

- `POST /api/update/install` and `POST /api/update/restart` refuse requests from another site's page (an `Origin` that does not match the host). The UI has no authentication on the LAN, so any page open in a browser on that network could otherwise install an update or restart LinuxCNC.

### Changed

- The latest-release check is reused for 10 minutes instead of 6 hours, so reloading the page picks up a new release soon after it is published.

## [1.1.9] - 2026-11-21

### Added

- **Restart LinuxCNC after updating**: the update dialog restarts LinuxCNC once the install succeeds (on by default), so the new version runs straight away; the machine is turned off first and the page reloads when the new version is up. **Settings → Updates** gets a **Restart LinuxCNC** button for an update installed without it. Refused while a program runs. Only offered when plasmaweb was started by LinuxCNC as its display; `bin/plasmaweb` does the restart from a helper in its own session, logging to `~/.local/share/plasmaweb/restart.log`. The first update to this release still needs a manual restart.

### Fixed

- `bin/plasmaweb` waited only for the local browser to exit, so **Close** from another device stopped the backend but left LinuxCNC running behind the Pi's own window. It now ends the session when the backend exits too.

## [1.1.8] - 2026-11-21

### Fixed

- Jogging by axis failed on machines whose kinematics are not identity (e.g. an XYYZ gantry) with "Axis jogging is only allowed in world/teleop mode": homing leaves LinuxCNC in joint mode and plasmaweb never switched it to world (teleop) mode. An axis jog now switches once every joint is homed, as AXIS and QtPlasmaC do, and otherwise names the joints still to home. Until every joint is homed, a homed single-joint axis jogs by joint; a gantry axis is never jogged by one of its joints.

## [1.1.7] - 2026-11-21

### Security

- `install.sh --setup-shutdown` / `--setup-update` no longer change file owners. In 1.1.6 they handed the whole install to root before granting passwordless sudo, so a helper another user had edited could end up running as root. They now refuse an install that is not root-owned and say to reinstall from a release. A full install as root hands only the paths the release replaces to root before overwriting them, and copies without the release files' owner (`rsync -rlpt`, `cp --preserve=mode,timestamps`).

## [1.1.6] - 2026-11-21

### Fixed

- GUI update and shutdown were refused after installing a release tarball as root: the tarball recorded the build machine's file owner (uid 1001), which tar and `rsync -a` kept, so the helpers were not root-owned. Release tarballs now record root as the owner, and `install.sh` run as root hands a root-owned prefix to root and drops group/other write, including in `--setup-shutdown` / `--setup-update` mode, so those commands repair an affected install.

## [1.1.5] - 2026-11-21

### Changed

- Jog speed and override limits follow the INI's `[DISPLAY]` section instead of fixed values: `DEFAULT_LINEAR_VELOCITY`, `MIN_LINEAR_VELOCITY` and `MAX_LINEAR_VELOCITY` (units per second) set the jog speed slider's range and starting speed, the number-key speed shortcuts and the Shift fast jog; `MAX_FEED_OVERRIDE` and `MIN/MAX_SPINDLE_OVERRIDE` set the override sliders and the backend's clamp. A key the INI leaves out keeps the previous built-in value (jog 1-1000 mm/min starting at 100, overrides 1-200 %).

## [1.1.4] - 2026-11-16

### Fixed

- The **Plasma** tab never appeared when the INI had no Z `MAX_VELOCITY`/`OFFSET_AV_RATIO`: the backend sent the missing parameter ceiling as a bare `Infinity`, which is not valid JSON, so the browser dropped the whole plasma snapshot. A missing ceiling is now sent as `null`.
- `sudo ./install.sh` on Raspberry Pi OS (umask `0002`) left the install group-writable, so the shutdown and update sudo rules were refused. The installer now sets `umask 022`.
- `bin/plasmaweb` timed out waiting for the backend when NTP stepped the clock during boot (Pi without an RTC). Its waits now count polls instead of comparing wall-clock times.

## [1.1.2] - 2026-10-29

### Added

- **Update from the GUI**: on load the UI checks GitHub for a newer release and offers **Update now**, **Later** or **Skip this version**. **Settings → Updates** shows the installed version and a **Check for updates** button. `bin/plasmaweb-update` downloads the release over HTTPS, verifies its sha256 against `checksums.txt` and runs the new release's `install.sh`; installing is refused while a program runs. `sudo ./install.sh` grants passwordless sudo for that helper's `--as-root` mode only (`--setup-update [USER]` to re-apply). See [`docs/installation.md`](docs/installation.md#update-from-the-gui).

### Changed

- Feed override preset **0 %**: clamps to ~1 % when idle/MDI; while an AUTO program runs, requests pause and resumes when leaving 0 only after that pause is confirmed in status (and only if it came from the preset). Spindle **0 %** also clamps to ~1 % (see [`docs/features/18_OVERRIDE_PRESET_HOTKEYS.md`](docs/features/18_OVERRIDE_PRESET_HOTKEYS.md)).

### Fixed

- `install.sh` failed on a stock LinuxCNC ISO, which has no `rsync`; it now falls back to `cp`.
- `install.sh` never copied `VERSION` into the install, so an install could not tell which release it was.
- Re-running `$PREFIX/install.sh` (e.g. `--recreate-venv`) failed copying the tree onto itself.
- `install.sh` refuses to write a passwordless-sudo rule (shutdown or update) for a helper that is not root-owned, or that sits under a directory writable by group or others.
- Feed override presets: while at feed **0 %** (pause-ownership, last accepted preset ≤ 0 %, or status ~1 % before any preset), values **above 100 %** (encoder wrap to 125–200 %) are ignored so the machine cannot jump straight to full override (see [`docs/features/18_OVERRIDE_PRESET_HOTKEYS.md`](docs/features/18_OVERRIDE_PRESET_HOTKEYS.md)).

## [1.1.1] - 2026-09-21

### Added

- Mild steel cut presets from 1 mm to 10 mm in 0.5 mm steps, seeded into a machine that has no materials of its own. Speeds and pierce delays are interpolated from a published 60 A mechanized air-plasma chart; cut heights and arc voltages are starting points that have to be dialled in per torch (see `backend/plasma/materials.py`).
- **Settings → Connection → Interface address**: the URL to type on another machine, from `GET /api/network`. The browser cannot work this out for itself — on the machine's own panel it is opened at `127.0.0.1`, the one address nobody else can use.

### Changed

- The backend now binds **every interface** by default instead of loopback, because the usual controller is headless and driven from another machine on the network. **Nothing authenticates this interface** — whoever reaches port 8765 can fire the torch, jog the table and run a program. Set `PLASMAWEB_HOST=127.0.0.1` to serve the controller's own screen only, and see *Who can reach the interface* in [`docs/installation.md`](docs/installation.md).

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
