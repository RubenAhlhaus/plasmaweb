# Starting the web frontend

**Production / LinuxCNC controller:** see **[`docs/installation.md`](installation.md)** — download a release, run `install.sh`, set `DISPLAY = plasmaweb` in your INI. No Node.js on the machine.

**Publishing a release (maintainers):** see **[`docs/releasing.md`](releasing.md)**.

## Short flow (development)

Uses **two servers**: Vite for the UI, Python for the backend/WebSocket.

1. Copy the dev config template:  
   `cp public/plasmaweb-config.example.json public/plasmaweb-config.json`  
   Keep **`websocketUrl": "ws://127.0.0.1:8765/ws"`** — do **not** use `"auto"` here (Vite runs on port 5173, the backend on 8765).
2. Start the LinuxCNC backend from the repo root: `python -m backend.main` (port `8765`, path `/ws`; see `backend/config.py`).
3. `npm install` (once), then `npm run dev` — open the Vite URL (usually `http://localhost:5173`).

Vite proxies **`/api`** to the backend on port **8765** (see `vite.config.ts`). Settings that persist launcher-visible preferences (e.g. **Window mode**) need the backend running when you save them.

E2E tests also use a **split setup**: preview on 4173, backend externally on 8765 — keep `ws://127.0.0.1:8765/ws` in `public/plasmaweb-config.json` for local/E2E builds.

## Production build (manual test)

```bash
npm run build
npm run preview
```

With only `npm run build`, copy a config into `dist/` if needed. Installed releases use `resources/plasmaweb-config.production.json` (`"websocketUrl": "auto"`) via `install.sh` / `build-release.sh`.

When the backend serves `dist/` (installed `DISPLAY = plasmaweb` or `dist/index.html` present), UI and WebSocket share one port — then `"auto"` is correct.

Do not open `dist/index.html` as `file://` — assets need HTTP.

## Deployment on the controller

Use **[`docs/installation.md`](installation.md)** (`./scripts/build-release.sh`, `install.sh`, `DISPLAY = plasmaweb`). The old manual pattern (separate preview server + backend) is only for ad-hoc testing without the LinuxCNC launcher.

### UI performance on embedded GPUs

Panels, cards, dialogs, and tooltips use **opaque** theme surfaces (`.surface`, `.surface-subtle`, `.surface-strong` in `src/index.css`) instead of `backdrop-blur` glassmorphism. That keeps compositing cheap on controllers such as a Raspberry Pi. Do not reintroduce `backdrop-blur` on large or frequently updated UI regions without measuring on the target hardware.

**Coordinate display (DRO):** High-frequency `motion.coordinates.changed` WebSocket events are batched before updating the Zustand store (default flush interval **66 ms**, ~15 fps). Override with `ui.coordinateUiFlushMs` in `plasmaweb-config.json` (allowed range 16–500 ms). Identical values within 3 decimal places do not trigger a store update.

## Responsive layout

The UI fills the browser viewport (no fixed design canvas or CSS scale transform). Shared layout helpers:

| Module | Screens | Breakpoint behaviour |
|--------|---------|----------------------|
| [`machineScreenLayoutClasses.ts`](../../src/lib/machineScreenLayoutClasses.ts) | **Home**, **Program** | Two columns at **`xl` (~1280px)+**; stack vertically below. Jog controls switch to full size when the right column is **≥520px** ([`useJogPanelSize`](../../src/hooks/useJogPanelSize.ts) + [`jogControlSize.ts`](../../src/lib/jogControlSize.ts)). Virtual sidebar and OS display scaling reduce the effective column width — sizing follows measured width, not viewport alone. |
| [`splitPanelLayoutClasses.ts`](../../src/lib/splitPanelLayoutClasses.ts) | **Tools**, **Macros** | Side panel beside main content at **`lg` (~1024px)+**; stacks below with capped height + scroll. |

**Home / Program left column:** [`MachinePreviewColumn`](../../src/components/MachinePreviewColumn.tsx) — coordinates (+ active G/M codes on Home only) in a **top header row**, machine visualization in the center, tool info + spindle/feed gauges in the footer.

**Settings:** setting rows stack label and control vertically below **`sm` (~640px)**; scrollable content is capped at **`lg:max-w-4xl`** so long lines stay readable on wide displays.

**App shell:** main content area uses **`overflow-x-hidden overflow-y-auto`** so tall screens scroll instead of clipping; global dialogs use portals and are unaffected.

## Configuration (`public/plasmaweb-config.json`)

| Context | `websocketUrl` |
|---------|----------------|
| **Development** (`npm run dev`) | Explicit, e.g. `ws://127.0.0.1:8765/ws` |
| **E2E** (preview + external backend) | Same explicit URL |
| **Installed / DISPLAY launcher** | `"auto"` (from `resources/plasmaweb-config.production.json`) |

