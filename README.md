# plasma-web-interface

A browser-based replacement for the **QtPlasmaC** screen — plasma cutter control for
LinuxCNC in a touch-friendly web UI, with a Python backend on the machine.

**Status: milestone M0 (foundation).** The lcncgui application skeleton is vendored and
boots against a QtPlasmaC config; no plasma-specific code exists yet. See
[`BUILD_PLAN.md`](BUILD_PLAN.md) for the full plan and milestones, and
[`plan.md`](plan.md) for the original brief.

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
  running and the tool table come from lcncgui.

See [`UPSTREAM.md`](UPSTREAM.md) for exactly what is vendored, what is reused at
runtime, and the rules for both.

## Layout

```
backend/            FastAPI + WebSocket backend (vendored from lcncgui)
  plasma/           plasma domain logic                       (M1+)
  adapters/         LinuxCNC + HAL access
src/                React + TypeScript frontend (vendored from lcncgui)
  screens/plasma/   MAIN / PARAMETERS / SETTINGS / STATISTICS /
                    CONVERSATIONAL / MATERIAL                 (M1+)
bin/plasmacweb      LinuxCNC [DISPLAY] launcher
reference/          read-only upstream clones (git-ignored)
docs/               upstream docs + UPSTREAM_README.md
```

## Development

Requires Node 18+ and Python 3.9+. The backend needs LinuxCNC's `linuxcnc` and `hal`
Python modules, which only exist on a LinuxCNC install — off-machine, plasma code falls
back to fakes and fixtures (M1+).

```bash
npm install
npm run dev            # Vite dev server
npm test               # vitest
npm run lint

python -m backend.main # backend (needs the linuxcnc module)
pytest backend/tests
```

Five backend tests fail off-machine and are inherited from upstream — see
[`docs/UPSTREAM_TEST_BASELINE.md`](docs/UPSTREAM_TEST_BASELINE.md) before treating a
red suite as new.

## Running on a machine

Install per [`docs/installation.md`](docs/installation.md), then in the machine INI:

```ini
[DISPLAY]
DISPLAY = plasmacweb
```

The integration target is the QtPlasmaC simulator config shipped with LinuxCNC
(`configs/sim/qtplasmac/`), whose `sim-torch` component supplies a synthetic arc voltage.

## License

GPL-3.0-or-later. See [`LICENSE`](LICENSE) and [`UPSTREAM.md`](UPSTREAM.md).
