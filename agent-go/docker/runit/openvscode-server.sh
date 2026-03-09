#!/usr/bin/env bash
set -euo pipefail

if ! command -v openvscode-server >/dev/null 2>&1; then
  echo "openvscode-server not found" >&2
  exit 1
fi

OPENVSCODE_SERVER_HOST="${OPENVSCODE_SERVER_HOST:-0.0.0.0}"
OPENVSCODE_SERVER_PORT="${OPENVSCODE_SERVER_PORT:-39393}"
OPENVSCODE_SERVER_WORKSPACE_DIR="${OPENVSCODE_SERVER_WORKSPACE_DIR:-/home/agent/workspaces}"
OPENVSCODE_CONNECTION_TOKEN="${OPENVSCODE_CONNECTION_TOKEN:-}"
OPENVSCODE_PROXY_ENABLED="${OPENVSCODE_PROXY_ENABLED:-1}"
OPENVSCODE_UPSTREAM_HOST="${OPENVSCODE_UPSTREAM_HOST:-127.0.0.1}"
OPENVSCODE_UPSTREAM_PORT="${OPENVSCODE_UPSTREAM_PORT:-39395}"

app_dir="/app"
if [[ -n "${ROOT_DIR:-}" ]] && [[ -d "${ROOT_DIR}/app" ]]; then
  app_dir="${ROOT_DIR}/app"
fi
cd "${app_dir}"
mkdir -p "${OPENVSCODE_SERVER_WORKSPACE_DIR}"

host="${OPENVSCODE_SERVER_HOST}"
port="${OPENVSCODE_SERVER_PORT}"
if [[ "${OPENVSCODE_PROXY_ENABLED}" == "1" ]] \
  && [[ -x "/app/agent-server" ]]; then
  host="${OPENVSCODE_UPSTREAM_HOST}"
  port="${OPENVSCODE_UPSTREAM_PORT}"
fi

if [[ -z "${OPENVSCODE_CONNECTION_TOKEN}" ]]; then
  echo "OPENVSCODE_CONNECTION_TOKEN is required" >&2
  exit 1
fi

exec openvscode-server \
  --accept-server-license-terms \
  --connection-token "${OPENVSCODE_CONNECTION_TOKEN}" \
  --host "${host}" \
  --port "${port}" \
  --default-folder "${OPENVSCODE_SERVER_WORKSPACE_DIR}"
