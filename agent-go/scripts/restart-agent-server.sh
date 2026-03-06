#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
CALLER_DIR="$(pwd)"

OUTPUT_PATH="${MODULE_DIR}/build-artifacts/agent-server"
PID_FILE=""
LOG_FILE=""
MATCH_SUBSTRING=""
STOP_TIMEOUT_SEC=20
FORCE_KILL=0
DO_PULL=1
START_ARGS=()
RUNIT_SERVICE_DIR=""

usage() {
  cat <<'EOF'
Pull the latest agent-go source, rebuild the agent-server binary, and restart
the running server. When a runit-managed agent-server service is present, the
script restarts that service in place. Otherwise it falls back to replacing a
standalone process by PID or command match.

Usage:
  restart-agent-server.sh [options] [-- [agent-server args...]]

Options:
  --output PATH          Binary output path (default: ./agent-go/build-artifacts/agent-server)
  --pid-file PATH        PID file path (default: OUTPUT_PATH.pid)
  --log-file PATH        Log file path (default: OUTPUT_DIR/agent-server.log)
  --match STRING         Fixed command-line substring used to find the running process
                         (default: resolved output path)
  --service-dir PATH     Runit service dir to restart instead of PID replacement
                         (default: \$RUNITSV_SERVICE_DIR/agent-server or \$ROOT_DIR/runit/services/agent-server)
  --timeout SEC          Seconds to wait after SIGTERM before failing (default: 20)
  --force-kill           Send SIGKILL if the process does not exit after timeout
  --no-pull              Skip git pull
  --help, -h             Show this help

Examples:
  ./agent-go/scripts/restart-agent-server.sh
  ./agent-go/scripts/restart-agent-server.sh -- serve
  ./agent-go/scripts/restart-agent-server.sh --output ./agent-go/build-artifacts/agent-server -- serve
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT_PATH="$2"
      shift 2
      ;;
    --pid-file)
      PID_FILE="$2"
      shift 2
      ;;
    --log-file)
      LOG_FILE="$2"
      shift 2
      ;;
    --match)
      MATCH_SUBSTRING="$2"
      shift 2
      ;;
    --service-dir)
      RUNIT_SERVICE_DIR="$2"
      shift 2
      ;;
    --timeout)
      STOP_TIMEOUT_SEC="$2"
      shift 2
      ;;
    --force-kill)
      FORCE_KILL=1
      shift
      ;;
    --no-pull)
      DO_PULL=0
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      START_ARGS=("$@")
      break
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! [[ "${STOP_TIMEOUT_SEC}" =~ ^[0-9]+$ ]]; then
  echo "--timeout must be an integer number of seconds" >&2
  exit 1
fi

