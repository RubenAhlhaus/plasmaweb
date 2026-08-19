# Installing lcncgui on a LinuxCNC controller

This guide is for **end users** who run lcncgui as the LinuxCNC display (like gmoccapy). You do **not** need Node.js on the machine — only a pre-built release archive.

Developers: see [`docs/frontend-web-start.md`](frontend-web-start.md) for the dev workflow (split Vite + backend ports).

## What you get after install

- `lcncgui` on your `PATH` (e.g. `/usr/local/bin/lcncgui`) **or** `$PREFIX/bin` on `PATH`
- Application files under `/opt/lcncgui` (or `~/.local/share/lcncgui` / custom `--prefix`)
- One process started by LinuxCNC that runs the **backend** and opens the **web UI** in a browser

## Requirements

| Requirement | Notes |
|-------------|--------|
| LinuxCNC | Installed and working; `python3 -c "import linuxcnc"` must succeed |
| `python3-venv` | `sudo apt install python3-venv python3-full` on Raspberry Pi OS / Debian |
| pip (in venv) | Created by `install.sh` — uses `backend/requirements-runtime.txt` only |
| HTTP probe | `curl` **or** `python3` (launcher waits for backend HTTP) |
| Browser | Chromium recommended (`chromium` or `chromium-browser`) |
| X11 display | For the kiosk/window (`$DISPLAY` set — normal LinuxCNC desktop) |

## 1. Download and extract

