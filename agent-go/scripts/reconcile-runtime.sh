#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd -- "${MODULE_DIR}/.." && pwd)"

AGENT_GO_REPO_DIR="${AGENT_GO_REPO_DIR:-${MODULE_DIR}}"
AGENT_SERVER_BIN="${AGENT_SERVER_BIN:-${AGENT_GO_REPO_DIR}/build-artifacts/agent-server}"
ENTRYPOINT="${AGENT_GO_REPO_DIR}/docker/entrypoint.sh"
ROOT_DIR="${ROOT_DIR:-/home/agent/runtime}"
RUNITSV_SERVICE_DIR="${RUNITSV_SERVICE_DIR:-${ROOT_DIR}/runit/services}"
PULL_REF="${AGENT_GO_PULL_REF:-main}"

DO_PULL=1
DO_BUILD=1
DO_SYNC=1
DO_RECONCILE=1
DO_RESTART=1

usage() {
  cat <<'EOF'
Refresh the live sandbox runtime from the repo checkout without replacing the runtime directory.

Usage:
  reconcile-runtime.sh [options] [-- [agent-server args...]]

Options:
  --no-pull         Skip git pull.
  --no-build        Skip rebuilding agent-server.
  --no-sync         Skip refreshing installed helper files.
  --no-reconcile    Skip entrypoint reconcile mode.
  --no-restart      Skip runit service restarts.
  --pull-ref REF    Git ref to pull (default: $AGENT_GO_PULL_REF or main).
  -h, --help        Show this help.

Examples:
  ./agent-go/scripts/reconcile-runtime.sh
  ./agent-go/scripts/reconcile-runtime.sh --no-pull -- --opt/agentsandbox/agent-go/build-artifacts/agent-server serve
EOF
}

log() {
  printf '[reconcile-runtime] %s\n' "$*"
}

sync_installed_files() {
  local novnc_src="${AGENT_GO_REPO_DIR}/docker/novnc/index.html"
  local docker_wrapper_src="${AGENT_GO_REPO_DIR}/docker/docker-wrapper.sh"

  if [[ -f "${docker_wrapper_src}" ]]; then
    install -m 0755 "${docker_wrapper_src}" /usr/local/bin/docker
  fi

  if [[ -f "${novnc_src}" ]]; then
    mkdir -p /usr/share/novnc
    cp -f "${novnc_src}" /usr/share/novnc/index.html
    cp -f "${novnc_src}" /usr/share/novnc/vnc.html
    cp -f "${novnc_src}" /usr/share/novnc/vnc_lite.html
  fi

  chmod +x "${AGENT_GO_REPO_DIR}/docker/entrypoint.sh" 2>/dev/null || true
  chmod +x "${AGENT_GO_REPO_DIR}/docker/runit/"*.sh 2>/dev/null || true
  chmod +x "${AGENT_SERVER_BIN}" 2>/dev/null || true
}

restart_services() {
  local service=""
  if ! command -v sv >/dev/null 2>&1; then
    log "sv not found; skipping service restarts"
    return 0
  fi

  for service in agent-server openvscode-server openvscode-proxy ui-stack dockerd; do
    local dir="${RUNITSV_SERVICE_DIR}/${service}"
    if [[ -d "${dir}" ]]; then
      log "restarting ${dir}"
      sv restart "${dir}" || true
    fi
  done
}

SERVICE_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-pull)
      DO_PULL=0
      shift
      ;;
    --no-build)
      DO_BUILD=0
      shift
      ;;
    --no-sync)
      DO_SYNC=0
      shift
      ;;
    --no-reconcile)
      DO_RECONCILE=0
      shift
      ;;
    --no-restart)
      DO_RESTART=0
      shift
      ;;
    --pull-ref)
      PULL_REF="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      SERVICE_ARGS=("$@")
      break
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ${#SERVICE_ARGS[@]} -eq 0 ]]; then
  SERVICE_ARGS=("${AGENT_SERVER_BIN}" "serve")
fi

if [[ "${DO_PULL}" == "1" ]]; then
  log "pulling ${PULL_REF}"
  git -C "${REPO_ROOT}" pull --ff-only origin "${PULL_REF}"
fi

if [[ "${DO_BUILD}" == "1" ]]; then
  log "building ${AGENT_SERVER_BIN}"
  "${SCRIPT_DIR}/dev.sh" build-server --output "${AGENT_SERVER_BIN}"
fi

if [[ "${DO_SYNC}" == "1" ]]; then
  log "syncing installed helper files"
  sync_installed_files
fi

if [[ "${DO_RECONCILE}" == "1" ]]; then
  log "reconciling runtime paths and service definitions"
  "${ENTRYPOINT}" reconcile "${SERVICE_ARGS[@]}"
fi

if [[ "${DO_RESTART}" == "1" ]]; then
  restart_services
fi

log "done"
