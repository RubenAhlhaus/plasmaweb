# Upstream test baseline

Captured at the vendoring commit (plasmaweb `v1.0.0-4-g57032ba`) so that new failures are
distinguishable from inherited ones. **Diff against this list — do not treat a failure
here as new.**

## Environment

macOS 25.4 (darwin), Python 3.14.3, Node 22.12.0, no LinuxCNC (`linuxcnc` / `hal`
modules unavailable).

## Frontend

| Suite | Result |
|---|---|
| `npm run build` | passes (1 chunk >500 kB warning, upstream) |
| `npm test -- --run` | **81 files, 474 tests, 0 failures** at the vendoring commit |
| `npm run lint` | **2 errors** — inherited, see below |
| `npx tsc --noEmit` | fails inside `node_modules` only — see below |

### Inherited lint errors

`src/lib/feedOverridePresetAction.ts:58` — two `no-irregular-whitespace` errors. Present in
the pristine upstream tree; nothing to do with this project's code. `npm run lint` is
therefore non-zero on a clean checkout: check that the error *count* is still 2 and that no
error points at a file outside `feedOverridePresetAction.ts`.

### `tsc` and node_modules

The repo pins TypeScript ~4.5 (upstream) but resolves current dependency typings, so
`npx tsc --noEmit` reports parse errors inside `node_modules/@types/babel__traverse` and
`node_modules/@vitest/**`. There is no `typecheck` npm script upstream, so this is not a
regression. Type-check our own code with:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep '^src/'   # must be empty
```

## Backend — 5 pre-existing failures

`./venv/bin/python -m pytest backend/tests -q` → **5 failed, 253 passed, 1 skipped**

The identical five fail in the pristine `reference/plasmaweb` tree run with the same
interpreter, so they are inherited, not caused by vendoring:

```bash
cd reference/plasmaweb && ../../venv/bin/python -m pytest backend/tests -q
# -> same 5 failures
```

| Test | Note |
|---|---|
| `test_frontend_static.py::test_ws_and_static_together_like_main_app` | Stale assertion upstream: `/api/user-preferences` now returns two extra keys (`reloadToolOnStartup`, `toolInSpindle`) that the expected dict does not list. Environment-independent — will fail on the VM too. |
| `test_program_file_paths.py::test_resolve_existing_directory_allows_lexical_subpath_when_realpath_outside` | Path-resolution assertion. Cause not diagnosed; not `TMPDIR`-symlink related (verified by rerunning under a non-symlinked `TMPDIR`). |
| `test_user_macros_ini.py::test_list_user_macros_filters_to_macros_section` | `list_user_subroutine_macros_from_ini` returns `[]` for the fixture INI. Same three tests, same cause. |
| `test_user_macros_ini.py::test_list_user_macros_skips_missing_ngc_and_params_suffix` | ” |
| `test_user_macros_ini.py::test_list_user_macros_preserves_ini_order` | ” |

None of the five touches code this project builds on (`user_macros_ini` and
`program_file_paths` serve plasmaweb's macro screen; `frontend_static` is an integration
smoke test).

## Re-baseline on the target VM

The deploy target is Debian 12 with Python 3.11 and LinuxCNC present, which exercises
code paths skipped here (`import linuxcnc` succeeds). Re-run both suites there during M0
verification and update this file with that second column — some of the five may be
macOS/Python-3.14 artifacts, and the `linuxcnc`-dependent tests currently skipped will
actually run.
