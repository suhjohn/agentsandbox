#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${AGENT_GO_REPO_DIR:-/opt/agentsandbox/agent-go}"
CACHE_ROOT="${AGENT_GO_CACHE_DIR:-${ROOT_DIR:-/tmp}/go}"

if [[ -x /usr/local/bin/agent-go-update-source ]]; then
  /usr/local/bin/agent-go-update-source
fi

if [[ ! -d "${REPO_DIR}" ]]; then
  echo "[agent-server-launcher] repo dir not found: ${REPO_DIR}" >&2
  exit 1
fi

export GOCACHE="${GOCACHE:-${CACHE_ROOT}/build-cache}"
export GOMODCACHE="${GOMODCACHE:-${CACHE_ROOT}/mod-cache}"
mkdir -p "${GOCACHE}" "${GOMODCACHE}"

cd "${REPO_DIR}"
exec go run ./cmd/agent-go "$@"
