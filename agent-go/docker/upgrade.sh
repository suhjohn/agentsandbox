#!/usr/bin/env bash
set -euo pipefail

AGENT_HOME="${AGENT_HOME:-/home/agent}"
ROOT_DIR="${ROOT_DIR:-${AGENT_HOME}/runtime}"
AGENT_GO_REPO_DIR="${AGENT_GO_REPO_DIR:-/opt/agentsandbox/agent-go}"
AGENT_DOCKER_DIR="${AGENT_DOCKER_DIR:-${AGENT_GO_REPO_DIR}/docker}"
AGENT_TOOLS_DIR="${AGENT_TOOLS_DIR:-${AGENT_GO_REPO_DIR}/tools}"
AGENT_SERVER_BIN="${AGENT_SERVER_BIN:-${AGENT_GO_REPO_DIR}/build-artifacts/agent-server-linux-amd64}"
WORKSPACES_DIR="${WORKSPACES_DIR:-${AGENT_HOME}/workspaces}"
WORKSPACE_TOOLS_DIR="${WORKSPACE_TOOLS_DIR:-${WORKSPACES_DIR}/tools}"
CODEX_HOME="${CODEX_HOME:-${AGENT_HOME}/.codex}"
PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-${AGENT_HOME}/.pi}"
XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-${ROOT_DIR}/xdg/config}"
XDG_CACHE_HOME="${XDG_CACHE_HOME:-${ROOT_DIR}/xdg/cache}"
XDG_DATA_HOME="${XDG_DATA_HOME:-${ROOT_DIR}/xdg/data}"
BROWSER_STATE_DIR="${BROWSER_STATE_DIR:-${ROOT_DIR}/browser}"
BROWSER_HOME_DIR="${BROWSER_HOME_DIR:-${BROWSER_STATE_DIR}/home}"
BROWSER_XDG_CONFIG_HOME="${BROWSER_XDG_CONFIG_HOME:-${BROWSER_STATE_DIR}/xdg/config}"
BROWSER_XDG_CACHE_HOME="${BROWSER_XDG_CACHE_HOME:-${BROWSER_STATE_DIR}/xdg/cache}"
BROWSER_XDG_DATA_HOME="${BROWSER_XDG_DATA_HOME:-${BROWSER_STATE_DIR}/xdg/data}"
CHROMIUM_USER_DATA_DIR="${CHROMIUM_USER_DATA_DIR:-${BROWSER_STATE_DIR}/chromium}"
VNC_PASSWD_FILE="${VNC_PASSWD_FILE:-${ROOT_DIR}/vnc/passwd}"
OPENVSCODE_SERVER_HOST="${OPENVSCODE_SERVER_HOST:-0.0.0.0}"
OPENVSCODE_SERVER_PORT="${OPENVSCODE_SERVER_PORT:-39393}"
OPENVSCODE_SERVER_WORKSPACE_DIR="${OPENVSCODE_SERVER_WORKSPACE_DIR:-${WORKSPACES_DIR}}"
OPENVSCODE_PROXY_ENABLED="${OPENVSCODE_PROXY_ENABLED:-1}"
OPENVSCODE_PROXY_HOST="${OPENVSCODE_PROXY_HOST:-${OPENVSCODE_SERVER_HOST}}"
OPENVSCODE_PROXY_PORT="${OPENVSCODE_PROXY_PORT:-${OPENVSCODE_SERVER_PORT}}"
OPENVSCODE_UPSTREAM_HOST="${OPENVSCODE_UPSTREAM_HOST:-127.0.0.1}"
OPENVSCODE_UPSTREAM_PORT="${OPENVSCODE_UPSTREAM_PORT:-39395}"
DOCKERD_ENABLED="${DOCKERD_ENABLED:-0}"
DOCKERD_LOG_FILE="${DOCKERD_LOG_FILE:-${ROOT_DIR}/logs/dockerd.log}"
DOCKERD_DATA_ROOT="${DOCKERD_DATA_ROOT:-${ROOT_DIR}/docker}"
DOCKERD_BRIDGE="${DOCKERD_BRIDGE:-}"
DOCKERD_STORAGE_DRIVER="${DOCKERD_STORAGE_DRIVER:-}"
AGENT_SERVER_LOG_FILE="${AGENT_SERVER_LOG_FILE:-${ROOT_DIR}/logs/agent-server.log}"
AGENT_SERVER_LOG_ENABLED="${AGENT_SERVER_LOG_ENABLED:-1}"
AGENT_RUNTIME_MODE="${AGENT_RUNTIME_MODE:-all}"
UPGRADE_STATE_DIR="${ROOT_DIR}/upgrade-state"
PULL_REF="${AGENT_GO_PULL_REF:-main}"
LOCK_FILE="${AGENT_GO_PULL_LOCK_FILE:-/tmp/agent-go-pull.lock}"
TARGET_REF=""
SERVICE_ARGS=()

