#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${AGENT_GO_REPO_DIR:-/opt/agentsandbox/agent-go}"
BINARY_PATH="${AGENT_SERVER_BINARY_PATH:-${REPO_DIR}/build-artifacts/agent-server}"

if [[ ! -d "${REPO_DIR}" ]]; then
  echo "[agent-server-launcher] repo dir not found: ${REPO_DIR}" >&2
  exit 1
fi

if [[ -x /usr/local/bin/agent-go-update-source ]]; then
  /usr/local/bin/agent-go-update-source
fi

if [[ ! -x "${BINARY_PATH}" ]]; then
  echo "[agent-server-launcher] binary not found: ${BINARY_PATH}" >&2
  exit 1
fi

cd "${REPO_DIR}"
exec "${BINARY_PATH}" "$@"
