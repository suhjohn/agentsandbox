#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../env.sh"

if [[ "${AGENT_RUNTIME_MODE:-all}" != "all" ]] || [[ "${OPENVSCODE_PROXY_ENABLED:-1}" != "1" ]]; then
  exit 0
fi

if [[ ! -x "${AGENT_SERVER_BIN}" ]]; then
  exit 0
fi


exec "${AGENT_SERVER_BIN}" openvscode-proxy
