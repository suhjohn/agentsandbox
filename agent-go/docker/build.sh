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
UPGRADE_STATE_DIR="${ROOT_DIR}/upgrade-state"
IMAGE_HOOKS_DIR="${IMAGE_HOOKS_DIR:-/shared/image-hooks}"
IMAGE_BUILD_HOOK_PATH="${IMAGE_HOOKS_DIR}/build.sh"
PULL_REF="${AGENT_GO_PULL_REF:-main}"
LOCK_FILE="${AGENT_GO_PULL_LOCK_FILE:-/tmp/agent-go-pull.lock}"
TARGET_REF="${1:-}"

log() {
  printf '[agent-build] %s\n' "$*" >&2
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
  cp -a "${src}/." "${dst}/" 2>/dev/null || true
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

sync_source_checkout() {
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

run_sync_with_lock() {
  if command -v flock >/dev/null 2>&1; then
    exec 9>"${LOCK_FILE}"
    flock 9
  fi
  sync_source_checkout
}

cd "${AGENT_GO_REPO_DIR}"

prepare_runtime_state
run_sync_with_lock
sync_installed_files
prepare_runtime_state

log "running build sandbox convergence"
run_hook_file_if_present "${IMAGE_BUILD_HOOK_PATH}"

if [[ ! -x "${AGENT_SERVER_BIN}" ]]; then
  echo "[agent-build] binary missing: ${AGENT_SERVER_BIN}" >&2
  exit 1
fi
chmod +x "${AGENT_SERVER_BIN}"

source_version="$(resolve_source_version)"
write_marker_file "current_source_commit" "${source_version}"
write_marker_file "installed_commit" "${source_version}"

log "build sandbox convergence complete"
