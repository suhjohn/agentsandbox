#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${AGENT_GO_REPO_DIR:-/opt/agentsandbox/agent-go}"
CACHE_ROOT="${AGENT_GO_CACHE_DIR:-${ROOT_DIR:-/tmp}/go}"
BINARY_PATH="${AGENT_SERVER_BINARY_PATH:-${REPO_DIR}/build-artifacts/agent-server}"
BINARY_REV_FILE="${BINARY_PATH}.rev"

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

should_rebuild=1
current_rev=""
current_dirty="1"
if git -C "${REPO_DIR}" rev-parse --show-toplevel >/dev/null 2>&1; then
  current_rev="$(git -C "${REPO_DIR}" rev-parse HEAD 2>/dev/null || true)"
  if [[ -z "$(git -C "${REPO_DIR}" status --porcelain --untracked-files=no 2>/dev/null || true)" ]]; then
    current_dirty="0"
  fi
fi

if [[ -x "${BINARY_PATH}" ]]; then
  if [[ -n "${current_rev}" ]] && [[ "${current_dirty}" == "0" ]] && [[ -f "${BINARY_REV_FILE}" ]]; then
    stored_rev="$(tr -d '[:space:]' <"${BINARY_REV_FILE}" 2>/dev/null || true)"
    if [[ "${stored_rev}" == "${current_rev}" ]]; then
      should_rebuild=0
    fi
  fi
fi

if [[ "${should_rebuild}" == "1" ]]; then
  "${REPO_DIR}/scripts/build-agent-server.sh" --output "${BINARY_PATH}"
  if [[ -n "${current_rev}" ]] && [[ "${current_dirty}" == "0" ]]; then
    printf '%s\n' "${current_rev}" >"${BINARY_REV_FILE}"
  else
    rm -f "${BINARY_REV_FILE}" 2>/dev/null || true
  fi
fi

cd "${REPO_DIR}"
exec "${BINARY_PATH}" "$@"
