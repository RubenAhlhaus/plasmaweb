# 08_WINDOW_MODE

## Description

The user can choose whether plasmaweb starts in **fullscreen (kiosk)** or as a **normal window with title-bar buttons** (minimize, maximize, close). The choice is persisted on disk and read by the LinuxCNC `[DISPLAY]` launcher (`bin/plasmaweb`) on the next start.

## UI Interaction

- Open **Settings** → group **Display** → **Window mode at startup** (`TouchSelectField`).
- Options:
  - **Fullscreen (kiosk)**
  - **Window with title bar**
- A help line below explains that the setting applies after restarting LinuxCNC or plasmaweb.

## Preconditions

- Backend running and reachable at `/api/user-preferences` when saving from the Settings UI (installed `DISPLAY = plasmaweb`, or dev: Vite preview/dev with backend on port 8765).
- For the launcher to honor the setting, no `PLASMAWEB_KIOSK` override may be set in the environment (when set, it wins over file and config).

## Event order

1. User opens Settings and selects a window mode.
2. Frontend calls `PUT /api/user-preferences` with `{ "kioskMode": true | false }`.
3. Backend writes `~/.local/share/plasmaweb/user-preferences.json` (override: `PLASMAWEB_USER_PREFERENCES`).
4. On success, the Zustand store field `kioskMode` is updated so the UI reflects the saved value.
5. On the **next** plasmaweb start, `bin/plasmaweb` resolves launch mode:
   - `PLASMAWEB_KIOSK` if set (`1` / `0`)
   - else `kioskMode` in user preferences file (legacy key `kiosk` still read)
   - else `ui.kioskMode` in `dist/plasmaweb-config.json`
   - else default **kiosk**
6. Chromium/Firefox is started with `--kiosk` / `-kiosk` or `--new-window` / `-new-window` accordingly.

## User Feedback

- The selected mode is shown in the Settings picker after load (from API or config fallback).
- If loading preferences fails at bootstrap (backend down), a shared Display hint appears (`settings:display.userPreferencesLoadFailed`; `data-e2e="settings-user-preferences-load-failed"`).
- If saving fails (network, backend down, disk error), an error toast appears (`settings:display.windowModeSaveFailed`); the store keeps the previous value.
- No immediate window resize — change requires restart.

## Edge Cases

**Backend not running (dev)**  
Saving fails with toast; Vite dev/preview proxies `/api` to port 8765 when the backend is up.

**Legacy preferences file with `"kiosk": false`**  
Still read on launch and via GET API (in-memory normalization to `kioskMode`); the on-disk file is rewritten to `"kioskMode"` on the next **PUT** from Settings or when **`bin/plasmaweb`** starts (`migrate_user_preferences_file` in `backend/launcher_prefs.py`). GET alone does not write the file.

**Stale file with both `"kioskMode"` and legacy `"kiosk"`**  
GET/launch resolve `kioskMode`; legacy key is removed on the next PUT or launcher migration.

**Production upgrade without user file**  
Falls back to `ui.kioskMode` in production config (`true` = kiosk, as before).

## Errors

- HTTP 503 from PUT when the preferences file cannot be written (permissions, disk full).
- Frontend treats any non-OK response as save failure and shows the toast.

## Related Features

- Settings screen (virtual sidebar, language) — [`docs/frontend-i18n.md`](../frontend-i18n.md)
- LinuxCNC installation / launcher — [`docs/installation.md`](../installation.md)
