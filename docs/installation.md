# Installing plasmaweb on a LinuxCNC controller

This guide is for **end users** who run plasmaweb as the LinuxCNC display (like gmoccapy or QtPlasmaC). You do **not** need Node.js on the machine — only a pre-built release archive.

plasmaweb is a **web replacement for the QtPlasmaC screen**: on a plasma machine it exports the same `qtplasmac` HAL component and reads and writes the same files QtPlasmaC does, so switching a machine over is one INI line. On a non-plasma machine it runs as an ordinary LinuxCNC GUI and the plasma layer simply stays inactive. The plasma-specific part of the setup is [Plasma: switching a QtPlasmaC machine over](#plasma-switching-a-qtplasmac-machine-over) below.

Developers: see [`docs/frontend-web-start.md`](frontend-web-start.md) for the dev workflow (split Vite + backend ports), and [`docs/dev-vm.md`](dev-vm.md) for running the QtPlasmaC sim in a VM.

## What you get after install

- `plasmaweb` on your `PATH` (e.g. `/usr/local/bin/plasmaweb`) **or** `$PREFIX/bin` on `PATH`
- Application files under `/opt/plasmaweb` (or `~/.local/share/plasmaweb` / custom `--prefix`)
- One process started by LinuxCNC that runs the **backend** and opens the **web UI** in a browser

## Requirements

| Requirement | Notes |
|-------------|--------|
| LinuxCNC | Installed and working; `python3 -c "import linuxcnc"` must succeed. Verified on **2.9.4**; 2.10 additionally enables moving pierce, tube cutting, laser mode, slat height and offset feed rate |
| A working machine config | For plasma: an existing **QtPlasmaC** config (the realtime `plasmac` component, a `[QTPLASMAC]` INI section, `<machine>.prefs` and `<machine>_material.cfg`). plasmaweb replaces the *screen*, not the config |
| `python3-venv` | `sudo apt install python3-venv python3-full` on Raspberry Pi OS / Debian |
| pip (in venv) | Created by `install.sh` — uses `backend/requirements-runtime.txt` only |
| HTTP probe | `curl` **or** `python3` (launcher waits for backend HTTP; the GUI updater downloads with either) |
| Browser | Chromium recommended (`chromium` or `chromium-browser`) |
| X11 display | For the kiosk/window (`$DISPLAY` set — normal LinuxCNC desktop) |

## 1. Download and extract

**Recommended:** download the latest **`plasmaweb-<version>-linux.tar.gz`** from [GitHub Releases](https://github.com/RubenAhlhaus/plasmaweb/releases). Each release includes a `checksums.txt` for optional verification (`sha256sum -c checksums.txt`).

To build a tarball yourself (maintainers / from source):

```bash
./scripts/build-release.sh          # creates dist-release/plasmaweb-<ver>-linux.tar.gz
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
tar xzf plasmaweb-1.0.0-linux.tar.gz
cd plasmaweb-1.0.0-linux
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
./install.sh --prefix /home/cnc/apps/plasmaweb
export PATH="/home/cnc/apps/plasmaweb/bin:$PATH"
```

**Recreate Python venv** (e.g. after a Python upgrade):

```bash
sudo ./install.sh --recreate-venv
```

**Uninstall** (removes install directory, PATH symlink, matching shutdown sudoers, and user data):

```bash
sudo ./uninstall.sh                   # system install (/opt/plasmaweb)
./uninstall.sh --user                 # per-user install
sudo ./uninstall.sh --prefix /opt/plasmaweb --keep-user-data   # keep settings / Chromium profile
```

Run `uninstall.sh` from the release directory or from `$PREFIX` after install. Use `--yes` to skip the confirmation prompt.

The installer:

1. Copies only release files (`bin/`, `backend/`, `dist/`, `resources/`, `install.sh`, `uninstall.sh`, `scripts/release-common.sh`, `docs/installation.md`)
2. Writes `dist/plasmaweb-config.json` from `resources/plasmaweb-config.production.json` (`"websocketUrl": "auto"`)
3. Creates **`$PREFIX/venv`** with `python3 -m venv --system-site-packages` (so the venv can `import linuxcnc` from the OS)
4. Runs `pip install -r backend/requirements-runtime.txt` **inside that venv** (avoids PEP 668 on Raspberry Pi OS)
5. Links `plasmaweb`, `plasmacweb` (the plasma alias) and `lcncgui` (the old name) into `/usr/local/bin` or `~/.local/bin` when appropriate — so any of the three `DISPLAY` names starts this GUI
6. **System install (`sudo ./install.sh`):** grants the LinuxCNC user passwordless sudo for `$PREFIX/bin/plasmaweb-shutdown` only (`--as-root`, `--dry-run`, `--as-root --dry-run`), so **Close window and shut down** in the exit dialog can power off the PC
7. **System install (`sudo ./install.sh`):** grants the LinuxCNC user passwordless sudo for `$PREFIX/bin/plasmaweb-update --as-root` only, so the GUI can install updates (see [Update from the GUI](#update-from-the-gui))
8. Copies the release's `VERSION` file into `$PREFIX`, which is how the backend knows which release it is

`rsync` is used when present but not required — the LinuxCNC ISO ships without it.

### Shut down the PC from the GUI

The power icon in the header opens an exit dialog:

- **Close window** — closes the browser and stops the backend
- **Close window und shutdown** — same, then powers off the controller

**System-wide install** (`sudo ./install.sh`): shutdown permissions are configured automatically for the user who ran `sudo` (e.g. `cnc`).

**Per-user install** (`./install.sh --user`): run once as root after install:

```bash
sudo ./install.sh --prefix ~/.local/share/plasmaweb --setup-shutdown
```

Use an explicit username if LinuxCNC runs as another account:

```bash
sudo ./install.sh --prefix /opt/plasmaweb --setup-shutdown cnc
```

This writes `/etc/sudoers.d/plasmaweb-shutdown-<user>` allowing **only** `$PREFIX/bin/plasmaweb-shutdown` with arguments `--as-root`, `--dry-run`, or `--as-root --dry-run` without a password. The helper tries a normal session poweroff first (`loginctl`); sudo is used only when needed.

**Shutdown sequence** (exit dialog → **Close window and shut down**):

1. Backend aborts motion and switches the machine off (`machine.abort`, then `machine.power` off)
2. Backend writes a marker file and returns `ok`; the browser closes and the backend stops
3. `bin/plasmaweb` exits → LinuxCNC shuts down normally (DISPLAY program ended)
4. A detached job in `bin/plasmaweb` waits for the LinuxCNC process to exit (max. 60 s), then runs `plasmaweb-shutdown` (system poweroff). Logs: `~/.local/share/plasmaweb/shutdown.log`. The shutdown marker file is removed only immediately before poweroff.

To re-apply after moving the install prefix:

```bash
sudo ./install.sh --prefix /opt/plasmaweb --setup-shutdown cnc
```

### Update from the GUI

When the UI loads, the backend asks GitHub for the [latest release](https://github.com/RubenAhlhaus/plasmaweb/releases/latest) (prereleases such as `v0.x` or `-rc` tags are never offered). If it is newer than the installed one, a dialog shows the release notes with three choices:

- **Update now** — installs it (see below)
- **Later** — closes the dialog; it asks again the next time the UI loads
- **Skip this version** — stays quiet until a newer release than this one appears (stored per browser, `localStorage` key `plasmaweb.skippedUpdateVersion`)

**Settings → Updates** always shows the installed version with a **Check for updates** button, so a skipped release can still be installed from there. A source checkout shows its `package.json` version and the latest release, but is never installed over — update it with `git pull`.

**What Update now does:** `$PREFIX/bin/plasmaweb-update` downloads `plasmaweb-<version>-linux.tar.gz` and `checksums.txt` from the release over HTTPS, refuses the tarball if its sha256 does not match, then runs the **new** release's `install.sh --prefix $PREFIX` — the same steps as [Upgrading an existing install](#upgrading-an-existing-install), done for you. The dialog shows the output as it runs. The install is refused while a program or MDI command is running.

**Restart LinuxCNC afterwards.** The running backend and the page already loaded in the browser keep working on the old version until then; Settings shows *"<version> installed — restart LinuxCNC to use it"*. Do not just reload the browser — the new UI would be talking to the old backend.

**Permissions:** a system install (`/opt/plasmaweb`) is root-owned, so `sudo ./install.sh` writes `/etc/sudoers.d/plasmaweb-update-<user>` allowing **only** `$PREFIX/bin/plasmaweb-update --as-root` (and its `--dry-run`) without a password. That mode takes no other arguments: it always installs the latest release of `RubenAhlhaus/plasmaweb`. `install.sh` refuses to write the rule unless the helper and every directory above it are root-owned and not writable by group or others, and the helper re-checks that before doing anything as root. A per-user install (`--user`) is writable by its owner and needs no sudo. To set up (or re-apply) the rule after install:

```bash
sudo ./install.sh --prefix /opt/plasmaweb --setup-update cnc
```

Without it, the dialog says the install cannot update itself and **Update now** stays disabled.

**Network:** updates need outbound HTTPS to `api.github.com`, `github.com` and `objects.githubusercontent.com`. The check result is cached for 6 hours (GitHub allows 60 unauthenticated API calls per hour per address); **Check for updates** always asks again. Without network the check just reports that it could not reach GitHub.

**Note:** the backend has no authentication (see [Who can reach the interface](#who-can-reach-the-interface)), so anyone who can reach port 8765 can also start an update. It can only ever install the latest checksummed release, but bind to `127.0.0.1` if that matters on your network.

Machines on **v1.1.1 or older** have no updater yet: install the next release by hand once (below); from then on it updates from the GUI.

### Upgrading an existing install

Re-run `install.sh` from a new release tarball (or from the repo root after `./scripts/build-release.sh`) to refresh application files and rewrite `dist/plasmaweb-config.json` from the production template. **Restart LinuxCNC** after upgrading so the backend and browser load the new `dist/` files.

The backend serves `index.html` and `plasmaweb-config.json` with **`Cache-Control: no-cache, no-store, must-revalidate`**, so Chromium’s persistent kiosk profile (`~/.local/share/plasmaweb/chromium-profile`) re-fetches the shell after an upgrade and picks up new Vite asset hashes. Content-hashed files under `dist/assets/` are served with **`Cache-Control: public, max-age=31536000, immutable`**. You do **not** need to clear the Chromium profile for a normal UI update.

If an older install (before this cache policy) still shows a stale UI after upgrade + restart, clear the HTTP cache once:

```bash
rm -rf ~/.local/share/plasmaweb/chromium-profile/Default/Cache \
       ~/.local/share/plasmaweb/chromium-profile/Default/Code\ Cache
```

Then start LinuxCNC again. Settings stored in that profile (`localStorage`, window mode preferences file elsewhere) are kept.

To keep a custom config, merge new keys manually into `$PREFIX/dist/plasmaweb-config.json` instead.

**Virtual sidebar:** Production config sets `"showVirtualSidebar": true` (left softkey column visible for first-time visitors). Turn it off under **Settings** if you want more screen space. That choice is stored in the browser profile (`localStorage`, key `plasmaweb.showVirtualSidebar`) and overrides the config file on later sessions. The kiosk launcher uses a dedicated Chromium profile at `~/.local/share/plasmaweb/chromium-profile` (override with `PLASMAWEB_CHROMIUM_PROFILE`).

**Window mode:** Under **Settings → Display → Window mode**, choose fullscreen (kiosk) or a normal window with title-bar buttons. The choice is saved to `~/.local/share/plasmaweb/user-preferences.json` as `"kioskMode"` and applies on the next plasmaweb start (override at launch with `PLASMAWEB_KIOSK=0` or `PLASMAWEB_KIOSK=1`). See [`docs/features/08_WINDOW_MODE.md`](features/08_WINDOW_MODE.md).

**LinuxCNC autostart:** Under **Settings → Display → Run LinuxCNC at startup**, enable automatic LinuxCNC launch after graphical login using the current INI. Writes `~/.config/autostart/linuxcnc-plasmaweb.desktop`. See [`docs/features/14_LINUXCNC_AUTOSTART.md`](features/14_LINUXCNC_AUTOSTART.md).

## 3. Configure your machine INI

In your existing LinuxCNC config (or a copy of a sim config), set:

```ini
[DISPLAY]
DISPLAY = plasmaweb
PROGRAM_PREFIX = nc_files
INCREMENTS = 1 mm, 0.5 mm, 0.1 mm
```

Supported `INCREMENTS` formats (comma-separated **or** gmoccapy/PNCconf space-separated with glued units):

```ini
INCREMENTS = 10mm 5mm 1mm .1mm .01mm .005mm
```

The UI shows at most **four** increment buttons (plus **Continuous**); additional INI values are ignored.

`DISPLAY = plasmaweb` is the important line — LinuxCNC will run `plasmaweb -ini "…"` after motion/IO/HAL are up, the same way it runs `gmoccapy`.

plasmaweb also loads `[HAL] POSTGUI_HALFILE` (same as gmoccapy), so call-lists like `postgui_call_list.hal` → `pendant.hal` still apply. Avoid `gmoccapy.*` pins in those files when using plasmaweb. Details: [`docs/features/16_POSTGUI_HALFILE.md`](features/16_POSTGUI_HALFILE.md).

Other `[DISPLAY]` keys (`PROGRAM_PREFIX`, `INCREMENTS`, `LATHE`, …) are read by the plasmaweb backend from the active INI.

### Plasma: switching a QtPlasmaC machine over

On a plasma table plasmaweb replaces the **screen** only. Change the one `[DISPLAY]` line in the config you already run:

```ini
[DISPLAY]
DISPLAY = plasmaweb
```

Everything else in a QtPlasmaC config stays exactly as it is — the realtime `plasmac` component, the `[QTPLASMAC]` section, the `[FILTER]` line that runs `qtplasmac_gcode.py`, your POSTGUI halfiles, and the machine's prefs and material files. Putting the original `qtvcp qtplasmac…` line back returns the machine to QtPlasmaC, and it reads everything plasmaweb wrote.

`DISPLAY = plasmacweb` works too: `bin/plasmacweb` is a thin alias for the same launcher, and `install.sh` links it onto `PATH` alongside `plasmaweb`. Nothing about the two differs at runtime — pick whichever name your config already uses.

**What it does at startup:**

1. The backend exports the `qtplasmac` HAL component with all **91** pins and calls `ready()` while it is being imported — *before* the launcher loads `[HAL] POSTGUI_HALFILE`, so the `net qtplasmac.*` lines in a QtPlasmaC config resolve exactly as they do under QtPlasmaC.
2. It recreates the HAL links QtPlasmaC makes at startup (`plasmac.axis-*-limit` from the INI, `plasmac` outputs into its own pins) and sets the output pins QtPlasmaC does not leave at zero.
3. It loads the machine's materials and plasma parameters and writes them to their setpoints, because a `plasmac` with parameters at zero cannot cut (`arc-max-starts` at 0 pauses on the first pierce, `pid-p-gain` at 0 freezes the THC).

**Files it reads and writes.** Both sit beside the INI and are named from `[EMC] MACHINE`:

| File | Holds |
|------|-------|
| `<machine>.prefs` | plasma parameters, GUI options, `[COLOR_OPTIONS]` |
| `<machine>_material.cfg` | cut materials |

They are read and written with the same `RawConfigParser` settings qtvcp uses, so QtPlasmaC can open a file this UI saved. As in QtPlasmaC, a write rewrites the whole file and **comments do not survive** — back both files up before the first run. A machine with no `.prefs` yet gets QtPlasmaC's defaults on the pins rather than zeros.

**Run one GUI at a time.** The `qtplasmac` HAL component name is unique in a HAL instance: QtPlasmaC and plasmaweb cannot both export it, and a stale backend from a previous run has the same effect. If the component cannot be exported, the UI still comes up but the plasma layer stays inactive and the log says `plasma: could not export the qtplasmac HAL component` — stop the other process and restart LinuxCNC.

**LinuxCNC version.** The pin table is generated from a 2.10 `plasmac.comp`. On 2.9.4 eighteen of those pins do not exist, so moving pierce, tube cutting, laser mode, dry run, slat height and the offset feed rate are listed as unavailable on the **PARAMETERS** tab, and a parameter that still saves to the prefs file but reaches no pin on this machine is flagged there with `!`. This is worked out from the pins the machine actually exports, not from a version string — a value that is real in the file and would work on a newer build is marked, not hidden.

To run plasmaweb on a non-plasma machine, or to turn the plasma layer off deliberately:

```bash
export LCNCGUI_PLASMA_ENABLED=0
```

### Macro subroutines (optional)

If you use the **Macros** screen, set `SUBROUTINE_PATH` in your machine INI. After a normal release install (`install.sh`), the reference `.ngc` files are already under the install directory — **no manual copying required**.

**System install** (`sudo ./install.sh`):

```ini
[RS274NGC]
SUBROUTINE_PATH = /opt/plasmaweb/resources/linuxcnc-subroutines
```

**Per-user install** (`./install.sh --user`):

```ini
[RS274NGC]
SUBROUTINE_PATH = ~/.local/share/plasmaweb/resources/linuxcnc-subroutines
```

**Custom `--prefix`:** use `$PREFIX/resources/linuxcnc-subroutines` (the exact path is printed at the end of `install.sh`).

Restart LinuxCNC (or reload the config) so `o<lcncgui_drill> call` can resolve the subroutines.

**Upgrades:** When you update plasmaweb, reinstall (or re-copy) the reference `.ngc` files under `SUBROUTINE_PATH` so motion-logic changes (for example initial approach order) take effect. Custom copies outside the install tree must be updated manually.

To customize motion logic, edit the `.ngc` files in that folder, or copy them elsewhere and point `SUBROUTINE_PATH` at your copy. See [`resources/linuxcnc-subroutines/README.md`](../resources/linuxcnc-subroutines/README.md).

### Custom HAL softkeys (optional)

To use the three configurable virtual sidebar buttons (**14**, **15**, **16** at the bottom of the sidebar), include the softkeys HAL snippet (oneshot + dbounce) from a **HALFILE** (e.g. `custom.hal`) — **not** from `POSTGUI_HALFILE` (`loadrt` must run in the main HAL phase):

```hal
source /opt/plasmaweb/resources/linuxcnc-config/lcncgui-softkeys.hal
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
source /opt/plasmaweb/resources/linuxcnc-config/lcncgui-panel.hal
```

Wire trigger inputs to your panel buttons and status outputs to LEDs, e.g.:

```hal
net estop-key  parport.0.pin-12-in => lcncgui-panel-estop.in
net led-estop  lcncgui-panel-status-estop.out => parport.0.pin-02-out
```

If you use panel pins for HAL softkeys **14–16**, source the **combined** snippet instead of both separate files (LinuxCNC allows only one `loadrt dbounce`):

```hal
source /opt/plasmaweb/resources/linuxcnc-config/lcncgui-panel-and-softkeys.hal
```

Enable panel polling (disabled by default):

```bash
export LCNCGUI_PANEL_HAL_ENABLED=1
```

Details: [`docs/features/15_PANEL_HAL_INPUTS.md`](features/15_PANEL_HAL_INPUTS.md).

### Manual tool change via HAL (optional)

By default plasmaweb does **not** show a HAL tool-change dialog. To enable it (gmoccapy-style, with your HAL wiring):

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

LinuxCNC starts realtime/HAL, then runs `plasmaweb`, which:

1. Starts the backend on port `8765`, bound to every interface (WebSocket at `/ws`, UI from `dist/`). **Settings → Connection → Interface address** shows the URL to type on another machine.
2. Opens Chromium in kiosk or windowed mode (see **Settings → Display → Window mode**, `PLASMAWEB_KIOSK`, or `ui.kioskMode` in `dist/plasmaweb-config.json`; user override in `~/.local/share/plasmaweb/user-preferences.json`)
3. Waits until you close the browser window

Click the **power icon** in the header to open an exit dialog:

- **Close window** / **Close window** — sends `app.exit`, stops the backend, closes the browser
- **Close window and shut down** / **Close window and shut down** — same, then powers off the PC after LinuxCNC exits (requires shutdown permissions from `install.sh`; see **Shutdown sequence** above)

If the browser tab cannot be closed automatically (e.g. dev mode), an info toast appears after a short delay.

When the DISPLAY program exits, LinuxCNC shuts down normally.

### Who can reach the interface

The default bind (`0.0.0.0`) means any machine that can route to port `8765` can open the UI,
and **there is no authentication in front of it** — whoever opens it can fire the torch, jog
the table and run a program, exactly as if they were standing at the controller. That is the
right trade for a headless controller on a workshop network you control; it is the wrong one
on a shared, guest or public network.

To restrict it to the controller itself, set `PLASMAWEB_HOST=127.0.0.1` before LinuxCNC
starts. To keep the network bind but limit who reaches it, put the controller on its own
subnet or VLAN, or firewall the port to known addresses — for example:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8765 proto tcp
```

## Environment variables (launcher)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PLASMAWEB_ROOT` | parent of `bin/` | Install directory |
| `PLASMAWEB_HOST` | `0.0.0.0` | HTTP bind address. The default serves the network, because the usual controller is headless and is driven from another machine. Set `127.0.0.1` to serve the controller's own screen only. |
| `PLASMAWEB_PORT` | `8765` | HTTP + WebSocket port |
| `PLASMAWEB_BROWSER` | auto | Browser executable |
| `PLASMAWEB_KIOSK` | (unset) | When set: `1` = fullscreen kiosk, `0` = normal window. When unset, uses user preferences file, then `ui.kioskMode` in config, then kiosk. |
| `PLASMAWEB_USER_PREFERENCES` | `~/.local/share/plasmaweb/user-preferences.json` | JSON file for UI settings that affect the launcher (e.g. kiosk vs windowed) |
| `PLASMAWEB_PYTHON` | auto | Python with `linuxcnc` module (prefers `$PREFIX/venv/bin/python`) |

Every launcher variable also accepts its older `LCNCGUI_*` name (`LCNCGUI_PORT`, `LCNCGUI_KIOSK`, …); `PLASMAWEB_*` wins when both are set.

## Environment variables (backend)

Backend settings kept their upstream `LCNCGUI_*` names.

| Variable | Default | Purpose |
|----------|---------|---------|
| `LCNCGUI_PLASMA_ENABLED` | `1` | Export the `qtplasmac` component and serve the plasma screens. `0` runs plasmaweb as a plain LinuxCNC GUI |
| `LCNCGUI_PLASMA_POLL_S` | `0.05` | HAL poll interval on the plasma bridge thread |
| `LCNCGUI_TOOLCHANGE_HAL_ENABLED` | `0` | HAL tool-change dialog (see above) |
| `LCNCGUI_PANEL_HAL_ENABLED` | `0` | External panel polling (see above) |

## Troubleshooting

**`plasmaweb: command not found`**  
Re-run `install.sh` or add `/usr/local/bin`, `~/.local/bin`, or `$PREFIX/bin` to `PATH`.

**`missing dist/index.html`**  
You need a release build with `dist/` included, not a source-only checkout (unless you ran `npm run build` first).

**`address already in use` / port 8765 busy**  
Another plasmaweb or dev backend is still running (`python -m backend.main` / `uvicorn backend.main`). Stop it before starting LinuxCNC:

```bash
pkill -f 'uvicorn backend.main'
ss -tlnp | grep 8765
```

The launcher tries to stop a **stale plasmaweb uvicorn** (same install dir) automatically.

**`externally-managed-environment` / pip refused during install**  
Use the current `install.sh` (venv under `$PREFIX/venv`). If venv creation fails: `sudo apt install python3-venv python3-full`. Retry with `./install.sh --recreate-venv`.

**`no Python with linuxcnc module`**  
LinuxCNC must be installed; use the same `python3` that can `import linuxcnc`, or set `PLASMAWEB_PYTHON`.

**UI shows “disconnected”**  
Do not open `index.html` as `file://`. Installed builds use `"websocketUrl": "auto"` when UI and backend share port 8765.

**Blank browser / no Chromium**  
Install `chromium` or set `PLASMAWEB_BROWSER=/path/to/browser`.

**Plasma screens empty / every plasma command answers `plasma_unavailable`**  
The `qtplasmac` component was not exported. Check the LinuxCNC log for `plasma: could not export the qtplasmac HAL component` (a stale backend or QtPlasmaC still holding the name), `plasma: no LinuxCNC hal module in this process` (the launcher picked a Python without LinuxCNC — set `PLASMAWEB_PYTHON`), or `plasma: disabled via LCNCGUI_PLASMA_ENABLED`.

**HAL errors about `qtplasmac.*` pins while POSTGUI halfiles load**  
The backend must be up before those halfiles run. That is what `bin/plasmaweb` does; a config that loads them some other way (a `[HAL] HALFILE` instead of `POSTGUI_HALFILE`) will not find the pins.

**`plasmacweb: command not found`**  
Installs made before the alias was linked have only `plasmaweb` on `PATH`. Re-run `install.sh` (it links `plasmaweb`, `plasmacweb` and `lcncgui`), or use `DISPLAY = plasmaweb`.

**Materials or parameters missing**  
`plasma: no INI in the environment` means the backend was started without LinuxCNC's INI. Started as a `[DISPLAY]` program it is always there; started by hand, set `INI_FILE_NAME`.

## Per-config launcher (optional)

LinuxCNC adds `<config-dir>/bin` to `PATH`. You can place a tiny wrapper there instead of a global install:

```bash
#!/bin/sh
export PLASMAWEB_ROOT=/opt/plasmaweb
exec /opt/plasmaweb/bin/plasmaweb "$@"
```

## INI snippet only

See [`resources/linuxcnc-config/ini-display-snippet.ini`](../resources/linuxcnc-config/ini-display-snippet.ini) for copy-paste `[DISPLAY]` / `[RS274NGC]` lines.

## Related docs

- Dev / manual start: [`docs/frontend-web-start.md`](frontend-web-start.md)
- Running the QtPlasmaC sim in a VM: [`docs/dev-vm.md`](dev-vm.md)
- WebSocket API: [`docs/backend-frontend-messages.md`](backend-frontend-messages.md)
- Commands and events: [`docs/commands-events.md`](commands-events.md)
- Backend: [`backend/README.md`](../backend/README.md)
- What was built and how it was verified: [`BUILD_PLAN.md`](../BUILD_PLAN.md)
- What is vendored and what is reused from LinuxCNC: [`UPSTREAM.md`](../UPSTREAM.md)
- Publishing releases: [`docs/releasing.md`](releasing.md)
