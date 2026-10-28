#!/usr/bin/env bash
# Shared helpers for install.sh and scripts/build-release.sh

release_name() {
  local version="${1:?version required}"
  echo "plasmaweb-${version}-linux"
}

copy_release_tree() {
  local source_dir="${1:?source_dir required}"
  local dest_dir="${2:?dest_dir required}"
  local item
  local -a items=(bin backend dist install.sh uninstall.sh resources)
  mkdir -p "$dest_dir"
  # Re-running PREFIX/install.sh (e.g. --recreate-venv) copies the tree onto itself: nothing
  # to do, and the rm-then-copy below would destroy it.
  if [[ "$(readlink -f "$source_dir")" == "$(readlink -f "$dest_dir")" ]]; then
    return 0
  fi
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "${items[@]/#/${source_dir}/}" "${dest_dir}/"
  else
    # The LinuxCNC ISO ships without rsync.
    for item in "${items[@]}"; do
      rm -rf "${dest_dir:?}/${item}"
      cp -a "${source_dir}/${item}" "${dest_dir}/"
    done
  fi
  mkdir -p "${dest_dir}/docs" "${dest_dir}/scripts"
  cp "${source_dir}/docs/installation.md" "${dest_dir}/docs/"
  cp "${source_dir}/scripts/release-common.sh" "${dest_dir}/scripts/"
}

write_production_config() {
  local dest_dist="${1:?dest_dist required}"
  local template="${2:?template required}"
  mkdir -p "$dest_dist"
  cp "$template" "${dest_dist}/plasmaweb-config.json"
}

write_version_file() {
  local dest_dir="${1:?dest_dir required}"
  local version="${2:?version required}"
  cat >"${dest_dir}/VERSION" <<EOF
${version}
EOF
}
