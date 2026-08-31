#!/usr/bin/env bash
# Remove an plasmaweb installation created by install.sh.
#
# Usage:
#   sudo ./uninstall.sh                 # remove /opt/plasmaweb install
#   ./uninstall.sh --user               # remove ~/.local/share/plasmaweb install
#   ./uninstall.sh --prefix /path/to/dir
#   ./uninstall.sh --yes                # skip confirmation prompt

set -euo pipefail

PREFIX="/opt/plasmaweb"
USER_INSTALL=0
KEEP_USER_DATA=0
ASSUME_YES=0
BIN_DIR=""
LINK_GLOBAL=1

usage() {
  cat <<'EOF'
Usage: uninstall.sh [--prefix DIR] [--user] [--keep-user-data] [--yes] [--help]

Removes an plasmaweb install created by install.sh:

  - Stops running plasmaweb backend processes for this install prefix
  - Removes the plasmaweb symlink from PATH (/usr/local/bin or ~/.local/bin)
  - Removes matching /etc/sudoers.d/plasmaweb-shutdown-* entries for this prefix (requires root)
  - Deletes the install directory (application files and venv)
  - Deletes ~/.local/share/plasmaweb user data (preferences, Chromium profile)
    unless --keep-user-data is set or --user install (already removed with PREFIX)

Options:
  --prefix DIR       Install root (default: /opt/plasmaweb, or ~/.local/share/plasmaweb with --user)
  --user             Uninstall per-user install (~/.local/share/plasmaweb, ~/.local/bin/plasmaweb)
  --keep-user-data   Keep ~/.local/share/plasmaweb (settings, browser profile) after system install
  --yes, -y          Do not ask for confirmation
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
    --keep-user-data)
      KEEP_USER_DATA=1
      shift
      ;;
    --yes|-y)
      ASSUME_YES=1
      shift
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

PREFIX="$(readlink -f "$PREFIX" 2>/dev/null || echo "$PREFIX")"

resolve_data_home() {
  local data_home="${XDG_DATA_HOME:-}"
  if [[ -n "$data_home" ]]; then
    echo "$data_home/plasmaweb"
    return
  fi
  local home_dir="$HOME"
  if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
    home_dir="$(getent passwd "$SUDO_USER" | cut -d: -f6 || true)"
    [[ -n "$home_dir" ]] || home_dir="$HOME"
  fi
  echo "${home_dir}/.local/share/plasmaweb"
}

