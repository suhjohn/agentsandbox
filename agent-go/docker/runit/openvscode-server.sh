#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../env.sh"

if [[ "${AGENT_RUNTIME_MODE:-all}" != "all" ]]; then
  exit 0
fi

if ! command -v openvscode-server >/dev/null 2>&1; then
  exit 0
fi

OPENVSCODE_CONNECTION_TOKEN="${OPENVSCODE_CONNECTION_TOKEN:-}"

app_dir="${AGENT_GO_REPO_DIR}"
cd "${app_dir}"
mkdir -p "${OPENVSCODE_SERVER_WORKSPACE_DIR}"

host="${OPENVSCODE_SERVER_HOST}"
port="${OPENVSCODE_SERVER_PORT}"
if [[ "${OPENVSCODE_PROXY_ENABLED}" == "1" ]] \
  && [[ -x "${AGENT_SERVER_BIN}" ]]; then
  host="${OPENVSCODE_UPSTREAM_HOST}"
  port="${OPENVSCODE_UPSTREAM_PORT}"
fi

if [[ -z "${OPENVSCODE_CONNECTION_TOKEN}" ]]; then
  exit 0
fi

exec openvscode-server \
  --accept-server-license-terms \
  --connection-token "${OPENVSCODE_CONNECTION_TOKEN}" \
  --host "${host}" \
  --port "${port}" \
  --default-folder "${OPENVSCODE_SERVER_WORKSPACE_DIR}"
