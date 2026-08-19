# LinuxCNC INI snippets for lcncgui

Add **`ini-display-snippet.ini`** to your machine config:

1. Set `[DISPLAY] DISPLAY = lcncgui` (replaces `gmoccapy`, `axis`, etc.).
2. Keep your existing `[EMC]`, `[TASK]`, `[HAL]`, motion, and IO sections unchanged.
3. Optionally set `[RS274NGC] SUBROUTINE_PATH` to `$PREFIX/resources/linuxcnc-subroutines` (e.g. `/opt/lcncgui/...` or `~/.local/share/lcncgui/...` with `--user`); no manual copy after `install.sh`.
4. Optionally `source lcncgui-softkeys.hal` from a **HALFILE** (not POSTGUI) for custom sidebar HAL buttons (labels 14–16).
   For panel + softkeys together, use `lcncgui-panel-and-softkeys.hal` (do not source both separate files).

## HAL snippet maintenance

- `lcncgui-softkeys.hal` — softkeys only (`oneshot` + `dbounce` feedback)
- `lcncgui-panel.hal` — panel triggers/status only (`dbounce` + `constant`)
- `lcncgui-panel-and-softkeys.hal` — **combined** copy for both (single `loadrt dbounce` / shared `constant` names)

When changing pin names, `loadrt` lines, delays, or `addf` lists, update **all** affected snippets in the same change so the combined file cannot drift.

Full install steps: [`docs/installation.md`](../../docs/installation.md).