confirm() {
  if [[ "$ASSUME_YES" -eq 1 ]]; then
    return 0
  fi
  local prompt="$1"
  local answer
  read -r -p "${prompt} [y/N] " answer
  case "$answer" in
    y|Y|yes|Yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

is_lcncgui_backend_pid() {
  local pid="$1"
  local prefix="$2"
  local args cwd
  args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$args" == *"uvicorn"* && "$args" == *"backend.main"* ]] || return 1
  cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
  [[ "$cwd" == "$prefix" || "$args" == *"${prefix}"* ]] || return 1
  return 0
}

stop_install_processes() {
  local prefix="$1"
  local pid stopped=0

  for pid in $(pgrep -f 'uvicorn.*backend\.main' 2>/dev/null || true); do
    [[ -z "$pid" ]] && continue
    if is_lcncgui_backend_pid "$pid" "$prefix"; then
      echo "Stopping plasmaweb backend (PID ${pid})..."
      kill "$pid" 2>/dev/null || true
      stopped=1
    fi
  done

  if [[ "$stopped" -eq 1 ]]; then
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
      local still=0
      for pid in $(pgrep -f 'uvicorn.*backend\.main' 2>/dev/null || true); do
        [[ -z "$pid" ]] && continue
        if is_lcncgui_backend_pid "$pid" "$prefix"; then
          still=1
          break
        fi
      done
      [[ "$still" -eq 0 ]] && break
      sleep 0.2
    done
  fi
}

# Every name install.sh links onto PATH, and the launcher each one points at.
LINK_NAMES=("plasmaweb:plasmaweb" "plasmacweb:plasmacweb" "lcncgui:plasmaweb")

remove_symlink() {
  local name="${1%%:*}"
  local launcher="${1##*:}"
  local link="${BIN_DIR}/${name}"
  [[ -n "$BIN_DIR" ]] || return 0
  [[ -e "$link" || -L "$link" ]] || return 0

  local target expected
  expected="${PREFIX}/bin/${launcher}"
  if [[ -L "$link" ]]; then
    target="$(readlink -f "$link" 2>/dev/null || readlink "$link" 2>/dev/null || true)"
    if [[ "$target" == "$expected" ]]; then
      rm -f "$link"
      echo "Removed symlink: ${link}"
      return 0
    fi
    echo "warning: ${link} points elsewhere (${target}); leaving it in place." >&2
    return 0
  fi

  echo "warning: ${link} exists but is not a symlink; leaving it in place." >&2
}

remove_shutdown_sudoers() {
  local prefix="$1"
  local helper file removed=0
  helper="$(readlink -f "${prefix}/bin/plasmaweb-shutdown" 2>/dev/null || true)"
  shopt -s nullglob
  for file in /etc/sudoers.d/plasmaweb-shutdown-*; do
    if [[ -n "$helper" ]] && grep -qF "$helper" "$file" 2>/dev/null; then
      rm -f "$file"
      echo "Removed sudoers: ${file}"
      removed=1
      continue
    fi
    if [[ -z "$helper" ]]; then
      rm -f "$file"
      echo "Removed sudoers: ${file}"
      removed=1
    fi
  done
  shopt -u nullglob
  if [[ "$removed" -eq 0 ]]; then
    return 0
  fi
  if [[ "$(id -u)" -eq 0 ]] && command -v visudo >/dev/null 2>&1; then
    visudo -c >/dev/null 2>&1 || echo "warning: sudoers validation reported an issue; check /etc/sudoers.d/" >&2
  fi
}

remove_user_data() {
  local data_dir="$1"
  local resolved
  resolved="$(readlink -f "$data_dir" 2>/dev/null || echo "$data_dir")"

  if [[ "$resolved" == "$PREFIX" ]]; then
    return 0
  fi
  if [[ ! -e "$data_dir" ]]; then
    return 0
  fi

  rm -rf "$data_dir"
  echo "Removed user data: ${data_dir}"
}

if [[ "$USER_INSTALL" -eq 0 && "$PREFIX" == "/opt/plasmaweb" && "$(id -u)" -ne 0 ]]; then
  echo "error: system uninstall from ${PREFIX} requires root (sudo ./uninstall.sh) or use --user" >&2
  exit 1
fi

if [[ "$LINK_GLOBAL" -eq 1 && -n "$BIN_DIR" && "$BIN_DIR" == "/usr/local/bin" && "$(id -u)" -ne 0 ]]; then
  echo "error: removing symlink from /usr/local/bin requires root (sudo) or use --user / custom --prefix" >&2
  exit 1
fi

USER_DATA_DIR="$(resolve_data_home)"

echo "This will remove plasmaweb from: ${PREFIX}"
if [[ -n "$BIN_DIR" ]]; then
  for link_spec in "${LINK_NAMES[@]}"; do
    echo "  Symlink: ${BIN_DIR}/${link_spec%%:*} (if it points to this install)"
  done
fi
if [[ "$(id -u)" -eq 0 ]]; then
  echo "  Sudoers: /etc/sudoers.d/plasmaweb-shutdown-* (matching this install prefix)"
fi
if [[ "$KEEP_USER_DATA" -eq 0 && "$USER_DATA_DIR" != "$PREFIX" ]]; then
  echo "  User data: ${USER_DATA_DIR}"
fi

if ! confirm "Proceed?"; then
  echo "Aborted."
  exit 0
fi

stop_install_processes "$PREFIX"
for link_spec in "${LINK_NAMES[@]}"; do
  remove_symlink "$link_spec"
done

if [[ "$(id -u)" -eq 0 ]]; then
  remove_shutdown_sudoers "$PREFIX"
elif compgen -G "/etc/sudoers.d/plasmaweb-shutdown-*" >/dev/null 2>&1; then
  echo "To remove GUI shutdown permissions, run:"
  echo "  sudo $0 --prefix ${PREFIX} --yes"
fi

if [[ -d "$PREFIX" ]]; then
  rm -rf "$PREFIX"
  echo "Removed install directory: ${PREFIX}"
elif [[ -e "$PREFIX" ]]; then
  rm -rf "$PREFIX"
  echo "Removed: ${PREFIX}"
else
  echo "Install directory not found (already removed?): ${PREFIX}"
fi

if [[ "$KEEP_USER_DATA" -eq 0 ]]; then
  remove_user_data "$USER_DATA_DIR"
fi

cat <<EOF

plasmaweb uninstalled.

If your machine INI still has DISPLAY = plasmaweb, change or remove that line
before starting LinuxCNC again.

EOF