log() {
  printf '[agent-upgrade] %s\n' "$*" >&2
}

usage() {
  cat <<'EOF'
Usage:
  /opt/agentsandbox/agent-go/docker/upgrade.sh [commit-or-ref] [-- agent-server args...]

Examples:
  /opt/agentsandbox/agent-go/docker/upgrade.sh
  /opt/agentsandbox/agent-go/docker/upgrade.sh main
  /opt/agentsandbox/agent-go/docker/upgrade.sh 0123abcd -- /opt/agentsandbox/agent-go/build-artifacts/agent-server-linux-amd64 serve
EOF
}

sync_installed_files() {
  local novnc_src="${AGENT_DOCKER_DIR}/novnc/index.html"
  local docker_wrapper_src="${AGENT_DOCKER_DIR}/docker-wrapper.sh"

  install -m 0755 "${docker_wrapper_src}" /usr/local/bin/docker
  mkdir -p /usr/share/novnc
  cp -f "${novnc_src}" /usr/share/novnc/index.html
  cp -f "${novnc_src}" /usr/share/novnc/vnc.html
  cp -f "${novnc_src}" /usr/share/novnc/vnc_lite.html
  chmod +x "${AGENT_DOCKER_DIR}/start.sh"
  chmod +x "${AGENT_DOCKER_DIR}/build.sh"
  chmod +x "${AGENT_DOCKER_DIR}/upgrade.sh"
  chmod +x "${AGENT_DOCKER_DIR}/docker-wrapper.sh"
  chmod +x "${AGENT_DOCKER_DIR}/runit/"*.sh
  chmod +x "${AGENT_SERVER_BIN}"
}

ensure_workspace_tools_links() {
  local tools_path="${WORKSPACE_TOOLS_DIR}"
  local src_tools="${AGENT_TOOLS_DIR}"

  [[ -d "${src_tools}" ]] || return 0

  if [[ -e "${tools_path}" ]] && [[ ! -d "${tools_path}" ]]; then
    tools_path="${ROOT_DIR}/tools"
    WORKSPACE_TOOLS_DIR="${tools_path}"
    export WORKSPACE_TOOLS_DIR
  fi

  local bundled_tools_path="${tools_path}/default"
  mkdir -p "${tools_path}" "${bundled_tools_path}" 2>/dev/null || true

  local src_path=""
  while IFS= read -r -d '' src_path; do
    local name=""
    local target_path=""
    name="$(basename "${src_path}")"
    target_path="${bundled_tools_path}/${name}"
    if [[ -e "${target_path}" ]]; then
      continue
    fi
    ln -s "${src_path}" "${target_path}" 2>/dev/null || true
  done < <(find "${src_tools}" -mindepth 1 -maxdepth 1 -print0)
}

seed_workspace_baseline_runtime() {
  local src="/opt/agent-image/workspace-baseline/sandbox"
  local dst="${ROOT_DIR}/workspace-baseline/sandbox"

  [[ -d "${src}" ]] || return 0
  mkdir -p "${dst}"
  # Don't overwrite user-modified baseline contents if they already exist.
  cp -a -n "${src}/." "${dst}/" 2>/dev/null || true
}

prepare_runtime_state() {
  mkdir -p \
    "${AGENT_HOME}" \
    "${WORKSPACES_DIR}" \
    "${ROOT_DIR}/logs" \
    "${ROOT_DIR}/run" \
    "${BROWSER_HOME_DIR}" \
    "${CHROMIUM_USER_DATA_DIR}" \
    "${BROWSER_XDG_CONFIG_HOME}" \
    "${BROWSER_XDG_CACHE_HOME}" \
    "${BROWSER_XDG_DATA_HOME}" \
    "${CODEX_HOME}" \
    "${PI_CODING_AGENT_DIR}" \
    "${XDG_CONFIG_HOME}" \
    "${XDG_CACHE_HOME}" \
    "${XDG_DATA_HOME}" \
    "${UPGRADE_STATE_DIR}" \
    "$(dirname "${VNC_PASSWD_FILE}")" \
    2>/dev/null || true

  ensure_workspace_tools_links
  seed_workspace_baseline_runtime
}

