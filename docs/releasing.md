# Publishing releases

This guide is for **maintainers** who ship plasmaweb to LinuxCNC controllers via [GitHub Releases](https://github.com/salomom/plasmaweb/releases).

End users install from the published tarball — see [`docs/installation.md`](installation.md).

## Overview

| Step | Who | Result |
|------|-----|--------|
| Merge changes to `master` | Maintainer | Stable source on the default branch |
| Bump version + update changelog | Maintainer | `package.json` and `CHANGELOG.md` reflect the release |
| Push git tag `v<version>` | Maintainer | Triggers GitHub Actions |
| CI runs `build-release.sh` | GitHub Actions | Builds `plasmaweb-<version>-linux.tar.gz` |
| CI creates GitHub Release | GitHub Actions | Tarball + `checksums.txt` attached for download |

The release archive is **not CPU-specific** (e.g. building on ARM is fine for x86_64 targets). What matters on the controller is Linux + LinuxCNC + Python.

## Versioning

- Use [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH` (e.g. `1.2.0`).
- Keep these in sync:
  - `package.json` → `"version"`
  - Git tag → `v1.2.0` (always prefix with `v`)
  - Tarball name → `plasmaweb-1.2.0-linux.tar.gz` (no `v` in the filename)
  - `CHANGELOG.md` section heading → `## [1.2.0] - YYYY-MM-DD`

The CI workflow strips the `v` from the tag and passes the bare version to `./scripts/build-release.sh`.

## Release checklist

### 1. Prepare the changelog

Edit [`CHANGELOG.md`](../CHANGELOG.md):

1. Move items from `[Unreleased]` into a new `## [x.y.z] - date` section.
2. Update the compare links at the bottom of the file.
3. Leave `[Unreleased]` empty (or with upcoming notes).

### 2. Bump the version

Either edit `package.json` manually or use npm:

```bash
npm version patch    # 1.0.0 → 1.0.1
npm version minor    # 1.0.0 → 1.1.0
npm version major    # 1.0.0 → 2.0.0
```

`npm version` updates `package.json`, creates a commit, and creates a local tag. If you bump manually, commit the version + changelog changes yourself.

### 3. Push and tag

If you used `npm version`, push the commit and tag:

```bash
git push origin master
git push origin v1.0.0
```

If you tag manually after committing:

```bash
git tag v1.0.0
git push origin master v1.0.0
```

**Important:** The tag must be on a commit that is already on `master` (or at least reachable from the tagged commit). CI checks out the tagged commit and builds from that tree.

### 4. Verify the GitHub Release

1. Open [Actions](https://github.com/salomom/plasmaweb/actions) — the **Release** workflow should succeed.
2. Open [Releases](https://github.com/salomom/plasmaweb/releases) — confirm assets:
   - `plasmaweb-<version>-linux.tar.gz`
   - `checksums.txt`
3. Optionally smoke-test on a controller:

   ```bash
   tar xzf plasmaweb-<version>-linux.tar.gz
   cd plasmaweb-<version>-linux
   sha256sum -c ../checksums.txt   # if checksums.txt is alongside the tarball
   sudo ./install.sh
   ```

## CI workflow

Defined in [`.github/workflows/release.yml`](../.github/workflows/release.yml).

- **Trigger:** push of any tag matching `v*` (e.g. `v1.0.0`, `v2.1.3-rc.1`).
- **Runner:** `ubuntu-latest`
- **Steps:** checkout → Node 20 + `npm ci` → `./scripts/build-release.sh` → SHA256 checksums → GitHub Release with auto-generated notes.
- **Action pinning:** Third-party GitHub Actions are pinned to full commit SHAs (with a `# vX` comment for the original tag). When upgrading an action, resolve the new SHA from that action’s release tag and update both the SHA and comment.

No secrets are required beyond the default `GITHUB_TOKEN` (workflow has `contents: write`).

## Local release build (without CI)

Useful to test the tarball before tagging, or to build offline:

```bash
./scripts/build-release.sh              # version from package.json
./scripts/build-release.sh 1.2.0        # explicit version
```

Output: `dist-release/plasmaweb-<version>-linux.tar.gz` and a staging tree under `dist-release/staging/`.

Requirements on the build machine: Node.js/npm, `rsync`, and `resources/plasmaweb-config.production.json`.

Install from the staging tree or extracted tarball:

```bash
tar xzf dist-release/plasmaweb-1.2.0-linux.tar.gz
cd plasmaweb-1.2.0-linux
sudo ./install.sh
```

`dist-release/` is gitignored — do not commit build artifacts.

## Pre-releases

For beta or release-candidate builds, use a pre-release tag:

```bash
git tag v1.2.0-rc.1
git push origin v1.2.0-rc.1
```

CI builds and publishes the same way. On GitHub, edit the release and check **Set as a pre-release** so it is not marked as the latest stable release.

## Upgrading an existing install

Users extract a newer tarball and re-run `install.sh` from the new directory. Document any breaking changes in `CHANGELOG.md`. See **Upgrading an existing install** in [`docs/installation.md`](installation.md).

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| Workflow did not run | Tag must match `v*` and be pushed to GitHub (`git push origin v1.0.0`). |
| `build-release.sh` fails in CI | Reproduce locally; ensure `npm ci` and `npm run build` succeed on `master`. |
| Wrong version in tarball | Tag version must match `package.json` (CI uses the tag, not `package.json`, for the tarball name and `VERSION` file). |
| Release exists but no assets | Check the failed job log; re-run workflow or delete the tag/release and push the tag again. |
| Users get source zip instead of tarball | Point them to **Assets** on the Release page, not “Source code (zip/tar.gz)”. Only the custom tarball includes the built frontend. |

## Related docs

- [`docs/installation.md`](installation.md) — end-user install, upgrade, uninstall
- [`docs/frontend-web-start.md`](frontend-web-start.md) — local development (Vite + backend)
- [`scripts/build-release.sh`](../scripts/build-release.sh) — tarball contents and build steps
