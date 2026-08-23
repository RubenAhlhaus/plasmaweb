#!/usr/bin/env bash
# Install plasmaweb on a LinuxCNC controller (no Node.js required on the target).
#
# Usage:
#   sudo ./install.sh                 # install to /opt/plasmaweb
#   ./install.sh --user               # install to ~/.local/share/plasmaweb
#   ./install.sh --prefix /path/to/dir
#   ./install.sh --recreate-venv      # rebuild Python venv (e.g. after Python upgrade)

set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/release-common.sh
source "${SOURCE_DIR}/scripts/release-common.sh"

PREFIX="/opt/plasmaweb"
USER_INSTALL=0
RECREATE_VENV=0
SETUP_SHUTDOWN_ONLY=0
LINUXCNC_USER=""
BIN_DIR=""
LINK_GLOBAL=1

usage() {
  cat <<'EOF'
Usage: install.sh [--prefix DIR] [--user] [--recreate-venv] [--setup-shutdown [USER]] [--help]

Copies the release tree to PREFIX, creates a Python venv, and links plasmaweb
onto PATH when appropriate.

Requires: python3 with the linuxcnc module, python3-venv, curl (or Python urllib)

Options:
  --prefix DIR       Install root (default: /opt/plasmaweb, or ~/.local/share/plasmaweb with --user)
  --user             Install for the current user (symlink in ~/.local/bin)
  --recreate-venv    Delete and recreate PREFIX/venv before pip install
  --setup-shutdown [USER]
                     Allow USER to shut down the PC from the plasmaweb exit dialog
                     (passwordless sudo for PREFIX/bin/plasmaweb-shutdown only).
                     Default USER: SUDO_USER or the current user with --user.
                     A full install with sudo also runs this automatically.
  --help             Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)
      PREFIX="$2"
      shift 2
      ;;
    --user)
      USER_INSTALL=1
      shift
      ;;
    --recreate-venv)
      RECREATE_VENV=1
      shift
      ;;
    --setup-shutdown)
      SETUP_SHUTDOWN_ONLY=1
      shift
      if [[ $# -gt 0 && "$1" != -* ]]; then
        LINUXCNC_USER="$1"
        shift
      fi
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$USER_INSTALL" -eq 1 && "$PREFIX" == "/opt/plasmaweb" ]]; then
  PREFIX="${HOME}/.local/share/plasmaweb"
  BIN_DIR="${HOME}/.local/bin"
fi

if [[ -z "$BIN_DIR" && "$PREFIX" == "/opt/plasmaweb" ]]; then
  BIN_DIR="/usr/local/bin"
fi

if [[ -z "$BIN_DIR" && "$PREFIX" != "/opt/plasmaweb" ]]; then
  LINK_GLOBAL=0
fi

resolve_linuxcnc_user() {
  if [[ -n "$LINUXCNC_USER" ]]; then
    echo "$LINUXCNC_USER"
    return
  fi
  if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
    echo "$SUDO_USER"
    return
  fi
  if [[ "$USER_INSTALL" -eq 1 ]]; then
    echo "$USER"
    return
  fi
  echo ""
}

install_shutdown_permissions() {
  local strict="${1:-0}"
  local target_user helper sudoers_file line
  target_user="$(resolve_linuxcnc_user)"
  helper="$(readlink -f "${PREFIX}/bin/plasmaweb-shutdown" 2>/dev/null || true)"

  if [[ "$(id -u)" -ne 0 ]]; then
    if [[ -n "$target_user" ]]; then
      echo "To enable GUI shutdown, run once as root:"
      echo "  sudo $0 --prefix ${PREFIX} --setup-shutdown ${target_user}"
    else
      echo "To enable GUI shutdown, run once as root:"
      echo "  sudo $0 --prefix ${PREFIX} --setup-shutdown LINUXCNC_USER"
    fi
    return 0
  fi

  if [[ -z "$target_user" ]]; then
    if [[ "$strict" -eq 1 ]]; then
      echo "error: specify the LinuxCNC user, e.g. sudo $0 --setup-shutdown cnc" >&2
      exit 1
    fi
    echo "warning: could not detect LinuxCNC user; skipping GUI shutdown setup." >&2
    echo "  Run later: sudo $0 --prefix ${PREFIX} --setup-shutdown USERNAME" >&2
    return 0
  fi

  if [[ ! -x "$helper" ]]; then
    echo "error: missing executable ${PREFIX}/bin/plasmaweb-shutdown — run ./install.sh first to install plasmaweb" >&2
    exit 1
  fi

  if ! id "$target_user" >/dev/null 2>&1; then
    echo "error: user does not exist: ${target_user}" >&2
    exit 1
  fi

  sudoers_file="/etc/sudoers.d/plasmaweb-shutdown-${target_user}"
  line="${target_user} ALL=(root) NOPASSWD: ${helper} --as-root, ${helper} --dry-run, ${helper} --as-root --dry-run"

  if ! printf '%s\n' "$line" | visudo -cf - >/dev/null 2>&1; then
    echo "error: generated sudoers line failed validation" >&2
    exit 1
  fi

  umask 077
  printf '%s\n' "$line" >"$sudoers_file"
  chmod 440 "$sudoers_file"
  if ! visudo -cf "$sudoers_file" >/dev/null 2>&1; then
    rm -f "$sudoers_file"
    echo "error: wrote invalid sudoers file ${sudoers_file}" >&2
    exit 1
  fi

  echo "GUI shutdown enabled for user: ${target_user}"
  echo "  sudoers: ${sudoers_file}"
}

if [[ "$SETUP_SHUTDOWN_ONLY" -eq 1 ]]; then
  install_shutdown_permissions 1
  exit 0
fi

if [[ ! -f "${SOURCE_DIR}/dist/index.html" ]]; then
  echo "error: ${SOURCE_DIR}/dist/index.html not found." >&2
  echo "Download a release tarball with a pre-built frontend, or run:" >&2
  echo "  npm ci && npm run build" >&2
  exit 1
fi

find_python() {
  if [[ -n "${PLASMAWEB_PYTHON:-}" ]] && "$PLASMAWEB_PYTHON" -c "import linuxcnc" 2>/dev/null; then
    echo "$PLASMAWEB_PYTHON"
    return
  fi
  local py
  for py in python3 python; do
    if command -v "$py" >/dev/null 2>&1 && "$py" -c "import linuxcnc" 2>/dev/null; then
      echo "$py"
      return
    fi
  done
  echo "error: no Python with 'import linuxcnc' found. Install LinuxCNC first." >&2
  exit 1
}

PYTHON="$(find_python)"
PRODUCTION_CONFIG="${SOURCE_DIR}/resources/plasmaweb-config.production.json"

if [[ ! -f "$PRODUCTION_CONFIG" ]]; then
  echo "error: missing ${PRODUCTION_CONFIG}" >&2
  exit 1
fi

echo "Installing plasmaweb to: $PREFIX"
echo "Using Python: $PYTHON ($("$PYTHON" --version 2>&1))"

if [[ "$USER_INSTALL" -eq 0 && "$PREFIX" == "/opt/plasmaweb" ]]; then
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "error: system install to $PREFIX requires root (sudo ./install.sh) or use --user" >&2
    exit 1
  fi
fi

if [[ "$LINK_GLOBAL" -eq 1 && -n "$BIN_DIR" && "$BIN_DIR" == "/usr/local/bin" && "$(id -u)" -ne 0 ]]; then
  echo "error: linking into /usr/local/bin requires root (sudo) or use --user / custom --prefix" >&2
  exit 1
fi

copy_release_tree "$SOURCE_DIR" "$PREFIX"
write_production_config "${PREFIX}/dist" "$PRODUCTION_CONFIG"

VENV="${PREFIX}/venv"
if [[ "$RECREATE_VENV" -eq 1 && -d "$VENV" ]]; then
  echo "Removing existing venv at ${VENV}..."
  rm -rf "$VENV"
fi

echo "Creating Python venv at ${VENV} (system-site-packages for linuxcnc)..."
if ! "$PYTHON" -c "import venv" 2>/dev/null; then
  echo "error: python3-venv is required. On Raspberry Pi OS / Debian:" >&2
  echo "  sudo apt install python3-venv python3-full" >&2
  exit 1
fi
if [[ ! -x "${VENV}/bin/python" ]]; then
  "$PYTHON" -m venv --system-site-packages "$VENV"
fi

echo "Installing Python dependencies into venv..."
"${VENV}/bin/pip" install -r "${PREFIX}/backend/requirements-runtime.txt"

chmod +x "${PREFIX}/bin/plasmaweb" "${PREFIX}/bin/plasmaweb-shutdown"

if [[ "$LINK_GLOBAL" -eq 1 && -n "$BIN_DIR" ]]; then
  mkdir -p "$BIN_DIR"
  ln -sf "${PREFIX}/bin/plasmaweb" "${BIN_DIR}/plasmaweb"
  echo "Linked: ${BIN_DIR}/plasmaweb -> ${PREFIX}/bin/plasmaweb"
  # A machine whose INI still says DISPLAY = lcncgui keeps starting: the old name is a link
  # to the new launcher rather than a second copy of it.
  ln -sf "${PREFIX}/bin/plasmaweb" "${BIN_DIR}/lcncgui"
  echo "Linked: ${BIN_DIR}/lcncgui -> ${PREFIX}/bin/plasmaweb (for INIs that still say DISPLAY = lcncgui)"
else
  echo "No global symlink created. Add to PATH: ${PREFIX}/bin"
fi

install_shutdown_permissions 0

VERSION_LINE=""
if [[ -f "${PREFIX}/VERSION" ]]; then
  VERSION_LINE=" (version $(tr -d '\n' < "${PREFIX}/VERSION"))"
fi

cat <<EOF

plasmaweb installed${VERSION_LINE}.

Add to your machine INI:

  [DISPLAY]
  DISPLAY = plasmaweb

Optional macro subroutines (see resources/linuxcnc-subroutines/README.md):

  [RS274NGC]
  SUBROUTINE_PATH = ${PREFIX}/resources/linuxcnc-subroutines

Start LinuxCNC with your config from the config explorer, or:

  linuxcnc /path/to/your.ini

Full guide: ${PREFIX}/docs/installation.md

EOF