require_secret_seed() {
  local seed="${SECRET_SEED:-}"
  seed="${seed#"${seed%%[![:space:]]*}"}"
  seed="${seed%"${seed##*[![:space:]]}"}"
  if [[ "${#seed}" -lt 32 ]]; then
    echo "[auth] SECRET_SEED must be set and at least 32 characters long" >&2
    exit 1
  fi
}

resolve_source_version() {
  if git -C "${AGENT_GO_REPO_DIR}" rev-parse --verify HEAD >/dev/null 2>&1; then
    git -C "${AGENT_GO_REPO_DIR}" rev-parse HEAD
    return 0
  fi
  if [[ -n "${AGENT_IMAGE_VERSION:-}" ]]; then
    printf '%s' "${AGENT_IMAGE_VERSION}"
    return 0
  fi
  printf '%s' "unknown"
}

write_marker_file() {
  local name="${1:-}"
  local value="${2:-}"
  [[ -n "${name}" ]] || return 0
  mkdir -p "${UPGRADE_STATE_DIR}" 2>/dev/null || true
  printf '%s\n' "${value}" >"${UPGRADE_STATE_DIR}/${name}" 2>/dev/null || true
}

is_server_command() {
  if [[ "$#" -eq 0 ]]; then
    return 1
  fi
  local cmd="${1:-}"
  local cmd_base=""
  cmd_base="$(basename "${cmd}")"

  case "${cmd_base}" in
    agent-server|agent-server-*|agent-server-*.exe|agent-server.exe)
      return 0
      ;;
    agent-go|agent-go.exe)
      [[ "${2:-}" == "serve" ]]
      return
      ;;
    *)
      return 1
      ;;
  esac
}

install_runit_service() {
  local service_name="${1:-}"
  local service_script="${2:-}"
  local service_dir="${RUNITSV_SERVICE_DIR}/${service_name}"
  mkdir -p "${service_dir}"
  cat >"${service_dir}/run" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec "${service_script}"
EOF
  chmod +x "${service_dir}/run"
}

install_runit_command_service() {
  local service_name="${1:-}"
  shift || true
  local service_dir="${RUNITSV_SERVICE_DIR}/${service_name}"
  local quoted_cmd=""
  local arg=""

  mkdir -p "${service_dir}"
  for arg in "$@"; do
    if [[ -n "${quoted_cmd}" ]]; then
      quoted_cmd+=" "
    fi
    quoted_cmd+="$(printf '%q' "${arg}")"
  done

  cat >"${service_dir}/run" <<EOF
#!/usr/bin/env bash
set -euo pipefail
EOF

  if [[ "${service_name}" == "agent-server" ]] && [[ "${AGENT_SERVER_LOG_ENABLED}" == "1" ]]; then
    cat >>"${service_dir}/run" <<EOF
mkdir -p "\$(dirname -- "${AGENT_SERVER_LOG_FILE}")" 2>/dev/null || true
touch "${AGENT_SERVER_LOG_FILE}" 2>/dev/null || true
exec > >(tee -a "${AGENT_SERVER_LOG_FILE}") 2>&1
echo "[agent-runit] Starting agent-server service: ${quoted_cmd}"
EOF
  fi

  cat >>"${service_dir}/run" <<EOF
exec ${quoted_cmd}
EOF
  chmod +x "${service_dir}/run"
}

setup_runit_services() {
  local maybe_server_cmd=("$@")
  rm -rf "${RUNITSV_SERVICE_DIR}" 2>/dev/null || true
  mkdir -p "${RUNITSV_SERVICE_DIR}"

  if is_server_command "${maybe_server_cmd[@]}"; then
    install_runit_command_service "agent-server" "${maybe_server_cmd[@]}"
  fi

  if [[ "${AGENT_RUNTIME_MODE}" == "server" ]]; then
    return
  fi

  install_runit_service "ui-stack" "${AGENT_DOCKER_DIR}/runit/ui-stack.sh"

  if command -v openvscode-server >/dev/null 2>&1; then
    install_runit_service "openvscode-server" "${AGENT_DOCKER_DIR}/runit/openvscode-server.sh"
  fi

  if [[ "${OPENVSCODE_PROXY_ENABLED}" == "1" ]] \
    && [[ -x "${AGENT_SERVER_BIN}" ]]; then
    install_runit_service "openvscode-proxy" "${AGENT_DOCKER_DIR}/runit/openvscode-proxy.sh"
  fi

  if [[ "${DOCKERD_ENABLED}" == "1" ]] && command -v dockerd >/dev/null 2>&1; then
    install_runit_service "dockerd" "${AGENT_DOCKER_DIR}/runit/dockerd.sh"
  fi
}