- **`ui`** (optional): defaults applied into the store when the page loads.
  - **`showVirtualSidebar`** (boolean, optional, default `true`): default visibility of the virtual left button sidebar for **first-time** visitors. Once the user toggles the setting in **Settings**, the choice is persisted in **`localStorage`** under **`plasmaweb.showVirtualSidebar`** and overrides this file on later visits (same pattern as UI language — see [`docs/frontend-i18n.md`](frontend-i18n.md)).
  - **`kioskMode`** (boolean, optional, default `true`): default launch mode when no user preference file exists yet — `true` = fullscreen kiosk, `false` = normal window with title bar. Once the user changes **Window mode** in **Settings**, the choice is stored in **`~/.local/share/plasmaweb/user-preferences.json`** under the same key **`kioskMode`** (override path with `PLASMAWEB_USER_PREFERENCES`) and takes effect on the next plasmaweb/LinuxCNC start. Legacy files with key **`kiosk`** are still read by the launcher and API until rewritten.
  - **`debugLoggingEnabled`** and related debug flags: session-local debug logging.
  - **`coordinateUiFlushMs`** (number, optional): max interval in milliseconds between DRO coordinate store updates (16–500, default `66`). Lower = smoother display, higher CPU/GPU load on embedded hardware.

Template for development: `public/plasmaweb-config.example.json`. Production template: `resources/plasmaweb-config.production.json`.

Vite copies files from `public/` into `dist/` on build — use `public/plasmaweb-config.json` for local preview/E2E, not the production file.

## User preferences REST API

Settings that affect the **launcher** (not only the browser session) are stored in `~/.local/share/plasmaweb/user-preferences.json` and exposed over HTTP on the same origin as the UI (proxied to the backend in dev/preview via `vite.config.ts`).

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/api/user-preferences` | — | `{ "kioskMode": true \| false \| null, "runLinuxCncAtStartup": boolean, "linuxCncIniPath": string \| null, "toolInSpindle": number, "reloadToolOnStartup": boolean }` |
| `PUT` | `/api/user-preferences` | `{ "kioskMode": boolean }` | Full user-preferences object |
| `PUT` | `/api/user-preferences/linuxcnc-autostart` | `{ "runLinuxCncAtStartup": boolean }` | Full user-preferences object; installs/removes `~/.config/autostart/linuxcnc-plasmaweb.desktop` before writing preferences. On failure: **422** (`ini_path_unavailable`) or **503** (`autostart_env_disabled`, `autostart_setup_failed`) with `{ "detail": { "code", "message" } }`. |
| `PUT` | `/api/user-preferences/tool-in-spindle` | `{ "toolInSpindle": number }` (`>= 0`) | Full user-preferences object; persists last spindle tool for restore after homing. |
| `PUT` | `/api/user-preferences/reload-tool-on-startup` | `{ "reloadToolOnStartup": boolean }` | Full user-preferences object; enables/disables `M61` restore after homing (default **true** when unset). |

The frontend loads preferences on startup (`useLcncguiConfigLoader`) and writes them from **Settings → Display** (`src/lib/userPreferencesApi.ts`). `bin/plasmaweb` reads the same file (via `backend/launcher_prefs.py`) when choosing kiosk vs windowed launch. **Run LinuxCNC at startup** is documented in [`docs/features/14_LINUXCNC_AUTOSTART.md`](features/14_LINUXCNC_AUTOSTART.md). **Reload last tool after homing** is documented in [`docs/features/17_RELOAD_TOOL_ON_STARTUP.md`](features/17_RELOAD_TOOL_ON_STARTUP.md).

### HAL tools REST API

Settings can launch LinuxCNC HAL helper programs on the backend host (gmoccapy parity):

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/api/hal-tools/launch` | `{ "tool": "halshow" \| "halmeter" \| "halscope" \| "linuxcnctop" \| "hal_calibration" \| "classicladder" }` | `{ "ok": true }` on success |

Tool IDs are defined in [`resources/hal-tool-ids.json`](../resources/hal-tool-ids.json) (shared with `backend/hal_tools.py` and `src/lib/halToolsApi.ts`).

On failure the API returns **422** for missing prerequisites (executable not found, INI unknown, ClassicLadder RT missing, no `DISPLAY`/`WAYLAND_DISPLAY`) or **503** for launch/OS errors. Body: `{ "detail": { "code": string, "message": string } }`. The Settings UI maps `code` to localized strings in `settings.json` (`halTools.errors.*`).

See [`docs/features/12_HAL_TOOLS_SETTINGS.md`](features/12_HAL_TOOLS_SETTINGS.md).

User-preferences file override: `PLASMAWEB_USER_PREFERENCES`.

## UI language (i18n)

English / German UI strings, locale files, `localStorage` key, and testing notes: **[`docs/frontend-i18n.md`](frontend-i18n.md)**.

## E2E tests

E2E runs against the production build via `vite preview`. See [`docs/test/e2e-tests.md`](test/e2e-tests.md).
