#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

log() {
  printf '[agent-start] %s\n' "$*" >&2
}

resolve_secret_value() {
  local value_var="${1}"
  local file_var="${2:-${value_var}_FILE}"
  local value="${!value_var:-}"
  local file_path="${!file_var:-}"

  if [[ -n "${value}" && -n "${file_path}" ]]; then
    echo "${value_var} and ${file_var} are both set; set only one" >&2
    exit 1
  fi
  if [[ -n "${file_path}" ]]; then
    [[ -r "${file_path}" ]] || { echo "${file_var} points to unreadable file: ${file_path}" >&2; exit 1; }
    value="$(<"${file_path}")"
    value="${value%$'\n'}"
  fi

  printf '%s' "${value}"
}

generate_random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "${1:-32}" 2>/dev/null && return 0
  fi
  head -c "${1:-32}" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

require_secret_seed() {
  local seed="${SECRET_SEED:-}"
  seed="${seed#"${seed%%[![:space:]]*}"}"
  seed="${seed%"${seed##*[![:space:]]}"}"
  [[ "${#seed}" -ge 32 ]] || { echo "[auth] SECRET_SEED must be set and at least 32 characters long" >&2; exit 1; }
}

shell_quote_join() {
  local joined=""
  local arg=""
  for arg in "$@"; do
    [[ -n "${joined}" ]] && joined+=" "
    joined+="$(printf '%q' "${arg}")"
  done
  printf '%s' "${joined}"
}

OPENVSCODE_CONNECTION_TOKEN="$(resolve_secret_value OPENVSCODE_CONNECTION_TOKEN OPENVSCODE_CONNECTION_TOKEN_FILE)"
VNC_PASSWORD="$(resolve_secret_value VNC_PASSWORD VNC_PASSWORD_FILE)"

if [[ -z "${OPENVSCODE_CONNECTION_TOKEN}" ]]; then
  OPENVSCODE_CONNECTION_TOKEN="$(generate_random_secret 32)"
  log "generated OPENVSCODE_CONNECTION_TOKEN"
fi

if [[ -z "${VNC_PASSWORD}" ]]; then
  VNC_PASSWORD="${OPENVSCODE_CONNECTION_TOKEN}"
  log "reusing OPENVSCODE_CONNECTION_TOKEN for VNC_PASSWORD"
fi

export OPENVSCODE_CONNECTION_TOKEN
export VNC_PASSWORD

case "${AGENT_RUNTIME_MODE}" in
  all|server) ;;
  *) echo "Invalid AGENT_RUNTIME_MODE: ${AGENT_RUNTIME_MODE}" >&2; exit 1 ;;
esac

command -v supervisord >/dev/null 2>&1 || {
  echo "supervisord not found; run agent-go/docker/setup.sh during image build first" >&2
  exit 1
}

require_secret_seed

mkdir -p \
  "${AGENT_HOME}" \
  "${WORKSPACES_DIR}" \
  "${DEFAULT_WORKING_DIR}" \
  "${ROOT_DIR}/logs" \
  "${ROOT_DIR}/run" \
  "${ROOT_DIR}/supervisor" \
  "${XDG_CONFIG_HOME}" \
  "${XDG_CACHE_HOME}" \
  "${XDG_DATA_HOME}" \
  "$(dirname "${VNC_PASSWD_FILE}")"

if [[ -r "${IMAGE_HOOKS_DIR}/start.sh" ]]; then
  log "running shared start hook"
  bash "${IMAGE_HOOKS_DIR}/start.sh"
fi

cd "${AGENT_GO_REPO_DIR}"

if [[ "$#" -eq 0 ]]; then
  set -- "${AGENT_SERVER_BIN}" "serve"
fi

export AGENT_START_COMMAND
AGENT_START_COMMAND="$(shell_quote_join "$@")"

log "starting supervisord"
exec supervisord -n -c "${AGENT_DOCKER_DIR}/supervisord.conf"