restart_services() {
  if ! command -v sv >/dev/null 2>&1; then
    log "sv not found; skipping service restarts"
    return 0
  fi

  local dir=""
  while IFS= read -r -d '' dir; do
    log "restarting ${dir}"
    sv restart "${dir}" || true
  done < <(
    find "${RUNITSV_SERVICE_DIR}" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null \
      | sort -z
  )
}

sync_source_checkout() {
  if [[ ! -d "${AGENT_GO_REPO_DIR}" ]]; then
    log "repo dir not found: ${AGENT_GO_REPO_DIR}"
    exit 1
  fi
  if ! git -C "${AGENT_GO_REPO_DIR}" rev-parse --show-toplevel >/dev/null 2>&1; then
    log "git metadata missing in ${AGENT_GO_REPO_DIR}"
    exit 1
  fi

  local target="${TARGET_REF}"
  local branch=""
  local reset_target=""

  if [[ -n "${target}" ]]; then
    if git -C "${AGENT_GO_REPO_DIR}" rev-parse --verify -q "${target}^{commit}" >/dev/null 2>&1; then
      reset_target="${target}"
    else
      log "fetching target ${target}"
      git -C "${AGENT_GO_REPO_DIR}" fetch --depth=1 origin "${target}"
      if git -C "${AGENT_GO_REPO_DIR}" rev-parse --verify -q "origin/${target}^{commit}" >/dev/null 2>&1; then
        reset_target="origin/${target}"
      else
        reset_target="FETCH_HEAD"
      fi
    fi
  else
    branch="$(git -C "${AGENT_GO_REPO_DIR}" symbolic-ref --short -q HEAD || true)"
    if [[ -n "${branch}" ]]; then
      log "syncing branch ${branch} to origin/${branch}"
      git -C "${AGENT_GO_REPO_DIR}" fetch --depth=1 origin "${branch}"
      reset_target="origin/${branch}"
    else
      log "detached HEAD; syncing ${PULL_REF} from origin"
      git -C "${AGENT_GO_REPO_DIR}" fetch --depth=1 origin "${PULL_REF}"
      reset_target="origin/${PULL_REF}"
    fi
  fi

  git -C "${AGENT_GO_REPO_DIR}" reset --hard "${reset_target}"
  git -C "${AGENT_GO_REPO_DIR}" clean -fd
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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
      if [[ -z "${TARGET_REF}" ]]; then
        TARGET_REF="$1"
      else
        SERVICE_ARGS+=("$1")
      fi
      shift
      ;;
  esac
done

cd "${AGENT_GO_REPO_DIR}"

if [[ ${#SERVICE_ARGS[@]} -eq 0 ]]; then
  SERVICE_ARGS=("${AGENT_SERVER_BIN}" "serve")
fi

case "${AGENT_RUNTIME_MODE}" in
  all)
    ;;
  server)
    ;;
  *)
    echo "Invalid AGENT_RUNTIME_MODE: ${AGENT_RUNTIME_MODE} (expected: all | server)" >&2
    exit 1
    ;;
esac

if command -v flock >/dev/null 2>&1; then
  exec 9>"${LOCK_FILE}"
  flock 9
fi

sync_source_checkout
sync_installed_files
prepare_runtime_state
require_secret_seed

RUNITSV_ROOT="${ROOT_DIR}/runit"
RUNITSV_SERVICE_DIR="${RUNITSV_ROOT}/services"
setup_runit_services "${SERVICE_ARGS[@]}"
restart_services

source_version="$(resolve_source_version)"
write_marker_file "current_source_commit" "${source_version}"
write_marker_file "installed_commit" "${source_version}"
write_marker_file "running_commit" "${source_version}"

log "upgrade complete: ${source_version}"
