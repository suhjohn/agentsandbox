#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-}"
if [[ -z "${ROOT_DIR}" ]]; then
  echo "ROOT_DIR is required for dockerd service" >&2
  exit 1
fi
DOCKERD_DATA_ROOT="${DOCKERD_DATA_ROOT:-${ROOT_DIR}/docker}"
DOCKERD_LOG_FILE="${DOCKERD_LOG_FILE:-${ROOT_DIR}/logs/dockerd.log}"
DOCKERD_BRIDGE="${DOCKERD_BRIDGE:-none}"
DOCKERD_STORAGE_DRIVER="${DOCKERD_STORAGE_DRIVER:-vfs}"

if ! command -v dockerd >/dev/null 2>&1; then
  echo "[dockerd] dockerd binary not found" >&2
  exit 1
fi

mkdir -p "/var/run" "${DOCKERD_DATA_ROOT}" "$(dirname "${DOCKERD_LOG_FILE}")" 2>/dev/null || true
rm -f /var/run/docker.pid /var/run/docker.sock 2>/dev/null || true

dockerd_args=(
  --host=unix:///var/run/docker.sock
  --data-root="${DOCKERD_DATA_ROOT}"
  --iptables=false
  --ip6tables=false
)

if [[ -n "${DOCKERD_BRIDGE}" ]]; then
  dockerd_args+=(--bridge="${DOCKERD_BRIDGE}")
fi
if [[ -n "${DOCKERD_STORAGE_DRIVER}" ]]; then
  dockerd_args+=(--storage-driver="${DOCKERD_STORAGE_DRIVER}")
fi

exec dockerd "${dockerd_args[@]}" >>"${DOCKERD_LOG_FILE}" 2>&1
