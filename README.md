# plasma-web-interface

A browser-based replacement for the **QtPlasmaC** screen — plasma cutter control for
LinuxCNC in a touch-friendly web UI, with a Python backend on the machine.

**Status: feature-complete against QtPlasmaC, released as `v1.0`.** Milestones M0–M5 are
done and M6 (look, feel, customisability) is done except the virtual keyboard's custom
layouts. Every milestone was driven against a virtual LinuxCNC machine — the QtPlasmaC
simulator config on LinuxCNC 2.9.4, running in a VM — and an 88-check audit — happy path
plus adversarial input, scripts under `scripts/audit/` — passes.

**Not yet tested on real hardware.** Nothing here has cut metal on a physical table yet; the
author's table is still being built. Try it on a sim config first, and keep your QtPlasmaC
config to switch back to (one INI line, see [Running on a machine](#running-on-a-machine)).
[`BUILD_PLAN.md`](BUILD_PLAN.md) is the record of what was built, what it was measured
against, and what each pass found; [`plan.md`](plan.md) is the original brief.

## Design in one page

- **Drop-in.** The backend registers the same userspace HAL component name
  (`qtplasmac`, 91 pins) and reads the same files (`<machine>_material.cfg`,
  `<machine>.prefs`, the `[QTPLASMAC]` INI section) as QtPlasmaC. Switching a machine
  over means changing one INI line — and changing it back works too.
- **Dashboard and remote control only.** All reactive and timing-critical logic stays in
  the realtime `plasmac` HAL component. The backend writes setpoints and one-shot
  requests; realtime-owned pins are read-only, enforced by an explicit table in
  `backend/plasma/pins.py`. Losing the browser or the WebSocket never changes machine
  state.
- **HAL on its own thread.** A dedicated OS thread polls HAL every 50 ms via the native
  `hal` module and pushes diffs into the asyncio loop — never `halcmd` subprocesses, and
  never HAL calls from the event loop.
- **Reuse over reimplementation.** Conversational geometry, run-from-line and the G-code
  interpreter come from LinuxCNC's own pure-Python modules. Jog, DRO, MDI, program
  running and the tool table come from the vendored lcncgui application.

See [`UPSTREAM.md`](UPSTREAM.md) for exactly what is vendored, what is reused at
runtime, and the rules for both.

## What the UI covers

| Screen | What it is |
|---|---|
| MAIN | live plasma dashboard — arc voltage, THC state, LEDs, cut recovery, torch pulse, height override, single cut |
| PARAMETERS | the `[QTPLASMAC]` / prefs parameters, written back to `<machine>.prefs` |
| MATERIAL | cut materials from `<machine>_material.cfg`, including the `M190` material-change handshake |
| CONVERSATIONAL | LinuxCNC's own `plasmac` shape modules, driven from a web form |
| PREVIEW | toolpath preview and run-from-line |
| STATISTICS | cut counts, arc time, consumable statistics |

Plus everything the vendored application already did: jog and homing, MDI, program load
and run, the tool table, macros, HAL softkeys and external panel inputs.

**LinuxCNC version.** Verified on 2.9.4; the pin table is generated from a 2.10
`plasmac.comp`. Eighteen pins do not exist on 2.9.4 (moving pierce, tube cutting, laser
mode, slat height, offset feed rate). `backend/plasma/capabilities.py` works this out
from the pins the machine actually exports: the PARAMETERS tab lists those features as
unavailable and flags the settings that save to the prefs file but reach no pin here —
rather than leaving a control that looks like it works and reaches nothing.

## Layout

```
backend/
  plasma/                 plasma domain logic — pins, hal_bridge, materials,
                          parameters, conversational, toolpath, colors, capabilities
  handlers/plasma.py      plasma commands on the shared CommandBus
  services/               plasma_publisher.py + the vendored publishers
  adapters/               LinuxCNC + HAL access
src/
  screens/Plasma*.tsx     MAIN / PARAMETERS / MATERIAL / CONVERSATIONAL / PREVIEW
  components/plasma/      readouts, LEDs, toolpath canvas, recovery pad, panels
  store/plasmaSlice.ts    plasma state
bin/plasmaweb             the launcher (backend + kiosk browser)
bin/plasmacweb            thin alias, for INIs that say DISPLAY = plasmacweb
resources/                INI/HAL snippets and macro subroutines shipped to the machine
reference/                read-only upstream clones (git-ignored)
docs/                     installation, dev VM, WebSocket protocol, feature docs
```

## Development

Requires Node 18+ and Python 3.9+. The backend needs LinuxCNC's `linuxcnc` and `hal`
Python modules, which only exist on a LinuxCNC install — off-machine the plasma code
falls back to fakes and fixtures, and the whole test suite runs.

```bash
npm install
npm run dev            # Vite dev server
npm test               # vitest — 653 tests, 100 files
npm run lint

python -m backend.main # backend (needs the linuxcnc module)
pytest backend/tests   # 827 pass, 1 skipped off-machine
```

Both suites are green off-machine; a red one is a real failure, not inherited noise.
(The historical upstream baseline is kept at
[`docs/UPSTREAM_TEST_BASELINE.md`](docs/UPSTREAM_TEST_BASELINE.md) for diffing against
lcncgui, not as an excuse for failures here.)

Driving a real sim machine — VM access, deploying a build into it, making it actually
cut, and comparing against real QtPlasmaC — is in [`docs/dev-vm.md`](docs/dev-vm.md).

## Running on a machine

Install per [`docs/installation.md`](docs/installation.md), then in the machine INI:

```ini
[DISPLAY]
DISPLAY = plasmaweb
```

Nothing else in a QtPlasmaC config changes: the same `plasmac` realtime component, the
same POSTGUI halfiles, the same prefs and material files. Setting `DISPLAY` back to
`qtvcp qtplasmac` returns the machine to QtPlasmaC.

The integration target is the QtPlasmaC simulator config shipped with LinuxCNC
(`configs/sim/qtplasmac/`), whose `sim-torch` component supplies a synthetic arc voltage.

### Updates

An installed machine checks GitHub for a newer release when the UI loads and offers
**Update now**, **Later** or **Skip this version**. **Settings → Updates** shows the installed
version and a **Check for updates** button. Updating downloads the release tarball, verifies
its checksum and runs that release's `install.sh` over the install; restart LinuxCNC
afterwards. Details, permissions and network needs:
[*Update from the GUI*](docs/installation.md#update-from-the-gui).

## Releases

Pushing a `v*` tag builds `plasmaweb-<version>-linux.tar.gz` and publishes it with
checksums via GitHub Actions (`.github/workflows/release.yml`). See
[`docs/releasing.md`](docs/releasing.md). Publishing a non-prerelease is what offers the
update to every installed machine.

## License

GPL-3.0-or-later. See [`LICENSE`](LICENSE) and [`UPSTREAM.md`](UPSTREAM.md).
