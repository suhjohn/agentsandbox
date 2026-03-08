#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd -- "${MODULE_DIR}/.." && pwd)"
CALLER_DIR="$(pwd)"

GO_BIN="${GO:-go}"
DOCKER_BIN="${DOCKER:-docker}"
DOCKER_IMAGE="${DOCKER_IMAGE:-agent-go:dev}"
DOCKER_CONTAINER="${DOCKER_CONTAINER:-agent-go-dev}"
ENV_FILE_DEFAULT="${ENV_FILE:-.env}"

usage() {
  cat <<'EOF'
Manage local agent-go build, restart, Docker, and image publishing flows.

Usage:
  dev.sh build-server [--output PATH] [--goos OS] [--goarch ARCH]
  dev.sh restart-server [--output PATH] [--service-dir PATH] [--match STRING] [--timeout SEC] [--force-kill] [--no-pull] [-- [agent-server args...]]
  dev.sh docker-build
  dev.sh docker-run [--env-file PATH] [--server-only]
  dev.sh docker-refresh [--env-file PATH] [--server-only] [--no-pull]
  dev.sh docker-stop
  dev.sh ghcr-push-amd64
EOF
}

die() {
  echo "$*" >&2
  exit 1
}

abs_path() {
  local path="$1"
  if [[ "${path}" != /* ]]; then
    path="${CALLER_DIR}/${path}"
  fi
  local dir
  dir="$(cd -- "$(dirname -- "${path}")" && pwd)"
  printf '%s/%s\n' "${dir}" "$(basename -- "${path}")"
}

build_server_binary() {
  local output_path="$1"
  local goos_value="$2"
  local goarch_value="$3"
  local cgo_enabled_value="$4"
  local ldflags_value="$5"

  mkdir -p "$(dirname -- "${output_path}")"
  (
    cd "${MODULE_DIR}"
    CGO_ENABLED="${cgo_enabled_value}" \
    GOOS="${goos_value}" \
    GOARCH="${goarch_value}" \
    "${GO_BIN}" build -trimpath -ldflags="${ldflags_value}" -o "${output_path}" ./cmd/agent-go
  )
  chmod +x "${output_path}"
  echo "built ${output_path}"
}

cmd_build_server() {
  local goos_value="${GOOS:-linux}"
  local goarch_value="${GOARCH:-$("${GO_BIN}" env GOARCH)}"
  local cgo_enabled_value="${CGO_ENABLED:-0}"
  local ldflags_value="${LDFLAGS:--s -w}"
  local output_path=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --output)
        output_path="$2"
        shift 2
        ;;
      --goos)
        goos_value="$2"
        shift 2
        ;;
      --goarch)
        goarch_value="$2"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "unknown argument for build-server: $1"
        ;;
    esac
  done

  if [[ -z "${output_path}" ]]; then
    output_path="${MODULE_DIR}/build-artifacts/agent-server-${goos_value}-${goarch_value}"
  fi

  build_server_binary "$(abs_path "${output_path}")" "${goos_value}" "${goarch_value}" "${cgo_enabled_value}" "${ldflags_value}"
}

find_running_pids() {
  local needle="$1"
  ps -axo pid=,command= | awk -v needle="${needle}" '
    index($0, needle) { print $1 }
  '
}

wait_for_exit() {
  local pid="$1"
  local timeout_sec="$2"
  local waited=0
  while kill -0 "${pid}" 2>/dev/null; do
    if (( waited >= timeout_sec * 10 )); then
      return 1
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
}

cmd_restart_server() {
  local output_path="${MODULE_DIR}/build-artifacts/agent-server"
  local match_substring=""
  local stop_timeout_sec=20
  local force_kill=0
  local do_pull=1
  local service_dir=""
  local start_args=()
  local log_file=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --output)
        output_path="$2"
        shift 2
        ;;
      --match)
        match_substring="$2"
        shift 2
        ;;
      --service-dir)
        service_dir="$2"
        shift 2
        ;;
      --timeout)
        stop_timeout_sec="$2"
        shift 2
        ;;
      --force-kill)
        force_kill=1
        shift
        ;;
      --no-pull)
        do_pull=0
        shift
        ;;
      --)
        shift
        start_args=("$@")
        break
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "unknown argument for restart-server: $1"
        ;;
    esac
  done

  [[ "${stop_timeout_sec}" =~ ^[0-9]+$ ]] || die "--timeout must be an integer number of seconds"

  output_path="$(abs_path "${output_path}")"
  if [[ -z "${match_substring}" ]]; then
    match_substring="${output_path}"
  fi
  if [[ -z "${service_dir}" ]]; then
    if [[ -n "${RUNITSV_SERVICE_DIR:-}" ]]; then
      service_dir="${RUNITSV_SERVICE_DIR}/agent-server"
    else
      service_dir="${ROOT_DIR:-/home/agent/runtime}/runit/services/agent-server"
    fi
  else
    service_dir="$(abs_path "${service_dir}")"
  fi
  if [[ ${#start_args[@]} -eq 0 ]]; then
    start_args=("serve")
  fi

  if [[ "${do_pull}" == "1" ]]; then
    git -C "${REPO_ROOT}" pull --ff-only
  fi

  build_server_binary "${output_path}" "${GOOS:-linux}" "${GOARCH:-$("${GO_BIN}" env GOARCH)}" "${CGO_ENABLED:-0}" "${LDFLAGS:--s -w}"

  if [[ -d "${service_dir}" ]] && command -v sv >/dev/null 2>&1; then
    echo "restarting runit service ${service_dir}"
    sv restart "${service_dir}"
    echo "service restarted"
    return 0
  fi

  local matches
  matches="$(find_running_pids "${match_substring}" | sed '/^[[:space:]]*$/d' || true)"
  if [[ -n "${matches}" ]]; then
    local count
    count="$(printf '%s\n' "${matches}" | wc -l | tr -d '[:space:]')"
    [[ "${count}" == "1" ]] || die "matched multiple running processes for substring: ${match_substring}"

    local existing_pid
    existing_pid="$(printf '%s\n' "${matches}")"
    echo "stopping pid ${existing_pid}"
    kill -TERM "${existing_pid}"
    if ! wait_for_exit "${existing_pid}" "${stop_timeout_sec}"; then
      if [[ "${force_kill}" != "1" ]]; then
        die "process ${existing_pid} did not exit within ${stop_timeout_sec}s"
      fi
      echo "force killing pid ${existing_pid}"
      kill -KILL "${existing_pid}"
      wait_for_exit "${existing_pid}" "${stop_timeout_sec}" || die "process ${existing_pid} did not exit after SIGKILL"
    fi
  fi

  log_file="$(dirname -- "${output_path}")/agent-server.log"
  echo "starting ${output_path} ${start_args[*]}"
  nohup "${output_path}" "${start_args[@]}" >>"${log_file}" 2>&1 < /dev/null &
  echo "started pid $!"
  echo "log file: ${log_file}"
}

docker_run_args() {
  local env_file="$1"
  local server_only="$2"

  local args=(
    run --rm -it --name "${DOCKER_CONTAINER}"
    --env-file "${env_file}"
    -p 3131:3131
  )

  if [[ "${server_only}" == "1" ]]; then
    args+=(-e AGENT_RUNTIME_MODE=server)
  else
    args+=(
      -p 39393:39393
      -p 6080:6080
      -p 5900:5900
    )
  fi

  args+=("${DOCKER_IMAGE}")
  printf '%s\0' "${args[@]}"
}

parse_docker_mode_args() {
  local env_file="${ENV_FILE_DEFAULT}"
  local server_only=0
  local do_pull=1

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env-file)
        env_file="$2"
        shift 2
        ;;
      --server-only)
        server_only=1
        shift
        ;;
      --no-pull)
        do_pull=0
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "unknown Docker argument: $1"
        ;;
    esac
  done

  env_file="$(abs_path "${env_file}")"
  [[ -f "${env_file}" ]] || die "missing env file: ${env_file}"

  printf '%s\n%s\n%s\n' "${env_file}" "${server_only}" "${do_pull}"
}

cmd_docker_build() {
  "${DOCKER_BIN}" build -f "${MODULE_DIR}/Dockerfile" -t "${DOCKER_IMAGE}" "${REPO_ROOT}"
}

cmd_docker_run() {
  mapfile -t parsed < <(parse_docker_mode_args "$@")
  local env_file="${parsed[0]}"
  local server_only="${parsed[1]}"

  local args=()
  while IFS= read -r -d '' item; do
    args+=("${item}")
  done < <(docker_run_args "${env_file}" "${server_only}")

  exec "${DOCKER_BIN}" "${args[@]}"
}

cmd_docker_refresh() {
  mapfile -t parsed < <(parse_docker_mode_args "$@")
  local env_file="${parsed[0]}"
  local server_only="${parsed[1]}"
  local do_pull="${parsed[2]}"

  if [[ "${do_pull}" == "1" ]]; then
    git -C "${REPO_ROOT}" pull --ff-only
  fi

  "${DOCKER_BIN}" rm -f "${DOCKER_CONTAINER}" >/dev/null 2>&1 || true
  cmd_docker_build

  local args=()
  while IFS= read -r -d '' item; do
    args+=("${item}")
  done < <(docker_run_args "${env_file}" "${server_only}")

  exec "${DOCKER_BIN}" "${args[@]}"
}

cmd_docker_stop() {
  "${DOCKER_BIN}" rm -f "${DOCKER_CONTAINER}" >/dev/null 2>&1 || true
}

cmd_ghcr_push_amd64() {
  local docker_cmd=("${DOCKER_BIN}")

  if [[ -n "${DOCKER_CONTEXT:-}" ]]; then
    docker_cmd=("${DOCKER_BIN}" --context "${DOCKER_CONTEXT}")
    unset DOCKER_HOST || true
  fi

  "${docker_cmd[@]}" info >/dev/null 2>&1 || die "Docker daemon is not reachable."

  local image="${GHCR_IMAGE:-}"
  if [[ -z "${image}" ]]; then
    if [[ -n "${GITHUB_USERNAME:-}" ]]; then
      image="ghcr.io/${GITHUB_USERNAME}/agent"
    else
      image="ghcr.io/suhjohn/agent"
    fi
  fi
  image="${image%/}"

  local tag="${GHCR_TAG:-}"
  if [[ -z "${tag}" ]]; then
    tag="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || true)"
    tag="${tag:-latest}"
  fi

  local build_version="${tag}"
  local sha
  sha="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || true)"
  if [[ -n "${sha}" ]]; then
    if [[ -n "$(git -C "${REPO_ROOT}" status --porcelain=v1 2>/dev/null || true)" ]]; then
      build_version="${sha}-dirty"
    else
      build_version="${sha}"
    fi
  fi

  local tags=("${image}:${tag}")
  if [[ "${GHCR_PUSH_LATEST:-1}" != "0" && "${tag}" != "latest" ]]; then
    tags+=("${image}:latest")
  fi

  if [[ -n "${GHCR_TOKEN:-}" && -n "${GITHUB_USERNAME:-}" ]]; then
    printf '%s' "${GHCR_TOKEN}" | "${DOCKER_BIN}" login ghcr.io -u "${GITHUB_USERNAME}" --password-stdin
  elif [[ -n "${GHCR_TOKEN:-}" || -n "${GITHUB_USERNAME:-}" ]]; then
    die "Set both GHCR_TOKEN and GITHUB_USERNAME, or neither if already logged in."
  fi

  local tag_args=()
  local t
  for t in "${tags[@]}"; do
    tag_args+=(-t "${t}")
  done

  "${docker_cmd[@]}" buildx build \
    --platform linux/amd64 \
    --push \
    --build-arg "AGENT_IMAGE_VERSION=${build_version}" \
    -f "${MODULE_DIR}/Dockerfile" \
    "${tag_args[@]}" \
    "${REPO_ROOT}"

  echo "Pushed ${tags[*]} (linux/amd64)"
}

command="${1:-}"
[[ -n "${command}" ]] || {
  usage
  exit 1
}
shift || true

case "${command}" in
  build-server)
    cmd_build_server "$@"
    ;;
  restart-server)
    cmd_restart_server "$@"
    ;;
  docker-build)
    cmd_docker_build "$@"
    ;;
  docker-run)
    cmd_docker_run "$@"
    ;;
  docker-refresh)
    cmd_docker_refresh "$@"
    ;;
  docker-stop)
    cmd_docker_stop "$@"
    ;;
  ghcr-push-amd64)
    cmd_ghcr_push_amd64 "$@"
    ;;
  --help|-h|help)
    usage
    ;;
  *)
    die "unknown command: ${command}"
    ;;
esac
