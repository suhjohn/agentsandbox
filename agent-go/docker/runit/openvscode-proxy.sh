#!/usr/bin/env bash
set -euo pipefail

if [[ ! -x "/app/agent-server" ]]; then
  echo "/app/agent-server not found for OpenVSCode proxy" >&2
  exit 1
fi

export OPENVSCODE_PROXY_HOST="${OPENVSCODE_PROXY_HOST:-0.0.0.0}"
export OPENVSCODE_PROXY_PORT="${OPENVSCODE_PROXY_PORT:-39393}"
export OPENVSCODE_UPSTREAM_HOST="${OPENVSCODE_UPSTREAM_HOST:-127.0.0.1}"
export OPENVSCODE_UPSTREAM_PORT="${OPENVSCODE_UPSTREAM_PORT:-39395}"

exec /app/agent-server openvscode-proxy