if [[ "${OUTPUT_PATH}" != /* ]]; then
  OUTPUT_PATH="${CALLER_DIR}/${OUTPUT_PATH}"
fi
mkdir -p "$(dirname -- "${OUTPUT_PATH}")"
OUTPUT_PATH="$(cd -- "$(dirname -- "${OUTPUT_PATH}")" && pwd)/$(basename -- "${OUTPUT_PATH}")"

if [[ -z "${PID_FILE}" ]]; then
  PID_FILE="${OUTPUT_PATH}.pid"
elif [[ "${PID_FILE}" != /* ]]; then
  PID_FILE="${CALLER_DIR}/${PID_FILE}"
fi
mkdir -p "$(dirname -- "${PID_FILE}")"
PID_FILE="$(cd -- "$(dirname -- "${PID_FILE}")" && pwd)/$(basename -- "${PID_FILE}")"

if [[ -z "${LOG_FILE}" ]]; then
  LOG_FILE="$(dirname -- "${OUTPUT_PATH}")/agent-server.log"
elif [[ "${LOG_FILE}" != /* ]]; then
  LOG_FILE="${CALLER_DIR}/${LOG_FILE}"
fi
mkdir -p "$(dirname -- "${LOG_FILE}")"
LOG_FILE="$(cd -- "$(dirname -- "${LOG_FILE}")" && pwd)/$(basename -- "${LOG_FILE}")"

if [[ ${#START_ARGS[@]} -eq 0 ]]; then
  START_ARGS=("serve")
fi

if [[ -z "${MATCH_SUBSTRING}" ]]; then
  MATCH_SUBSTRING="${OUTPUT_PATH}"
fi

if [[ -z "${RUNIT_SERVICE_DIR}" ]]; then
  if [[ -n "${RUNITSV_SERVICE_DIR:-}" ]]; then
    RUNIT_SERVICE_DIR="${RUNITSV_SERVICE_DIR}/agent-server"
  else
    root_dir="${ROOT_DIR:-/home/agent/runtime}"
    RUNIT_SERVICE_DIR="${root_dir}/runit/services/agent-server"
  fi
elif [[ "${RUNIT_SERVICE_DIR}" != /* ]]; then
  RUNIT_SERVICE_DIR="${CALLER_DIR}/${RUNIT_SERVICE_DIR}"
fi

find_running_pids() {
  ps -axo pid=,command= | awk -v needle="${MATCH_SUBSTRING}" '
    index($0, needle) { print $1 }
  '
}

find_existing_pid() {
  local pid=""
  local matches=""

  if [[ -f "${PID_FILE}" ]]; then
    pid="$(tr -cd '0-9' <"${PID_FILE}" | head -c 20 || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      printf '%s\n' "${pid}"
      return 0
    fi
  fi

  matches="$(find_running_pids)"
  matches="$(printf '%s\n' "${matches}" | sed '/^[[:space:]]*$/d' || true)"
  if [[ -z "${matches}" ]]; then
    return 0
  fi

  local count
  count="$(printf '%s\n' "${matches}" | wc -l | tr -d '[:space:]')"
  if [[ "${count}" != "1" ]]; then
    echo "matched multiple running processes for substring: ${MATCH_SUBSTRING}" >&2
    printf '%s\n' "${matches}" >&2
    exit 1
  fi

  printf '%s\n' "${matches}"
}

wait_for_exit() {
  local pid="$1"
  local waited=0
  while kill -0 "${pid}" 2>/dev/null; do
    if (( waited >= STOP_TIMEOUT_SEC * 10 )); then
      return 1
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  return 0
}

if [[ "${DO_PULL}" == "1" ]]; then
  git -C "${MODULE_DIR}" pull --ff-only
fi

"${MODULE_DIR}/scripts/build-agent-server.sh" --output "${OUTPUT_PATH}"

if [[ -d "${RUNIT_SERVICE_DIR}" ]] && command -v sv >/dev/null 2>&1; then
  echo "restarting runit service ${RUNIT_SERVICE_DIR}"
  sv restart "${RUNIT_SERVICE_DIR}"
  echo "service restarted"
  exit 0
fi

existing_pid="$(find_existing_pid || true)"
if [[ -n "${existing_pid}" ]]; then
  echo "stopping pid ${existing_pid}"
  kill -TERM "${existing_pid}"
  if ! wait_for_exit "${existing_pid}"; then
    if [[ "${FORCE_KILL}" != "1" ]]; then
      echo "process ${existing_pid} did not exit within ${STOP_TIMEOUT_SEC}s" >&2
      exit 1
    fi
    echo "force killing pid ${existing_pid}"
    kill -KILL "${existing_pid}"
    if ! wait_for_exit "${existing_pid}"; then
      echo "process ${existing_pid} did not exit after SIGKILL" >&2
      exit 1
    fi
  fi
fi

echo "starting ${OUTPUT_PATH} ${START_ARGS[*]}"
nohup "${OUTPUT_PATH}" "${START_ARGS[@]}" >>"${LOG_FILE}" 2>&1 < /dev/null &
new_pid="$!"
printf '%s\n' "${new_pid}" >"${PID_FILE}"
echo "started pid ${new_pid}"
echo "pid file: ${PID_FILE}"
echo "log file: ${LOG_FILE}"
