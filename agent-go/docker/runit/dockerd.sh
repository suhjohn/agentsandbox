#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../env.sh"

if [[ "${DOCKERD_ENABLED:-0}" != "1" ]]; then
  exit 0
fi

if ! command -v dockerd >/dev/null 2>&1; then
  exit 0
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
