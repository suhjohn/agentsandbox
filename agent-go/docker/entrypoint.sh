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
RUNTIME_DIR="${ROOT_DIR}/runtime"
DATABASE_PATH="${DATABASE_PATH:-${ROOT_DIR}/app/agent.db}"

WORKSPACES_DIR="${WORKSPACES_DIR:-${AGENT_HOME}/workspaces}"
DEFAULT_WORKING_DIR="${DEFAULT_WORKING_DIR:-${WORKSPACES_DIR}}"

# Browser-specific state.
BROWSER_STATE_DIR="${ROOT_DIR}/browser"
CHROMIUM_USER_DATA_DIR="${BROWSER_STATE_DIR}/chromium"
VNC_PASSWD_FILE="${VNC_PASSWD_FILE:-${ROOT_DIR}/vnc/passwd}"
BROWSER_HOME_DIR="${BROWSER_STATE_DIR}/home"
BROWSER_XDG_CONFIG_HOME="${BROWSER_STATE_DIR}/xdg/config"
BROWSER_XDG_CACHE_HOME="${BROWSER_STATE_DIR}/xdg/cache"
BROWSER_XDG_DATA_HOME="${BROWSER_STATE_DIR}/xdg/data"
CHROMIUM_LOG_FILE="${ROOT_DIR}/logs/chromium.log"
OPENBOX_LOG_FILE="${ROOT_DIR}/logs/openbox.log"
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
CODEX_HOME="${CODEX_HOME:-${AGENT_HOME}/.codex}"
PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-${AGENT_HOME}/.pi}"
WORKSPACE_TOOLS_DIR="${WORKSPACES_DIR}/tools"
DOCKERD_ENABLED="${DOCKERD_ENABLED:-0}"
DOCKERD_LOG_FILE="${ROOT_DIR}/logs/dockerd.log"
DOCKERD_DATA_ROOT="${ROOT_DIR}/docker"
DOCKERD_BRIDGE="${DOCKERD_BRIDGE:-}"
DOCKERD_STORAGE_DRIVER="${DOCKERD_STORAGE_DRIVER:-}"
AGENT_SERVER_LOG_FILE="${AGENT_SERVER_LOG_FILE:-${ROOT_DIR}/logs/agent-server.log}"
AGENT_SERVER_LOG_ENABLED="${AGENT_SERVER_LOG_ENABLED:-1}"

CHROMIUM_PID_FILE="${ROOT_DIR}/run/chromium.pid"

XDG_CONFIG_HOME="${ROOT_DIR}/xdg/config"
XDG_CACHE_HOME="${ROOT_DIR}/xdg/cache"
XDG_DATA_HOME="${ROOT_DIR}/xdg/data"

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

OPENVSCODE_CONNECTION_TOKEN="$(resolve_secret_value OPENVSCODE_CONNECTION_TOKEN OPENVSCODE_CONNECTION_TOKEN_FILE)"
VNC_PASSWORD="$(resolve_secret_value VNC_PASSWORD VNC_PASSWORD_FILE)"

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

if [[ -z "${OPENVSCODE_CONNECTION_TOKEN}" ]]; then
  OPENVSCODE_CONNECTION_TOKEN="$(generate_random_secret 32)"
  echo "[auth] OPENVSCODE_CONNECTION_TOKEN was not set; generated an ephemeral token." >&2
fi

if [[ -z "${VNC_PASSWORD}" ]]; then
  VNC_PASSWORD="${OPENVSCODE_CONNECTION_TOKEN}"
  echo "[auth] VNC_PASSWORD was not set; reusing OPENVSCODE_CONNECTION_TOKEN." >&2
fi

case "${AGENT_RUNTIME_MODE}" in
  all)
    ;;
  server|server-only|server_only)
    AGENT_RUNTIME_MODE="server"
    ;;
  *)
    echo "Invalid AGENT_RUNTIME_MODE: ${AGENT_RUNTIME_MODE} (expected: all | server)" >&2
    exit 1
    ;;
esac

resolve_chromium_bin() {
  local candidate=""
  for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      printf '%s' "${candidate}"
      return 0
    fi
  done
  printf '%s' "chromium"
  return 0
}

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
export AGENT_IMAGE_VERSION
fi

export DISPLAY
export CODEX_HOME
export PI_CODING_AGENT_DIR
export ROOT_DIR
export DATABASE_PATH
export AGENT_ID
export AGENT_HOME
export WORKSPACES_DIR
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

cd /app

mkdir -p "${AGENT_HOME}" "${WORKSPACES_DIR}" "${DEFAULT_WORKING_DIR}" 2>/dev/null || true
mkdir -p "${ROOT_DIR}" 2>/dev/null || true

