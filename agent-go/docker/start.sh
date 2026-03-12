#!/usr/bin/env bash
set -euo pipefail

DISPLAY="${DISPLAY:-:99}"
SCREEN_WIDTH="${SCREEN_WIDTH:-1280}"
SCREEN_HEIGHT="${SCREEN_HEIGHT:-720}"
SCREEN_DEPTH="${SCREEN_DEPTH:-24}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
VNC_PORT="${VNC_PORT:-5900}"
BROWSER_START_URL="${BROWSER_START_URL:-https://www.google.com}"
CHROMIUM_BIN="${CHROMIUM_BIN:-}"
AGENT_HOME="${AGENT_HOME:-/home/agent}"
AGENT_ID="${AGENT_ID:-}"
if [[ -z "${AGENT_ID}" ]]; then
  echo "AGENT_ID is required" >&2
  exit 1
fi

ROOT_DIR="${ROOT_DIR:-${AGENT_HOME}/runtime}"
AGENT_GO_REPO_DIR="${AGENT_GO_REPO_DIR:-/opt/agentsandbox/agent-go}"
AGENT_DOCKER_DIR="${AGENT_DOCKER_DIR:-${AGENT_GO_REPO_DIR}/docker}"
AGENT_TOOLS_DIR="${AGENT_TOOLS_DIR:-${AGENT_GO_REPO_DIR}/tools}"
AGENT_SERVER_BIN="${AGENT_SERVER_BIN:-${AGENT_GO_REPO_DIR}/build-artifacts/agent-server-linux-amd64}"
DATABASE_PATH="${DATABASE_PATH:-${ROOT_DIR}/agent.db}"
WORKSPACES_DIR="${WORKSPACES_DIR:-${AGENT_HOME}/workspaces}"
WORKSPACE_TOOLS_DIR="${WORKSPACE_TOOLS_DIR:-${WORKSPACES_DIR}/tools}"
DEFAULT_WORKING_DIR="${DEFAULT_WORKING_DIR:-${WORKSPACES_DIR}}"
UPGRADE_STATE_DIR="${ROOT_DIR}/upgrade-state"

BROWSER_STATE_DIR="${BROWSER_STATE_DIR:-${ROOT_DIR}/browser}"
CHROMIUM_USER_DATA_DIR="${CHROMIUM_USER_DATA_DIR:-${BROWSER_STATE_DIR}/chromium}"
VNC_PASSWD_FILE="${VNC_PASSWD_FILE:-${ROOT_DIR}/vnc/passwd}"
BROWSER_HOME_DIR="${BROWSER_HOME_DIR:-${BROWSER_STATE_DIR}/home}"
BROWSER_XDG_CONFIG_HOME="${BROWSER_XDG_CONFIG_HOME:-${BROWSER_STATE_DIR}/xdg/config}"
BROWSER_XDG_CACHE_HOME="${BROWSER_XDG_CACHE_HOME:-${BROWSER_STATE_DIR}/xdg/cache}"
BROWSER_XDG_DATA_HOME="${BROWSER_XDG_DATA_HOME:-${BROWSER_STATE_DIR}/xdg/data}"
CHROMIUM_LOG_FILE="${CHROMIUM_LOG_FILE:-${ROOT_DIR}/logs/chromium.log}"
OPENBOX_LOG_FILE="${OPENBOX_LOG_FILE:-${ROOT_DIR}/logs/openbox.log}"
PROFILE_CHECKPOINT_ENABLED="${PROFILE_CHECKPOINT_ENABLED:-0}"
PROFILE_CHECKPOINT_INTERVAL_SEC="${PROFILE_CHECKPOINT_INTERVAL_SEC:-10}"
PROFILE_CHECKPOINT_KEEP="${PROFILE_CHECKPOINT_KEEP:-20}"
CHROMIUM_REMOTE_DEBUG_ADDRESS="${CHROMIUM_REMOTE_DEBUG_ADDRESS:-127.0.0.1}"
CHROMIUM_REMOTE_DEBUG_PORT="${CHROMIUM_REMOTE_DEBUG_PORT:-9222}"
CHROMIUM_NO_SANDBOX="${CHROMIUM_NO_SANDBOX:-}"
OPENVSCODE_SERVER_HOST="${OPENVSCODE_SERVER_HOST:-0.0.0.0}"
OPENVSCODE_SERVER_PORT="${OPENVSCODE_SERVER_PORT:-39393}"
OPENVSCODE_SERVER_WORKSPACE_DIR="${OPENVSCODE_SERVER_WORKSPACE_DIR:-${WORKSPACES_DIR}}"
OPENVSCODE_PROXY_ENABLED="${OPENVSCODE_PROXY_ENABLED:-1}"
OPENVSCODE_PROXY_HOST="${OPENVSCODE_PROXY_HOST:-${OPENVSCODE_SERVER_HOST}}"
OPENVSCODE_PROXY_PORT="${OPENVSCODE_PROXY_PORT:-${OPENVSCODE_SERVER_PORT}}"
OPENVSCODE_UPSTREAM_HOST="${OPENVSCODE_UPSTREAM_HOST:-127.0.0.1}"
OPENVSCODE_UPSTREAM_PORT="${OPENVSCODE_UPSTREAM_PORT:-39395}"
AGENT_RUNTIME_MODE="${AGENT_RUNTIME_MODE:-all}"
IMAGE_SHARED_DIR="${IMAGE_SHARED_DIR:-/shared/image}"
IMAGE_HOOKS_DIR="${IMAGE_HOOKS_DIR:-${IMAGE_SHARED_DIR}/hooks}"
CODEX_HOME="${CODEX_HOME:-${AGENT_HOME}/.codex}"
PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-${AGENT_HOME}/.pi}"
DOCKERD_ENABLED="${DOCKERD_ENABLED:-0}"
DOCKERD_LOG_FILE="${DOCKERD_LOG_FILE:-${ROOT_DIR}/logs/dockerd.log}"
DOCKERD_DATA_ROOT="${DOCKERD_DATA_ROOT:-${ROOT_DIR}/docker}"
DOCKERD_BRIDGE="${DOCKERD_BRIDGE:-}"
DOCKERD_STORAGE_DRIVER="${DOCKERD_STORAGE_DRIVER:-}"
AGENT_SERVER_LOG_FILE="${AGENT_SERVER_LOG_FILE:-${ROOT_DIR}/logs/agent-server.log}"
AGENT_SERVER_LOG_ENABLED="${AGENT_SERVER_LOG_ENABLED:-1}"
CHROMIUM_PID_FILE="${CHROMIUM_PID_FILE:-${ROOT_DIR}/run/chromium.pid}"
XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-${ROOT_DIR}/xdg/config}"
XDG_CACHE_HOME="${XDG_CACHE_HOME:-${ROOT_DIR}/xdg/cache}"
XDG_DATA_HOME="${XDG_DATA_HOME:-${ROOT_DIR}/xdg/data}"

