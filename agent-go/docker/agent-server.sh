#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${AGENT_GO_REPO_DIR:-/opt/agentsandbox/agent-go}"
BINARY_PATH="${AGENT_SERVER_BINARY_PATH:-${ROOT_DIR:-/tmp}/bin/agent-server}"
PREPARE_SCRIPT="${AGENT_SERVER_PREPARE_SCRIPT:-${REPO_DIR}/docker/prepare-agent-server.sh}"

if [[ ! -d "${REPO_DIR}" ]]; then
  echo "[agent-server-launcher] repo dir not found: ${REPO_DIR}" >&2
  exit 1
fi

if [[ ! -x "${PREPARE_SCRIPT}" ]]; then
  echo "[agent-server-launcher] prepare script not found: ${PREPARE_SCRIPT}" >&2
  exit 1
fi

"${PREPARE_SCRIPT}"

cd "${REPO_DIR}"
exec "${BINARY_PATH}" "$@"