ensure_runtime_agents() {
  local tools_dir="${WORKSPACE_TOOLS_DIR_EFFECTIVE:-${WORKSPACE_TOOLS_DIR:-${WORKSPACES_DIR}/tools}}"
  if [[ ! -d "${tools_dir}" ]] && [[ -d /app/tools ]]; then
    tools_dir="/app/tools"
  fi

  local tool_readmes=""
  if [[ -d "${tools_dir}" ]]; then
    tool_readmes="$(
      find -L "${tools_dir}" \
        -type d \( -name node_modules -o -name .git -o -name dist -o -name build -o -name coverage \) -prune -o \
        -type f -name README.md -print 2>/dev/null \
      | sort || true
    )"
  fi

  local agents_file=""
  for agents_file in "${CODEX_HOME}/AGENTS.md" "${PI_CODING_AGENT_DIR}/AGENTS.md"; do
    : >"${agents_file}"
    cat <<EOF >>"${agents_file}"
# Environment
- You are running inside a sandbox container.
- Runtime state root: ${ROOT_DIR}
- Home/workspace root: ${AGENT_HOME}
- Agent identity: AGENT_ID=${AGENT_ID}
- Agent runtime dir: ${ROOT_DIR}
- Codex state dir: ${CODEX_HOME}
- PI state dir: ${PI_CODING_AGENT_DIR}
- Chromium is already running under Xvfb on display ${DISPLAY} at ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}.
- Remote debugging is enabled at ${CHROMIUM_REMOTE_DEBUG_ADDRESS}:${CHROMIUM_REMOTE_DEBUG_PORT} unless CHROMIUM_FLAGS overrides it.
- VNC server: 127.0.0.1:${VNC_PORT}; noVNC: 0.0.0.0:${NOVNC_PORT}.
- Browser profile directory: ${CHROMIUM_USER_DATA_DIR}.
- Working directory: ${AGENT_HOME}.
- Prefer reusing the existing browser rather than launching a new one.

# Tools (Workspace)
- Tools are synced from /app/tools into: ${tools_dir}
- If ${WORKSPACES_DIR}/tools is already occupied, tools may be exposed under: ${WORKSPACE_TOOLS_DIR_EFFECTIVE:-}
- Each tool directory should contain a README.md describing usage. Read it before invoking the tool.
EOF

    if [[ -n "${tool_readmes}" ]]; then
      echo "" >>"${agents_file}"
      echo "## Tool READMEs" >>"${agents_file}"
      while IFS= read -r p; do
        [[ -n "${p}" ]] || continue
        echo "- ${p}" >>"${agents_file}"
      done <<<"${tool_readmes}"
    fi
  done
}

