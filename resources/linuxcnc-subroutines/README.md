# LinuxCNC Subroutines (lcncgui)

These `.ngc` files are **reference subroutines** for the macro-to-G-code feature in lcncgui.
They contain the actual motion logic. The GUI only generates the **main program** with
`o<name> call [...]` and parameters.

## Installation on the controller

### Standard install (recommended)

`install.sh` copies these files to `$PREFIX/resources/linuxcnc-subroutines/`. Point LinuxCNC at that folder in **`[RS274NGC]`** — no extra copy step.

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

**Custom `--prefix`:** use `$PREFIX/resources/linuxcnc-subroutines` (printed at the end of `install.sh`).

Restart LinuxCNC (or reload the config) so `o<lcncgui_drill> call` can resolve the file.

Full steps: [`docs/installation.md`](../../docs/installation.md).

### Manual copy (optional)

Only if you want the subroutines in a separate folder (for example next to your `nc_files`):

1. Copy all `.ngc` files from this folder to the target directory (for example `~/linuxcnc/nc_files/subroutines/`).
2. Set `SUBROUTINE_PATH` to that directory in your INI.
3. Restart LinuxCNC.

For multiple paths, separate with `:` (Linux) or `;` (Windows). See the [LinuxCNC documentation](https://linuxcnc.org/docs/).

Without `SUBROUTINE_PATH`, `o<...> call` will fail even if the main program is stored under `PROGRAM_PREFIX`.

## Initial approach order

On entry, each subroutine:

1. Raises **Z** to safe/clearance height **only if** current Z (`#<_z>`) is below that height.
2. Rapids to the first **XY** of the operation.
3. Rapids **Z** to safe/clearance (no-op if already there; lowers if still above).

That avoids plunging to safe Z while still at the previous XY, and avoids sweeping XY while the tool is still low. The program-header `G53 G0 Z0` retract (when enabled) remains recommended so the first XY move starts high.

**Deploy:** After upgrading lcncgui, reinstall or copy all three reference files (`lcncgui_drill.ngc`, `lcncgui_helix_bore.ngc`, `lcncgui_plan_face.ngc`) into the controller’s `SUBROUTINE_PATH`. The generated main program does not embed this motion.

## Parameters per subroutine

See the header comments in each `.ngc` file. The value order in `call [...]` must match exactly
with the subroutine implementation (`#1`, `#2`, ...).

### `lcncgui_plan_face.ngc`

Shipped in this folder. **Planfräsen** in the GUI emits `o<lcncgui_plan_face> call […]`
from `emitPlanFaceInvocation` in `src/lib/macroGcode/emitPlanFace.ts`.

| # | Meaning |
|---|--------|
| 1 | Area start X (mm) |
| 2 | Area start Y (mm) |
| 3 | Area width (mm) |
| 4 | Area height (mm) |
| 5 | Cutter overhang beyond stock (mm) |
| 6 | Surface Z (absolute, mm) — current stock top |
| 7 | Vorschubhöhe — clearance above workpiece surface before cut (mm) |
| 8 | Target Z (absolute, mm) — finished face / cut height (must be below #6) |
| 9 | Step over (mm) |
| 10 | Feed XY (mm/min) |
| 11 | Feed Z (mm/min) |
| 12 | Reserved `0` (future Bahnmuster; GUI does not set this yet) |
| 13 | Coolant: `> 0.5` → may use M8 in subroutine |
| 14 | Tool diameter (mm) when set on the tool in lcncgui; else `0` (subroutine uses a fallback from #9) |

The emitter documents the same list in `src/lib/macroGcode/emitPlanFace.ts`.

**Breaking change:** `#8` used to be a relative step-down below `#6`. It is now absolute target Z. Update the `.ngc` under `SUBROUTINE_PATH` and regenerate older face-milling main programs after upgrading.

### `lcncgui_drill.ngc`

Shipped in this folder. **Normal bohren** emits `o<lcncgui_drill> call […]` from `emitDrillInvocation` in `src/lib/macroGcode/emitProgram.ts`.

| # | Meaning |
|---|--------|
| 1 | Hole X (mm) |
| 2 | Hole Y (mm) |
| 3 | Safe Z — absolute retract height (mm) |
| 4 | Surface Z — absolute workpiece top (mm) |
| 5 | Approach / clearance above surface before feed (mm) |
| 6 | Total drill depth below surface (mm, positive) |
| 7 | Feed (mm/min) |
| 8 | Peck / Einstechtiefe (mm). `0` or ≥ #6: single feed to full depth. Otherwise pecking (chip-break or full retract). |
| 9 | Coolant: `> 0.5` → M8 before the cut |
| 10 | Chip-break retract (mm) toward surface after each peck; if `≤ 0` the subroutine uses `1.0`. Ignored when not pecking or when **#11** selects full retract. The lcncgui queue emitter currently passes **`DRILL_CHIP_BREAK_RETRACT_MM`** (1) from `emitProgram.ts` only while pecking and full retract is off; otherwise `0`. |
| 11 | Full retract: `> 0.5` → after each intermediate peck, rapid to feed-start height `#4 + #5` (Bohrungsstart / approach). `≤ 0.5` → short chip-break lift via **#10**. Ignored when not pecking. Older calls with only 10 args leave #11 unset (treated as 0). |

### `lcncgui_helix_bore.ngc`

Shipped in this folder. **Bohrfräsen** in the GUI passes **helix pitch per revolution (mm)** as argument **#7**; the pitch is computed in the main program from **helix angle** and **hole diameter** as **π · D · tan(α)** (see `emitHelixBoreInvocation` in `src/lib/macroGcode/emitProgram.ts`).

## Customization

Edit these files directly on the controller. No lcncgui rebuild is required.
After edits, reload/open the program again.

## Source in this repository

Reference copies live under `resources/linuxcnc-subroutines/` in the lcncgui repo. A release install (`install.sh`) deploys them to `$PREFIX/resources/linuxcnc-subroutines/` automatically. Manual copying is only needed if you keep subroutines in a custom directory.
