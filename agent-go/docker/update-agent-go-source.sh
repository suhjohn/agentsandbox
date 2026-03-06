#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${AGENT_GO_REPO_DIR:-/opt/agentsandbox/agent-go}"
AUTO_PULL="${AGENT_GO_AUTO_PULL:-1}"
STRICT_PULL="${AGENT_GO_PULL_STRICT:-0}"
PULL_REF="${AGENT_GO_PULL_REF:-main}"
LOCK_FILE="${AGENT_GO_PULL_LOCK_FILE:-/tmp/agent-go-pull.lock}"

log() {
  printf '[agent-go-update] %s\n' "$*" >&2
}

run_update() {
  if [[ "${AUTO_PULL}" != "1" ]]; then
    return 0
  fi

  if [[ ! -d "${REPO_DIR}" ]]; then
    log "repo dir not found: ${REPO_DIR}; skipping update"
    return 0
  fi

  if ! git -C "${REPO_DIR}" rev-parse --show-toplevel >/dev/null 2>&1; then
    log "git metadata missing in ${REPO_DIR}; skipping update"
    return 0
  fi

  local branch=""
  branch="$(git -C "${REPO_DIR}" symbolic-ref --short -q HEAD || true)"
  if [[ -n "${branch}" ]]; then
    log "syncing branch ${branch} to origin/${branch}"
    git -C "${REPO_DIR}" fetch --depth=1 origin "${branch}"
    git -C "${REPO_DIR}" reset --hard "origin/${branch}"
    git -C "${REPO_DIR}" clean -fd
    return 0
  fi

  log "detached HEAD; syncing ${PULL_REF} from origin"
  git -C "${REPO_DIR}" fetch --depth=1 origin "${PULL_REF}"
  git -C "${REPO_DIR}" checkout -B "${PULL_REF}" "origin/${PULL_REF}"
  git -C "${REPO_DIR}" clean -fd
}

if command -v flock >/dev/null 2>&1; then
  exec 9>"${LOCK_FILE}"
  flock 9
fi

if ! run_update; then
  if [[ "${STRICT_PULL}" == "1" ]]; then
    log "source update failed with strict mode enabled"
    exit 1
  fi
  log "source update failed; continuing with current checkout"
fi
