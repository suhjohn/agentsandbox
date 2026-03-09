#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${AGENT_GO_REPO_DIR:-/opt/agentsandbox/agent-go}"
CACHE_ROOT="${AGENT_GO_CACHE_DIR:-${ROOT_DIR:-/tmp}/go}"
RUNTIME_BINARY_PATH="${AGENT_SERVER_BINARY_PATH:-${ROOT_DIR:-/tmp}/bin/agent-server}"
RUNTIME_REV_FILE="${RUNTIME_BINARY_PATH}.rev"
BUNDLED_BINARY_PATH="${AGENT_SERVER_BUNDLED_BINARY_PATH:-/opt/agent-image/agent-server}"
BUNDLED_REV_FILE="${AGENT_SERVER_BUNDLED_REV_FILE:-/opt/agent-image/agent-server.rev}"
SYNC_SOURCE="${AGENT_GO_SYNC_SOURCE:-1}"

log() {
  printf '[agent-server-prepare] %s\n' "$*" >&2
}

if [[ "${SYNC_SOURCE}" == "1" ]] && [[ -x /usr/local/bin/agent-go-update-source ]]; then
  /usr/local/bin/agent-go-update-source
fi

if [[ ! -d "${REPO_DIR}" ]]; then
  echo "[agent-server-prepare] repo dir not found: ${REPO_DIR}" >&2
  exit 1
fi

export GOCACHE="${GOCACHE:-${CACHE_ROOT}/build-cache}"
export GOMODCACHE="${GOMODCACHE:-${CACHE_ROOT}/mod-cache}"
mkdir -p "${GOCACHE}" "${GOMODCACHE}"
mkdir -p "$(dirname "${RUNTIME_BINARY_PATH}")"

current_rev=""
if git -C "${REPO_DIR}" rev-parse --show-toplevel >/dev/null 2>&1; then
  current_rev="$(git -C "${REPO_DIR}" rev-parse HEAD 2>/dev/null || true)"
fi

read_rev() {
  local path="${1:-}"
  if [[ -f "${path}" ]]; then
    tr -d '[:space:]' <"${path}" 2>/dev/null || true
  fi
}

runtime_rev="$(read_rev "${RUNTIME_REV_FILE}")"
if [[ -x "${RUNTIME_BINARY_PATH}" ]] && [[ -n "${current_rev}" ]] && [[ "${runtime_rev}" == "${current_rev}" ]]; then
  log "using runtime agent-server binary for revision ${current_rev}"
  exit 0
fi

bundled_rev="$(read_rev "${BUNDLED_REV_FILE}")"
if [[ -x "${BUNDLED_BINARY_PATH}" ]] && [[ -n "${current_rev}" ]] && [[ "${bundled_rev}" == "${current_rev}" ]]; then
  log "using bundled agent-server binary for revision ${current_rev}"
  cp "${BUNDLED_BINARY_PATH}" "${RUNTIME_BINARY_PATH}"
  chmod +x "${RUNTIME_BINARY_PATH}"
  printf '%s\n' "${current_rev}" >"${RUNTIME_REV_FILE}"
  exit 0
fi

log "building agent-server binary"
"${REPO_DIR}/scripts/dev.sh" build-server --output "${RUNTIME_BINARY_PATH}"
if [[ -n "${current_rev}" ]]; then
  printf '%s\n' "${current_rev}" >"${RUNTIME_REV_FILE}"
else
  rm -f "${RUNTIME_REV_FILE}" 2>/dev/null || true
fi
