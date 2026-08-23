#!/usr/bin/env bash
# Shared helpers for install.sh and scripts/build-release.sh

release_name() {
  local version="${1:?version required}"
  echo "plasmaweb-${version}-linux"
}

copy_release_tree() {
  local source_dir="${1:?source_dir required}"
  local dest_dir="${2:?dest_dir required}"
  mkdir -p "$dest_dir"
  rsync -a --delete \
    "${source_dir}/bin" \
    "${source_dir}/backend" \
    "${source_dir}/dist" \
    "${source_dir}/install.sh" \
    "${source_dir}/uninstall.sh" \
    "${source_dir}/resources" \
    "${dest_dir}/"
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
