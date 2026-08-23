# 14_LINUXCNC_AUTOSTART

## Description

The user can enable **Run LinuxCNC at startup** so that LinuxCNC (with the currently active INI configuration) starts automatically after graphical session login. The setting is persisted on disk and applied by writing or removing an XDG autostart desktop entry.

## UI Interaction

- Open **Settings** → group **Display** → **Run LinuxCNC at startup** (`ToggleSwitch`).
- When enabled, the stored INI path is shown below the help text.
- When disabled, the autostart entry is removed; a running LinuxCNC session is not stopped.

## Preconditions

- Backend running and reachable when saving from the Settings UI.
- To **enable** autostart, LinuxCNC must be running with a resolvable INI path (from `linuxcnc.stat().ini_filename` or typical LinuxCNC environment variables). Otherwise the API returns `ini_path_unavailable`.
- A graphical desktop session must be available at login (autologin is recommended on dedicated CNC machines).
- The LinuxCNC user must be able to write `~/.config/autostart/linuxcnc-plasmaweb.desktop`.
- `PLASMAWEB_AUTOSTART=0` on the backend host must **not** be set when enabling autostart (otherwise the API returns `autostart_env_disabled`).

## Event order

1. User toggles **Run LinuxCNC at startup** in Settings.
2. Frontend calls `PUT /api/user-preferences/linuxcnc-autostart` with `{ "runLinuxCncAtStartup": true | false }`.
3. Backend resolves the active INI path when enabling (via `LinuxCncGateway.resolve_ini_path()`).
4. Backend installs or removes `~/.config/autostart/linuxcnc-plasmaweb.desktop` (override: `XDG_CONFIG_HOME`) **before** writing preferences.
5. Backend writes `~/.local/share/plasmaweb/user-preferences.json` (override: `PLASMAWEB_USER_PREFERENCES`) with `runLinuxCncAtStartup` and normalized absolute `linuxCncIniPath`.
6. On success, the Zustand store fields `runLinuxCncAtStartup` and `linuxCncIniPath` are updated.
7. On the **next graphical login**, the desktop environment starts `linuxcnc <ini>` from the autostart entry.

## User Feedback

- The toggle reflects the saved value after load (from `GET /api/user-preferences`).
- The stored INI path is shown when autostart is enabled.
- If loading preferences fails at bootstrap (backend down), a shared Display hint appears (`settings:display.userPreferencesLoadFailed`; `data-e2e="settings-user-preferences-load-failed"`); the autostart toggle shows the default (off).
- If saving fails, an error toast appears with a specific message when the backend returns a structured error code (`ini_path_unavailable`, `autostart_setup_failed`, `autostart_env_disabled`, `network_error`).
- No immediate LinuxCNC restart — autostart applies on the next login (or when LinuxCNC is started manually).

## Edge Cases

**INI path unknown when enabling**  
Toggle save fails with `ini_path_unavailable`; user must start LinuxCNC once with the desired configuration first.

**User changes machine configuration later**  
The stored INI path is updated when autostart is toggled on again. Disabling and re-enabling refreshes the path.

**Autologin not configured**  
Autostart still runs after manual graphical login; it does not start LinuxCNC before login.

**`PLASMAWEB_AUTOSTART=0` in the environment**  
Enabling autostart fails with `autostart_env_disabled`; preferences are not written.

**Autostart apply fails (permissions, missing INI file)**  
API returns `autostart_setup_failed`; preferences are not written.

**Backend not running (dev)**  
Saving fails with a network error toast; load failure shows the bootstrap hint.

## Errors

| Code | HTTP | Meaning |
|------|------|---------|
| `ini_path_unavailable` | 422 | Active INI path could not be resolved when enabling |
| `autostart_env_disabled` | 503 | `PLASMAWEB_AUTOSTART` disables applying autostart on the backend host |
| `autostart_setup_failed` | 503 | Could not write or remove the autostart desktop entry |
| (plain string) | 503 | User preferences file could not be written |

## Related Features

- Window mode at startup — [`docs/features/08_WINDOW_MODE.md`](08_WINDOW_MODE.md)
- Exit / system shutdown — [`docs/features/11_EXIT_SHUTDOWN.md`](11_EXIT_SHUTDOWN.md)
- LinuxCNC installation / launcher — [`docs/installation.md`](../installation.md)
