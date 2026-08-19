# 16_POSTGUI_HALFILE

## Description

When lcncgui is the LinuxCNC `[DISPLAY]` program, it loads every `[HAL] POSTGUI_HALFILE` from the active INI after the main HAL files are up (same role as gmoccapy/AXIS). That applies machine wiring that must run in the display phase — for example `postgui_call_list.hal` → `pendant.hal` nets such as `z-btn` / `y-btn` between softkey oneshots and `flipflop` axis select.

Without this, only `[HAL] HALFILE` content is loaded; `POSTGUI_HALFILE` is ignored and signals defined only there (e.g. `z-btn`) never appear.

## UI Interaction

None. Loading is automatic when LinuxCNC starts `DISPLAY = lcncgui`.

## Preconditions

- LinuxCNC started with `DISPLAY = lcncgui` (via `bin/lcncgui -ini …`).
- `INI_FILE_NAME` set (normal LinuxCNC display launch).
- `halcmd` on `PATH`; for `.tcl` postgui files, `haltcl` on `PATH`.
- Each `POSTGUI_HALFILE` path exists (relative paths resolve against `CONFIG_DIR`, or the INI directory if `CONFIG_DIR` is unset).
- Postgui HAL must not reference GUI pins that only exist under another display (e.g. `gmoccapy.*`) unless that GUI is actually running.

## Event order

1. LinuxCNC finishes `[HAL] HALFILE` loading and starts the DISPLAY program.
2. `bin/lcncgui` resolves the INI and reads all `[HAL] POSTGUI_HALFILE` entries.
3. For each file, from the config directory: `halcmd -i <ini> -f <file>` (or `haltcl -i <ini> <file>` if the name ends with `.tcl`).
4. Nested `source` lines inside those files use the config directory as cwd (so `source pendant.hal` works).
5. On success, lcncgui continues (backend + browser). On failure, the launcher exits non-zero so LinuxCNC tears down (same idea as gmoccapy).

## User Feedback

- Stderr: `lcncgui: loading POSTGUI_HALFILE …` for each file.
- On missing file or `halcmd`/`haltcl` failure: error on stderr and non-zero exit (LinuxCNC shuts down).

## Edge Cases

- **No `POSTGUI_HALFILE` in INI:** skip; start UI as before.
- **Multiple `POSTGUI_HALFILE` lines:** load in INI order.
- **Relative `source` inside a call-list HAL:** requires cwd = config dir (launcher sets this).
- **gmoccapy-only pins in postgui HAL:** will fail under `DISPLAY = lcncgui`; comment out or replace those nets.

## Errors

| Situation | Result |
|-----------|--------|
| Postgui path missing | Launcher exits non-zero |
| `halcmd` / `haltcl` non-zero | Launcher exits non-zero; LinuxCNC cleans up |
| `halcmd` not installed | Failure when a `.hal` postgui file is listed |

## Related Features

- [`13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md`](13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md) — softkey `loadrt` stays in HALFILE; postgui may still `net` those pins
- [`15_PANEL_HAL_INPUTS.md`](15_PANEL_HAL_INPUTS.md) — panel `loadrt` in HALFILE
- [`docs/installation.md`](../installation.md) — `DISPLAY = lcncgui` setup