**Recommended:** download the latest **`lcncgui-<version>-linux.tar.gz`** from [GitHub Releases](https://github.com/salomom/lcncgui/releases). Each release includes a `checksums.txt` for optional verification (`sha256sum -c checksums.txt`).

To build a tarball yourself (maintainers / from source):

```bash
./scripts/build-release.sh          # creates dist-release/lcncgui-<ver>-linux.tar.gz
```

The release archive is **not tied to the build machine’s CPU** (e.g. building on a Raspberry Pi is fine for x86_64 controllers). What matters on the target is Linux + LinuxCNC + Python.

`dist-release/` is a **local build output** (tarball + staging tree). It is not installed automatically — run `install.sh` separately (see below). You can delete `dist-release/` after a successful install.

**On the same machine as the repo** (typical during development on the controller):

```bash
./scripts/build-release.sh
sudo ./install.sh                   # installs from the repo root (uses ./dist/)
```

**From the tarball** (typical when copying to another machine):

Copy the tarball to the controller, then:

```bash
tar xzf lcncgui-1.0.0-linux.tar.gz
cd lcncgui-1.0.0-linux
```

The archive contains a **top-level directory** with `bin/`, `backend/`, `dist/`, `install.sh`, `uninstall.sh`, `resources/`, `docs/`, and `VERSION`. Run `install.sh` from **that** directory (not from `dist-release/` itself).

## 2. Run the installer

**System-wide** (typical on a dedicated CNC PC / Raspberry Pi):

```bash
sudo ./install.sh
```

**Per-user** (no root):

```bash
./install.sh --user
```

Ensure `~/.local/bin` is on your `PATH` if you use `--user`.

**Custom location** (no symlink into `/usr/local/bin` — add `$PREFIX/bin` to `PATH`):

```bash
./install.sh --prefix /home/cnc/apps/lcncgui
export PATH="/home/cnc/apps/lcncgui/bin:$PATH"
```

**Recreate Python venv** (e.g. after a Python upgrade):

```bash
sudo ./install.sh --recreate-venv
```

**Uninstall** (removes install directory, PATH symlink, matching shutdown sudoers, and user data):

```bash
sudo ./uninstall.sh                   # system install (/opt/lcncgui)
./uninstall.sh --user                 # per-user install
sudo ./uninstall.sh --prefix /opt/lcncgui --keep-user-data   # keep settings / Chromium profile
```

Run `uninstall.sh` from the release directory or from `$PREFIX` after install. Use `--yes` to skip the confirmation prompt.

The installer:

1. Copies only release files (`bin/`, `backend/`, `dist/`, `resources/`, `install.sh`, `uninstall.sh`, `scripts/release-common.sh`, `docs/installation.md`)
2. Writes `dist/lcncgui-config.json` from `resources/lcncgui-config.production.json` (`"websocketUrl": "auto"`)
3. Creates **`$PREFIX/venv`** with `python3 -m venv --system-site-packages` (so the venv can `import linuxcnc` from the OS)
4. Runs `pip install -r backend/requirements-runtime.txt` **inside that venv** (avoids PEP 668 on Raspberry Pi OS)
5. Links `bin/lcncgui` into `/usr/local/bin` or `~/.local/bin` when appropriate
6. **System install (`sudo ./install.sh`):** grants the LinuxCNC user passwordless sudo for `$PREFIX/bin/lcncgui-shutdown` only (`--as-root`, `--dry-run`, `--as-root --dry-run`), so **Fenster schließen und herunterfahren** in the exit dialog can power off the PC

### Shut down the PC from the GUI

The power icon in the header opens an exit dialog:

- **Fenster schließen** — closes the browser and stops the backend
- **Fenster schließen und herunterfahren** — same, then powers off the controller

**System-wide install** (`sudo ./install.sh`): shutdown permissions are configured automatically for the user who ran `sudo` (e.g. `cnc`).

**Per-user install** (`./install.sh --user`): run once as root after install:

```bash
sudo ./install.sh --prefix ~/.local/share/lcncgui --setup-shutdown
```

Use an explicit username if LinuxCNC runs as another account:

```bash
sudo ./install.sh --prefix /opt/lcncgui --setup-shutdown cnc
```

This writes `/etc/sudoers.d/lcncgui-shutdown-<user>` allowing **only** `$PREFIX/bin/lcncgui-shutdown` with arguments `--as-root`, `--dry-run`, or `--as-root --dry-run` without a password. The helper tries a normal session poweroff first (`loginctl`); sudo is used only when needed.

**Shutdown sequence** (exit dialog → **Fenster schließen und herunterfahren**):

1. Backend aborts motion and switches the machine off (`machine.abort`, then `machine.power` off)
2. Backend writes a marker file and returns `ok`; the browser closes and the backend stops
3. `bin/lcncgui` exits → LinuxCNC shuts down normally (DISPLAY program ended)
4. A detached job in `bin/lcncgui` waits for the LinuxCNC process to exit (max. 60 s), then runs `lcncgui-shutdown` (system poweroff). Logs: `~/.local/share/lcncgui/shutdown.log`. The shutdown marker file is removed only immediately before poweroff.

To re-apply after moving the install prefix:

```bash
sudo ./install.sh --prefix /opt/lcncgui --setup-shutdown cnc
```

### Upgrading an existing install

Re-run `install.sh` from a new release tarball (or from the repo root after `./scripts/build-release.sh`) to refresh application files and rewrite `dist/lcncgui-config.json` from the production template. **Restart LinuxCNC** after upgrading so the backend and browser load the new `dist/` files.

The backend serves `index.html` and `lcncgui-config.json` with **`Cache-Control: no-cache, no-store, must-revalidate`**, so Chromium’s persistent kiosk profile (`~/.local/share/lcncgui/chromium-profile`) re-fetches the shell after an upgrade and picks up new Vite asset hashes. Content-hashed files under `dist/assets/` are served with **`Cache-Control: public, max-age=31536000, immutable`**. You do **not** need to clear the Chromium profile for a normal UI update.

If an older install (before this cache policy) still shows a stale UI after upgrade + restart, clear the HTTP cache once:

```bash
rm -rf ~/.local/share/lcncgui/chromium-profile/Default/Cache \
       ~/.local/share/lcncgui/chromium-profile/Default/Code\ Cache
```

Then start LinuxCNC again. Settings stored in that profile (`localStorage`, window mode preferences file elsewhere) are kept.

To keep a custom config, merge new keys manually into `$PREFIX/dist/lcncgui-config.json` instead.

**Virtual sidebar:** Production config sets `"showVirtualSidebar": true` (left softkey column visible for first-time visitors). Turn it off under **Settings** if you want more screen space. That choice is stored in the browser profile (`localStorage`, key `lcncgui.showVirtualSidebar`) and overrides the config file on later sessions. The kiosk launcher uses a dedicated Chromium profile at `~/.local/share/lcncgui/chromium-profile` (override with `LCNCGUI_CHROMIUM_PROFILE`).

**Window mode:** Under **Settings → Display → Window mode**, choose fullscreen (kiosk) or a normal window with title-bar buttons. The choice is saved to `~/.local/share/lcncgui/user-preferences.json` as `"kioskMode"` and applies on the next lcncgui start (override at launch with `LCNCGUI_KIOSK=0` or `LCNCGUI_KIOSK=1`). See [`docs/features/08_WINDOW_MODE.md`](features/08_WINDOW_MODE.md).

**LinuxCNC autostart:** Under **Settings → Display → Run LinuxCNC at startup**, enable automatic LinuxCNC launch after graphical login using the current INI. Writes `~/.config/autostart/linuxcnc-lcncgui.desktop`. See [`docs/features/14_LINUXCNC_AUTOSTART.md`](features/14_LINUXCNC_AUTOSTART.md).

## 3. Configure your machine INI

In your existing LinuxCNC config (or a copy of a sim config), set:

```ini
[DISPLAY]
DISPLAY = lcncgui
PROGRAM_PREFIX = nc_files
INCREMENTS = 1 mm, 0.5 mm, 0.1 mm
```

Supported `INCREMENTS` formats (comma-separated **or** gmoccapy/PNCconf space-separated with glued units):

```ini
INCREMENTS = 10mm 5mm 1mm .1mm .01mm .005mm
```

The UI shows at most **four** increment buttons (plus **Continuous**); additional INI values are ignored.

`DISPLAY = lcncgui` is the important line — LinuxCNC will run `lcncgui -ini "…"` after motion/IO/HAL are up, the same way it runs `gmoccapy`.

lcncgui also loads `[HAL] POSTGUI_HALFILE` (same as gmoccapy), so call-lists like `postgui_call_list.hal` → `pendant.hal` still apply. Avoid `gmoccapy.*` pins in those files when using lcncgui. Details: [`docs/features/16_POSTGUI_HALFILE.md`](features/16_POSTGUI_HALFILE.md).

Other `[DISPLAY]` keys (`PROGRAM_PREFIX`, `INCREMENTS`, `LATHE`, …) are read by the lcncgui backend from the active INI.

### Macro subroutines (optional)

If you use the **Macros** screen, set `SUBROUTINE_PATH` in your machine INI. After a normal release install (`install.sh`), the reference `.ngc` files are already under the install directory — **no manual copying required**.

**System install** (`sudo ./install.sh`):

```ini
[RS274NGC]
SUBROUTINE_PATH = /opt/lcncgui/resources/linuxcnc-subroutines
```

**Per-user install** (`./install.sh --user`):

```ini
[RS274NGC]
SUBROUTINE_PATH = ~/.local/share/lcncgui/resources/linuxcnc-subroutines
```

**Custom `--prefix`:** use `$PREFIX/resources/linuxcnc-subroutines` (the exact path is printed at the end of `install.sh`).

Restart LinuxCNC (or reload the config) so `o<lcncgui_drill> call` can resolve the subroutines.

**Upgrades:** When you update lcncgui, reinstall (or re-copy) the reference `.ngc` files under `SUBROUTINE_PATH` so motion-logic changes (for example initial approach order) take effect. Custom copies outside the install tree must be updated manually.

To customize motion logic, edit the `.ngc` files in that folder, or copy them elsewhere and point `SUBROUTINE_PATH` at your copy. See [`resources/linuxcnc-subroutines/README.md`](../resources/linuxcnc-subroutines/README.md).

### Custom HAL softkeys (optional)

To use the three configurable virtual sidebar buttons (**14**, **15**, **16** at the bottom of the sidebar), include the softkeys HAL snippet (oneshot + dbounce) from a **HALFILE** (e.g. `custom.hal`) — **not** from `POSTGUI_HALFILE` (`loadrt` must run in the main HAL phase):

```hal
source /opt/lcncgui/resources/linuxcnc-config/lcncgui-softkeys.hal
```

Then wire pulse and feedback pins (in the same HALFILE or in postgui), e.g.:

```hal
net lube-pulse  lcncgui-sk-14.out => mycomp.lube-trigger
net lube-active mycomp.lube-on     => lcncgui-sk-14-fb.in
```

Details: [`docs/features/13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md`](features/13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md).

### External panel HAL inputs (optional)

To drive virtual sidebar actions from a physical panel (buttons + optional status LEDs), include from a **HALFILE**:

```hal
source /opt/lcncgui/resources/linuxcnc-config/lcncgui-panel.hal
```

Wire trigger inputs to your panel buttons and status outputs to LEDs, e.g.:

```hal
net estop-key  parport.0.pin-12-in => lcncgui-panel-estop.in
net led-estop  lcncgui-panel-status-estop.out => parport.0.pin-02-out
```

If you use panel pins for HAL softkeys **14–16**, source the **combined** snippet instead of both separate files (LinuxCNC allows only one `loadrt dbounce`):

```hal
source /opt/lcncgui/resources/linuxcnc-config/lcncgui-panel-and-softkeys.hal
```

Enable panel polling (disabled by default):

```bash
export LCNCGUI_PANEL_HAL_ENABLED=1
```

Details: [`docs/features/15_PANEL_HAL_INPUTS.md`](features/15_PANEL_HAL_INPUTS.md).

### Manual tool change via HAL (optional)

By default lcncgui does **not** show a HAL tool-change dialog. To enable it (gmoccapy-style, with your HAL wiring):

```bash
export LCNCGUI_TOOLCHANGE_HAL_ENABLED=1
export LCNCGUI_TOOLCHANGE_ACK_CMD='halcmd setp …'   # your ack line
```

You can put these in `~/.profile`, a wrapper script, or your machine config’s `[APPLICATIONS]` section. Details: [`docs/features/05_TOOL_TABLE.md`](features/05_TOOL_TABLE.md).

## 4. Start LinuxCNC

Use the **config explorer** as usual, or:

```bash
linuxcnc ~/linuxcnc/configs/my-machine/my-machine.ini
```

LinuxCNC starts realtime/HAL, then runs `lcncgui`, which:

1. Starts the backend on `http://127.0.0.1:8765/` (WebSocket at `/ws`, UI from `dist/`)
2. Opens Chromium in kiosk or windowed mode (see **Settings → Display → Window mode**, `LCNCGUI_KIOSK`, or `ui.kioskMode` in `dist/lcncgui-config.json`; user override in `~/.local/share/lcncgui/user-preferences.json`)
3. Waits until you close the browser window

Click the **power icon** in the header to open an exit dialog:

- **Fenster schließen** / **Close window** — sends `app.exit`, stops the backend, closes the browser
- **Fenster schließen und herunterfahren** / **Close window and shut down** — same, then powers off the PC after LinuxCNC exits (requires shutdown permissions from `install.sh`; see **Shutdown sequence** above)

If the browser tab cannot be closed automatically (e.g. dev mode), an info toast appears after a short delay.

When the DISPLAY program exits, LinuxCNC shuts down normally.

## Environment variables (launcher)

| Variable | Default | Purpose |
|----------|---------|---------|
| `LCNCGUI_ROOT` | parent of `bin/` | Install directory |
| `LCNCGUI_HOST` | `127.0.0.1` | HTTP bind address |
| `LCNCGUI_PORT` | `8765` | HTTP + WebSocket port |
| `LCNCGUI_BROWSER` | auto | Browser executable |
| `LCNCGUI_KIOSK` | (unset) | When set: `1` = fullscreen kiosk, `0` = normal window. When unset, uses user preferences file, then `ui.kioskMode` in config, then kiosk. |
| `LCNCGUI_USER_PREFERENCES` | `~/.local/share/lcncgui/user-preferences.json` | JSON file for UI settings that affect the launcher (e.g. kiosk vs windowed) |
| `LCNCGUI_PYTHON` | auto | Python with `linuxcnc` module (prefers `$PREFIX/venv/bin/python`) |

## Troubleshooting

**`lcncgui: command not found`**  
Re-run `install.sh` or add `/usr/local/bin`, `~/.local/bin`, or `$PREFIX/bin` to `PATH`.

**`missing dist/index.html`**  
You need a release build with `dist/` included, not a source-only checkout (unless you ran `npm run build` first).

**`address already in use` / port 8765 busy**  
Another lcncgui or dev backend is still running (`python -m backend.main` / `uvicorn backend.main`). Stop it before starting LinuxCNC:

```bash
pkill -f 'uvicorn backend.main'
ss -tlnp | grep 8765
```

The launcher tries to stop a **stale lcncgui uvicorn** (same install dir) automatically.

**`externally-managed-environment` / pip refused during install**  
Use the current `install.sh` (venv under `$PREFIX/venv`). If venv creation fails: `sudo apt install python3-venv python3-full`. Retry with `./install.sh --recreate-venv`.

**`no Python with linuxcnc module`**  
LinuxCNC must be installed; use the same `python3` that can `import linuxcnc`, or set `LCNCGUI_PYTHON`.

**UI shows “disconnected”**  
Do not open `index.html` as `file://`. Installed builds use `"websocketUrl": "auto"` when UI and backend share port 8765.

**Blank browser / no Chromium**  
Install `chromium` or set `LCNCGUI_BROWSER=/path/to/browser`.

## Per-config launcher (optional)

LinuxCNC adds `<config-dir>/bin` to `PATH`. You can place a tiny wrapper there instead of a global install:

```bash
#!/bin/sh
export LCNCGUI_ROOT=/opt/lcncgui
exec /opt/lcncgui/bin/lcncgui "$@"
```

## INI snippet only

See [`resources/linuxcnc-config/ini-display-snippet.ini`](../resources/linuxcnc-config/ini-display-snippet.ini) for copy-paste `[DISPLAY]` / `[RS274NGC]` lines.

## Related docs

- Dev / manual start: [`docs/frontend-web-start.md`](frontend-web-start.md)
- WebSocket API: [`docs/backend-frontend-messages.md`](backend-frontend-messages.md)
- Backend: [`backend/README.md`](../backend/README.md)
