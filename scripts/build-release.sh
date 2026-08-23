#!/usr/bin/env bash
# Build a distributable release tarball (run on a dev machine with Node.js).
#
# Usage: ./scripts/build-release.sh [version]
# Output: dist-release/plasmaweb-<version>-linux.tar.gz

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/release-common.sh
source "${ROOT}/scripts/release-common.sh"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('./package.json').version")"
fi

RELEASE_NAME="$(release_name "$VERSION")"
STAGING="${ROOT}/dist-release/staging/${RELEASE_NAME}"
OUT_DIR="${ROOT}/dist-release"
TARBALL="${OUT_DIR}/${RELEASE_NAME}.tar.gz"
PRODUCTION_CONFIG="${ROOT}/resources/plasmaweb-config.production.json"

echo "Building ${RELEASE_NAME}..."

if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm is required to build the frontend" >&2
  exit 1
fi

if [[ ! -f "$PRODUCTION_CONFIG" ]]; then
  echo "error: missing ${PRODUCTION_CONFIG}" >&2
  exit 1
fi

npm ci
npm run build
write_production_config "${ROOT}/dist" "$PRODUCTION_CONFIG"

rm -rf "${ROOT}/dist-release/staging"
mkdir -p "$STAGING"

copy_release_tree "$ROOT" "$STAGING"
write_version_file "$STAGING" "$VERSION"

chmod +x "${STAGING}/bin/plasmaweb" "${STAGING}/bin/plasmaweb-shutdown" \
  "${STAGING}/bin/plasmacweb" "${STAGING}/install.sh" "${STAGING}/uninstall.sh"

mkdir -p "$OUT_DIR"
tar -czf "$TARBALL" -C "${ROOT}/dist-release/staging" "$RELEASE_NAME"

echo "Created: $TARBALL"
echo "On the controller:"
echo "  tar xzf ${RELEASE_NAME}.tar.gz"
echo "  cd ${RELEASE_NAME}"
echo "  sudo ./install.sh"
echo "  sudo ./uninstall.sh    # remove again"
