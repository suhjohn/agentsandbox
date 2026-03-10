#!/usr/bin/env bash
set -euo pipefail

AGENT_GO_REPO_DIR="${AGENT_GO_REPO_DIR:-/opt/agentsandbox/agent-go}"
AGENT_SERVER_BIN="${AGENT_SERVER_BIN:-${AGENT_GO_REPO_DIR}/build-artifacts/agent-server}"

if [[ ! -x "${AGENT_SERVER_BIN}" ]]; then
  echo "${AGENT_SERVER_BIN} not found for OpenVSCode proxy" >&2
  exit 1
fi

export OPENVSCODE_PROXY_HOST="${OPENVSCODE_PROXY_HOST:-0.0.0.0}"
export OPENVSCODE_PROXY_PORT="${OPENVSCODE_PROXY_PORT:-39393}"
export OPENVSCODE_UPSTREAM_HOST="${OPENVSCODE_UPSTREAM_HOST:-127.0.0.1}"
export OPENVSCODE_UPSTREAM_PORT="${OPENVSCODE_UPSTREAM_PORT:-39395}"

exec "${AGENT_SERVER_BIN}" openvscode-proxy
