# Upstream sources

This project is a web interface for QtPlasmaC. It does not start from scratch: the
application skeleton is **vendored** from lcncgui, and the plasma domain logic is
**reused** from LinuxCNC's own pure-Python modules.

Neither upstream is a git submodule. Both are cloned into `reference/` locally and
git-ignored — see `.gitignore`.

## Vendored: lcncgui

| | |
|---|---|
| Source | <https://github.com/salomom/lcncgui> |
| Revision | `57032ba4d91e027bbbb22e8318acc4c48f25c4a4` (`v1.0.0-4-g57032ba`) |
| Vendored at | 2026-08-19 |
| License | GPL-3.0-or-later |
| What | `backend/`, `src/`, `bin/`, `docs/`, `e2e/`, `examples/`, `public/`, `resources/`, `scripts/`, and the root build config (`package.json`, `vite.config.ts`, `tsconfig*.json`, `tailwind.config.js`, `postcss.config.js`, `components.json`, `.eslintrc.json`, `index.html`, `install.sh`, `uninstall.sh`, `CHANGELOG.md`, `LICENSE`) |

Excluded from the copy: `.git/`, `node_modules/`, `dist/`, `.DS_Store`.

### Vendoring rules

- **Upstream files stay recognisable.** Internal names are deliberately *not* renamed:
  the Python package is still `backend`, the backend's environment variables are still
  `LCNCGUI_*`, and the WebSocket path is still `/ws`. This preserves `diff`-ability
  against upstream, which is worth more than cosmetic consistency. The two user-facing
  names *are* ours: `bin/lcncgui` is now `bin/plasmaweb` (with `bin/plasmacweb` as the
  plasma alias), and the launcher reads `PLASMAWEB_*` first, falling back to every
  `LCNCGUI_*` name it used to answer to. `install.sh` still links `lcncgui` onto `PATH`,
  so an INI that says `DISPLAY = lcncgui` keeps starting.
- **New code goes in new files** — `backend/plasma/*`, `backend/handlers/plasma_*.py`,
  `src/screens/plasma/*`, `src/components/plasma/*`.
- **Edits to vendored files are additive** and kept minimal (registration lines in
  `backend/main.py`, new constants in `backend/config.py`).
- `README.md` is the one intentional replacement; the upstream one is preserved at
  `docs/UPSTREAM_README.md`.
- `.github/` is upstream's release CI, and it is **in use here**: it is repo-agnostic
  (default `GITHUB_TOKEN`, `scripts/build-release.sh`, which names the tarball from
  `package.json`/the tag), so pushing a `v*` tag publishes a release on this repo. See
  [`docs/releasing.md`](docs/releasing.md).

### Re-syncing with upstream

```bash
git -C reference/lcncgui pull
rsync -a --exclude='.git' --exclude='.DS_Store' --exclude='node_modules' \
      --exclude='dist' --dry-run --itemize-changes reference/lcncgui/ ./
```

Review the itemized list before dropping `--dry-run`. `README.md` will always show as
changed — do not let it overwrite ours.

## Reused (not copied): LinuxCNC / QtPlasmaC

| | |
|---|---|
| Source | <https://github.com/LinuxCNC/linuxcnc> |
| Revision | `0bb86dd6675ecdcd8646b14a4e5d5de2820bf386` |
| License | GPL-2.0-or-later |

At runtime these come from the LinuxCNC installation on the machine, imported from
`sys.path`, not vendored:

| Path (under `reference/linuxcnc/`) | Role |
|---|---|
| `lib/python/plasmac/*.py` | 13 Qt-free modules: the conversational shape geometry and run-from-line. Called directly, via a two-method shim. |
| `lib/python/rs274/interpret.py` | `Translated` + `ArcsToSegmentsMixin` — base classes for the headless toolpath canon. |
| `src/hal/components/plasmac.comp` | The realtime HAL component: 144 in-pins, 50 out-pins. Owns all safety and timing. Never reimplemented. |
| `share/qtvcp/screens/qtplasmac/qtplasmac_handler.py` | Read-only reference for the 91 `qtplasmac.*` userspace pins and for file formats. Its logic is reimplemented, not imported. |
| `src/emc/usr_intf/qtplasmac/qtplasmac_gcode.py` | The `[FILTER]` program. Invoked by LinuxCNC, not by the GUI — used as-is. |
| `docs/src/plasma/qtplasmac.adoc` | The QtPlasmaC manual; the behavioural spec this project is measured against. |

GPL-2-or-later permits use under GPL-3, so this project as a whole is
**GPL-3.0-or-later**. Any file copied from either upstream keeps its original
copyright header.