ensure_codex_auth_json() {
  local auth_file="${CODEX_HOME}/auth.json"

  if [[ -f "${auth_file}" ]]; then
    return 0
  fi

  local openai_api_key="${OPENAI_API_KEY:-}"
  openai_api_key="${openai_api_key#"${openai_api_key%%[![:space:]]*}"}"
  openai_api_key="${openai_api_key%"${openai_api_key##*[![:space:]]}"}"
  if [[ -z "${openai_api_key}" ]]; then
    return 0
  fi

  mkdir -p "${CODEX_HOME}" 2>/dev/null || true

  local tmp="${auth_file}.tmp"
  rm -f "${tmp}" 2>/dev/null || true

  if command -v jq >/dev/null 2>&1; then
    jq -n --arg api_key "${openai_api_key}" \
      '{"auth_mode":"apikey","OPENAI_API_KEY":$api_key}' \
      >"${tmp}" 2>/dev/null || true
  elif command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY' >"${tmp}" 2>/dev/null || true
import json
import os

api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
print(json.dumps({"auth_mode": "apikey", "OPENAI_API_KEY": api_key}))
PY
  else
    printf '{"auth_mode":"apikey","OPENAI_API_KEY":"%s"}\n' "${openai_api_key}" \
      >"${tmp}" 2>/dev/null || true
  fi

  if [[ -s "${tmp}" ]]; then
    mv -f "${tmp}" "${auth_file}" 2>/dev/null || true
    chmod 600 "${auth_file}" 2>/dev/null || true
    echo "[auth] Seeded ${auth_file}." >&2
  else
    rm -f "${tmp}" 2>/dev/null || true
  fi
}

ensure_workspace_tools_link() {
  local tools_path="${WORKSPACES_DIR}/tools"
  local effective_tools_path="${WORKSPACES_DIR}/tools"
  local src_tools="/app/tools"

  [[ -d "${WORKSPACES_DIR}" ]] || return 0
  [[ -d "${src_tools}" ]] || return 0

  if [[ -L "${tools_path}" ]]; then
    local resolved=""
    resolved="$(readlink -f "${tools_path}" 2>/dev/null || true)"
    if [[ "${resolved}" == "${src_tools}" ]]; then
      export WORKSPACE_TOOLS_DIR_EFFECTIVE="${effective_tools_path}"
      return 0
    fi
    rm -f "${tools_path}" 2>/dev/null || true
  elif [[ -d "${tools_path}" ]]; then
    if find "${tools_path}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
      # Don't clobber user-owned tools dir; instead, expose agent tools in a per-agent location.
      effective_tools_path="${ROOT_DIR}/tools"
    else
      rmdir "${tools_path}" 2>/dev/null || true
    fi
  elif [[ -e "${tools_path}" ]]; then
    # Unexpected file at tools path; don't clobber it.
    effective_tools_path="${ROOT_DIR}/tools"
  fi

  mkdir -p "$(dirname "${effective_tools_path}")" 2>/dev/null || true
  ln -sfn "${src_tools}" "${effective_tools_path}"
  export WORKSPACE_TOOLS_DIR_EFFECTIVE="${effective_tools_path}"
}

seed_workspace_baseline_runtime() {
  local src="/opt/agent-image/workspace-baseline/sandbox"
  local dst="${RUNTIME_DIR}/workspace-baseline/sandbox"
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
    "${RUNTIME_DIR}" \
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
    "$(dirname "${VNC_PASSWD_FILE}")" \
    2>/dev/null || true

  ensure_workspace_tools_link
  seed_workspace_baseline_runtime
}

if [[ "${1:-}" == "init" ]] || [[ "${1:-}" == "--init" ]]; then
  shift || true
  prepare_runtime_state
  ensure_codex_auth_json
  ensure_runtime_agents
  exit 0
fi

prepare_runtime_state
ensure_codex_auth_json
ensure_runtime_agents

mkdir -p "${XDG_CONFIG_HOME}" "${XDG_CACHE_HOME}" "${XDG_DATA_HOME}" 2>/dev/null || true

require_secret_seed() {
  # The agent API expects sandbox auth to be enabled in all normal boot modes.
  # Fail fast here (before starting background services) if SECRET_SEED is missing.
  local seed="${SECRET_SEED:-}"
  # Trim leading/trailing whitespace without changing internal whitespace.
  seed="${seed#"${seed%%[![:space:]]*}"}"
  seed="${seed%"${seed##*[![:space:]]}"}"
  if [[ "${#seed}" -lt 32 ]]; then
    echo "[auth] SECRET_SEED must be set and at least 32 characters long" >&2
    exit 1
  fi
}

require_secret_seed

sync_app_to_local() {
  local local_app_dir="${ROOT_DIR}/app"
  local marker="${local_app_dir}/.copied-from-image-${AGENT_IMAGE_VERSION:-unknown}.ready"

  mkdir -p "${local_app_dir}"

  if [[ -f "${marker}" ]]; then
    if [[ -f "${local_app_dir}/agent-server" ]]; then
      chmod +x "${local_app_dir}/agent-server" 2>/dev/null || true
    fi
    cd "${local_app_dir}"
    return 0
  fi

  rm -rf "${local_app_dir}"/* 2>/dev/null || true

  # Copy app code from the image into the ephemeral local dir, excluding node_modules.
  (cd /app && tar --exclude='./node_modules' -cf - .) | (cd "${local_app_dir}" && tar -xf -)

  # Share the preinstalled node_modules from /app for speed and space.
  if [[ -d /app/node_modules ]]; then
    ln -sfn /app/node_modules "${local_app_dir}/node_modules"
  fi
  if [[ -f "${local_app_dir}/agent-server" ]]; then
    chmod +x "${local_app_dir}/agent-server" 2>/dev/null || true
  fi

  printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ) ${AGENT_IMAGE_VERSION:-unknown}" > "${marker}" 2>/dev/null || true
  cd "${local_app_dir}"
}

sync_app_to_local
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
export RUNTIME_DIR
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

is_server_command() {
  if [[ "$#" -eq 0 ]]; then
    return 1
  fi
  local cmd="${1:-}"
  local cmd_base=""
  cmd_base="$(basename "${cmd}")"
  [[ "${cmd_base}" == "agent-server" ]]
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

  install_runit_service "ui-stack" "/app/docker/runit/ui-stack.sh"

  if command -v openvscode-server >/dev/null 2>&1; then
    install_runit_service "openvscode-server" "/app/docker/runit/openvscode-server.sh"
  fi

  if [[ "${OPENVSCODE_PROXY_ENABLED}" == "1" ]] \
    && [[ -x "/app/agent-server" ]]; then
    install_runit_service "openvscode-proxy" "/app/docker/runit/openvscode-proxy.sh"
  fi

  if [[ "${DOCKERD_ENABLED}" == "1" ]] && command -v dockerd >/dev/null 2>&1; then
    install_runit_service "dockerd" "/app/docker/runit/dockerd.sh"
  fi
}

setup_runit_services "$@"

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
  echo "[agent-entrypoint] Capturing server stdout/stderr to ${AGENT_SERVER_LOG_FILE}"
}

if [[ "$#" -eq 0 ]]; then
  if ! has_runit_services; then
    echo "No runit services configured and no command provided." >&2
    exit 1
  fi
  exec runsvdir -P "${RUNITSV_SERVICE_DIR}"
fi

if is_server_command "$@"; then
  if ! has_runit_services; then
    echo "No runit services configured for server command." >&2
    exit 1
  fi
  exec runsvdir -P "${RUNITSV_SERVICE_DIR}"
fi

if has_runit_services; then
  runsvdir -P "${RUNITSV_SERVICE_DIR}" &
fi
setup_server_log_capture "$@"
exec "$@"
