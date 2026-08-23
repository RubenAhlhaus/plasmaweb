# The lcncgui → plasmaweb rename

This project started as a fork of lcncgui and carried its name through every file, path and
environment variable. It is its own thing now, and it is called **plasmaweb**.

What follows is what changed, what deliberately did not, and why — because half of those old
names are contracts with things this repo does not own.

## Renamed

| Was | Is | Old name still works? |
|---|---|---|
| `bin/lcncgui` | `bin/plasmaweb` | yes — `install.sh` links `lcncgui` to it, so an INI saying `DISPLAY = lcncgui` still starts |
| `bin/lcncgui-shutdown` | `bin/plasmaweb-shutdown` | n/a — only the launcher calls it |
| `lcncgui-config.json` | `plasmaweb-config.json` | yes — the UI asks for the new name, then the old |
| `~/.local/share/lcncgui/` | `~/.local/share/plasmaweb/` | yes — read from the old directory when the new one does not exist; the next write moves it |
| `linuxcnc-lcncgui.desktop` | `linuxcnc-plasmaweb.desktop` | yes — the old entry counts as "autostart is on", and is removed when autostart is re-applied or turned off, so nothing starts LinuxCNC twice |
| `LCNCGUI_*` environment | `PLASMAWEB_*` | yes — every variable reads the new name first and the old one after |
| `/opt/lcncgui` | `/opt/plasmaweb` | new installs only; an existing install keeps its prefix until reinstalled |
| every string an operator reads | plasmaweb | n/a |

The fallbacks are read, never written. A machine set up before the rename keeps working, and
the first save moves it to the new name without anybody being asked to do anything.

## Deliberately unchanged

These are names other people's files refer to. Renaming them would break a machine's own
configuration, which is not something a rename is allowed to do — the same reasoning that keeps
this project's HAL component called `qtplasmac`.

| Name | Who refers to it |
|---|---|
| `lcncgui-panel.hal`, `lcncgui-panel-*` pins | the machine's own `.hal` files, written by the shop |
| `lcncgui-softkeys.hal`, `lcncgui-sk-*` pins | the same |
| `LCNCGUI_HAL_SOFTKEY_*`, `LCNCGUI_PANEL_HAL_*` | the halfiles above document these by name |
| `<tooltable>.lcncgui-tools.json` | the sidecar beside a machine's own tool table |
| `lcncgui_meta`, `lcncgui_presets` | keys *inside* that sidecar and inside tool-table comments |
| `lcncgui_drill.ngc`, `lcncgui_plan_face.ngc`, `lcncgui_params.ngc` | subroutines that saved programs call by name (`o<lcncgui_drill> call`) |

A saved job in a shop's nc_files calls `o<lcncgui_drill>`; renaming that subroutine would break
programs that were cutting fine yesterday. If these are ever renamed it has to be with both
names installed, and that is a separate piece of work with its own migration.