log() {
  printf '[agent-start] %s\n' "$*" >&2
}

resolve_secret_value() {
  local value_var="${1:-}"
  local file_var="${2:-}"
  if [[ -z "${value_var}" ]]; then
    echo "resolve_secret_value requires a variable name" >&2
    exit 1
  fi
  if [[ -z "${file_var}" ]]; then
    file_var="${value_var}_FILE"
  fi

  local value="${!value_var:-}"
  local file_path="${!file_var:-}"

  if [[ -n "${value}" ]] && [[ -n "${file_path}" ]]; then
    echo "${value_var} and ${file_var} are both set; set only one" >&2
    exit 1
  fi
  if [[ -n "${file_path}" ]]; then
    if [[ ! -r "${file_path}" ]]; then
      echo "${file_var} points to unreadable file: ${file_path}" >&2
      exit 1
    fi
    value="$(cat "${file_path}")"
    value="${value%$'\n'}"
  fi
  printf '%s' "${value}"
}

generate_random_secret() {
  local nbytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    local generated=""
    generated="$(openssl rand -hex "${nbytes}" 2>/dev/null || true)"
    if [[ -n "${generated}" ]]; then
      printf '%s' "${generated}"
      return 0
    fi
  fi
  head -c "${nbytes}" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

resolve_chromium_bin() {
  local candidate=""
  for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      printf '%s' "${candidate}"
      return 0
    fi
  done
  printf '%s' "chromium"
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
  local bundled_tools_path=""
  local src_tools="${AGENT_TOOLS_DIR}"

  [[ -d "${src_tools}" ]] || return 0

  if [[ -L "${tools_path}" ]]; then
    local resolved=""
    resolved="$(readlink -f "${tools_path}" 2>/dev/null || true)"
    if [[ "${resolved}" == "${src_tools}" ]]; then
      rm -f "${tools_path}" 2>/dev/null || true
    fi
  fi

  if [[ -e "${tools_path}" ]] && [[ ! -d "${tools_path}" ]]; then
    tools_path="${ROOT_DIR}/tools"
    WORKSPACE_TOOLS_DIR="${tools_path}"
    export WORKSPACE_TOOLS_DIR
  fi

  bundled_tools_path="${tools_path}/default"
  mkdir -p "${tools_path}" "${bundled_tools_path}" 2>/dev/null || true

  local src_path=""
  while IFS= read -r -d '' src_path; do
    local name=""
    local target_path=""
    local resolved_target=""
    name="$(basename "${src_path}")"
    target_path="${bundled_tools_path}/${name}"

    if [[ -L "${target_path}" ]]; then
      resolved_target="$(readlink -f "${target_path}" 2>/dev/null || true)"
      if [[ "${resolved_target}" == "${src_path}" ]]; then
        continue
      fi
      rm -f "${target_path}" 2>/dev/null || true
    fi
    if [[ -e "${target_path}" ]]; then
      continue
    fi
    ln -s "${src_path}" "${target_path}"
  done < <(find "${src_tools}" -mindepth 1 -maxdepth 1 -print0)
}

seed_workspace_baseline_runtime() {
  local src="/opt/agent-image/workspace-baseline/sandbox"
  local dst="${ROOT_DIR}/workspace-baseline/sandbox"
  local seed_marker=""

  [[ -d "${src}" ]] || return 0

  if [[ -n "${AGENT_IMAGE_VERSION:-}" ]]; then
    seed_marker="${dst}/.seed-${AGENT_IMAGE_VERSION}.ready"
  else
    seed_marker="${dst}/.seed.ready"
  fi

  if [[ -d "${dst}" ]]; then
    if [[ -n "${seed_marker}" ]] && [[ -f "${seed_marker}" ]]; then
      return 0
    fi
    if find "${dst}" -maxdepth 1 -name "*.ready" -print -quit 2>/dev/null | grep -q .; then
      return 0
    fi
  fi

  mkdir -p "${dst}"
  cp -a "${src}/." "${dst}/" 2>/dev/null || true
  if [[ -n "${seed_marker}" ]]; then
    rm -f "${dst}"/.seed-*.ready 2>/dev/null || true
    printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ) ${AGENT_IMAGE_VERSION:-}" >"${seed_marker}" 2>/dev/null || true
  fi
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

run_hook_file_if_present() {
  local hook_path="${1:-}"
  if [[ -z "${hook_path}" ]] || [[ ! -r "${hook_path}" ]]; then
    return 0
  fi
  if [[ -x "${hook_path}" ]]; then
    bash "${hook_path}"
    return 0
  fi

  (
    staged_hook="$(mktemp)"
    trap 'rm -f "$staged_hook"' EXIT
    cp "${hook_path}" "${staged_hook}"
    chmod +x "${staged_hook}"
    bash "${staged_hook}"
  )
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
  [[ "${cmd_base}" == "agent-server" ]]
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

has_runit_services() {
  find "${RUNITSV_SERVICE_DIR}" -mindepth 1 -maxdepth 1 -type d -print -quit 2>/dev/null | grep -q .
}

setup_server_log_capture() {
  if [[ "${AGENT_SERVER_LOG_ENABLED}" != "1" ]]; then
    return
  fi
  if ! is_server_command "$@"; then
    return
  fi
  mkdir -p "$(dirname "${AGENT_SERVER_LOG_FILE}")" 2>/dev/null || true
  touch "${AGENT_SERVER_LOG_FILE}" 2>/dev/null || true
  exec > >(tee -a "${AGENT_SERVER_LOG_FILE}") 2>&1
  echo "[agent-start] Capturing server stdout/stderr to ${AGENT_SERVER_LOG_FILE}"
}

OPENVSCODE_CONNECTION_TOKEN="$(resolve_secret_value OPENVSCODE_CONNECTION_TOKEN OPENVSCODE_CONNECTION_TOKEN_FILE)"
VNC_PASSWORD="$(resolve_secret_value VNC_PASSWORD VNC_PASSWORD_FILE)"

if [[ -z "${OPENVSCODE_CONNECTION_TOKEN}" ]]; then
  OPENVSCODE_CONNECTION_TOKEN="$(generate_random_secret 32)"
  log "OPENVSCODE_CONNECTION_TOKEN was not set; generated an ephemeral token."
fi

if [[ -z "${VNC_PASSWORD}" ]]; then
  VNC_PASSWORD="${OPENVSCODE_CONNECTION_TOKEN}"
  log "VNC_PASSWORD was not set; reusing OPENVSCODE_CONNECTION_TOKEN."
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

if [[ -z "${CHROMIUM_BIN}" ]]; then
  CHROMIUM_BIN="$(resolve_chromium_bin)"
fi

if [[ "${CHROMIUM_BIN}" == */* ]]; then
  if [[ ! -x "${CHROMIUM_BIN}" ]]; then
    echo "Chromium binary not executable: ${CHROMIUM_BIN}" >&2
    exit 1
  fi
else
  if ! command -v "${CHROMIUM_BIN}" >/dev/null 2>&1; then
    echo "Chromium binary not found in PATH: ${CHROMIUM_BIN}" >&2
    exit 1
  fi
fi

if [[ -z "${AGENT_IMAGE_VERSION:-}" ]] && [[ -f /etc/agent-image-version ]]; then
  AGENT_IMAGE_VERSION="$(cat /etc/agent-image-version 2>/dev/null || true)"
fi
export AGENT_IMAGE_VERSION

export DISPLAY
export CODEX_HOME
export PI_CODING_AGENT_DIR
export ROOT_DIR
export DATABASE_PATH
export AGENT_ID
export AGENT_HOME
export WORKSPACES_DIR
export WORKSPACE_TOOLS_DIR
export DEFAULT_WORKING_DIR
export HOME="${AGENT_HOME}"
export XDG_CONFIG_HOME
export XDG_CACHE_HOME
export XDG_DATA_HOME
export BROWSER_STATE_DIR
export BROWSER_HOME_DIR
export BROWSER_XDG_CONFIG_HOME
export BROWSER_XDG_CACHE_HOME
export BROWSER_XDG_DATA_HOME
export CHROMIUM_BIN
export CHROMIUM_USER_DATA_DIR
export AGENT_GO_REPO_DIR
export AGENT_DOCKER_DIR
export AGENT_TOOLS_DIR
export AGENT_SERVER_BIN
export UPGRADE_STATE_DIR
export IMAGE_SHARED_DIR
export IMAGE_HOOKS_DIR

cd "${AGENT_GO_REPO_DIR}"

mkdir -p "${AGENT_HOME}" "${WORKSPACES_DIR}" "${DEFAULT_WORKING_DIR}" 2>/dev/null || true
mkdir -p "${ROOT_DIR}" 2>/dev/null || true

sync_installed_files
prepare_runtime_state
mkdir -p "${XDG_CONFIG_HOME}" "${XDG_CACHE_HOME}" "${XDG_DATA_HOME}" 2>/dev/null || true
require_secret_seed

hook_path="${IMAGE_HOOKS_DIR}/start.sh"
if [[ -r "${hook_path}" ]]; then
  log "running shared start hook..."
  run_hook_file_if_present "${hook_path}"
  log "shared start hook complete."
fi

export SCREEN_WIDTH
export SCREEN_HEIGHT
export SCREEN_DEPTH
export NOVNC_PORT
export VNC_PORT
export BROWSER_START_URL
export CHROMIUM_LOG_FILE
export OPENBOX_LOG_FILE
export PROFILE_CHECKPOINT_ENABLED
export PROFILE_CHECKPOINT_INTERVAL_SEC
export PROFILE_CHECKPOINT_KEEP
export CHROMIUM_REMOTE_DEBUG_ADDRESS
export CHROMIUM_REMOTE_DEBUG_PORT
export CHROMIUM_NO_SANDBOX
export CHROMIUM_PID_FILE
export VNC_PASSWD_FILE
export VNC_PASSWORD
export DOCKERD_ENABLED
export DOCKERD_LOG_FILE
export DOCKERD_DATA_ROOT
export DOCKERD_BRIDGE
export DOCKERD_STORAGE_DRIVER
export AGENT_SERVER_LOG_FILE
export AGENT_SERVER_LOG_ENABLED
export OPENVSCODE_SERVER_HOST
export OPENVSCODE_SERVER_PORT
export OPENVSCODE_SERVER_WORKSPACE_DIR
export OPENVSCODE_CONNECTION_TOKEN
export OPENVSCODE_PROXY_ENABLED
export OPENVSCODE_PROXY_HOST
export OPENVSCODE_PROXY_PORT
export OPENVSCODE_UPSTREAM_HOST
export OPENVSCODE_UPSTREAM_PORT
export AGENT_RUNTIME_MODE
export CHROMIUM_FLAGS="${CHROMIUM_FLAGS:-}"

if ! command -v runsvdir >/dev/null 2>&1; then
  echo "runsvdir not found; install runit in the image" >&2
  exit 1
fi

RUNITSV_ROOT="${ROOT_DIR}/runit"
RUNITSV_SERVICE_DIR="${RUNITSV_ROOT}/services"

if [[ "$#" -eq 0 ]]; then
  set -- "${AGENT_SERVER_BIN}" "serve"
fi

setup_runit_services "$@"

source_version="$(resolve_source_version)"
write_marker_file "current_source_commit" "${source_version}"
write_marker_file "installed_commit" "${source_version}"
write_marker_file "running_commit" "${source_version}"

if is_server_command "$@"; then
  exec runsvdir -P "${RUNITSV_SERVICE_DIR}"
fi

if has_runit_services; then
  runsvdir -P "${RUNITSV_SERVICE_DIR}" &
fi

setup_server_log_capture "$@"
exec "$@"
