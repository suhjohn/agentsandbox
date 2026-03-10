#!/usr/bin/env bash
set -euo pipefail

DISPLAY="${DISPLAY:-:99}"
SCREEN_WIDTH="${SCREEN_WIDTH:-1280}"
SCREEN_HEIGHT="${SCREEN_HEIGHT:-720}"
SCREEN_DEPTH="${SCREEN_DEPTH:-24}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
BROWSER_START_URL="${BROWSER_START_URL:-https://www.google.com}"
AGENT_HOME="${AGENT_HOME:-/home/agent}"
ROOT_DIR="${ROOT_DIR:-}"
if [[ -z "${ROOT_DIR}" ]]; then
  ROOT_DIR="${AGENT_HOME}/runtime"
fi

CHROMIUM_BIN="${CHROMIUM_BIN:-chromium}"
CHROMIUM_USER_DATA_DIR="${CHROMIUM_USER_DATA_DIR:-${ROOT_DIR}/browser/chromium}"
CHROMIUM_LOG_FILE="${CHROMIUM_LOG_FILE:-${ROOT_DIR}/logs/chromium.log}"
CHROMIUM_PID_FILE="${CHROMIUM_PID_FILE:-${ROOT_DIR}/run/chromium.pid}"
CHROMIUM_REMOTE_DEBUG_ADDRESS="${CHROMIUM_REMOTE_DEBUG_ADDRESS:-127.0.0.1}"
CHROMIUM_REMOTE_DEBUG_PORT="${CHROMIUM_REMOTE_DEBUG_PORT:-9222}"
CHROMIUM_NO_SANDBOX="${CHROMIUM_NO_SANDBOX:-1}"
CHROMIUM_FLAGS="${CHROMIUM_FLAGS:-}"

PROFILE_CHECKPOINT_ENABLED="${PROFILE_CHECKPOINT_ENABLED:-0}"
PROFILE_CHECKPOINT_INTERVAL_SEC="${PROFILE_CHECKPOINT_INTERVAL_SEC:-10}"
PROFILE_CHECKPOINT_KEEP="${PROFILE_CHECKPOINT_KEEP:-20}"
BROWSER_STATE_DIR="${BROWSER_STATE_DIR:-${ROOT_DIR}/browser}"
BROWSER_HOME_DIR="${BROWSER_HOME_DIR:-${BROWSER_STATE_DIR}/home}"
BROWSER_XDG_CONFIG_HOME="${BROWSER_XDG_CONFIG_HOME:-${BROWSER_STATE_DIR}/xdg/config}"
BROWSER_XDG_CACHE_HOME="${BROWSER_XDG_CACHE_HOME:-${BROWSER_STATE_DIR}/xdg/cache}"
BROWSER_XDG_DATA_HOME="${BROWSER_XDG_DATA_HOME:-${BROWSER_STATE_DIR}/xdg/data}"
OPENBOX_LOG_FILE="${OPENBOX_LOG_FILE:-${ROOT_DIR}/logs/openbox.log}"
VNC_PASSWD_FILE="${VNC_PASSWD_FILE:-${ROOT_DIR}/vnc/passwd}"

display_num="${DISPLAY#:}"

mkdir -p \
  "${CHROMIUM_USER_DATA_DIR}" \
  "${BROWSER_HOME_DIR}" \
  "${BROWSER_XDG_CONFIG_HOME}" \
  "${BROWSER_XDG_CACHE_HOME}" \
  "${BROWSER_XDG_DATA_HOME}" \
  "${BROWSER_STATE_DIR}" \
  "$(dirname "${CHROMIUM_LOG_FILE}")" \
  "$(dirname "${OPENBOX_LOG_FILE}")" \
  "$(dirname "${CHROMIUM_PID_FILE}")" \
  "$(dirname "${VNC_PASSWD_FILE}")" \
  2>/dev/null || true

if [[ -n "${BROWSER_XDG_CONFIG_HOME}" ]]; then mkdir -p "${BROWSER_XDG_CONFIG_HOME}"; fi
if [[ -n "${BROWSER_XDG_CACHE_HOME}" ]]; then mkdir -p "${BROWSER_XDG_CACHE_HOME}"; fi
if [[ -n "${BROWSER_XDG_DATA_HOME}" ]]; then mkdir -p "${BROWSER_XDG_DATA_HOME}"; fi

ensure_x11_socket_dir() {
  mkdir -p /tmp/.X11-unix
  chmod 1777 /tmp/.X11-unix
}

clear_stale_x_locks() {
  local lock_file="/tmp/.X${display_num}-lock"
  local socket_file="/tmp/.X11-unix/X${display_num}"

  if [[ -f "${lock_file}" ]]; then
    local lock_pid=""
    lock_pid="$(tr -cd '0-9' <"${lock_file}" 2>/dev/null | head -c 12 || true)"
    if [[ -n "${lock_pid}" ]] && kill -0 "${lock_pid}" 2>/dev/null; then
      local comm=""
      comm="$(ps -p "${lock_pid}" -o comm= 2>/dev/null | tr -d '[:space:]' || true)"
      if [[ "${comm}" == "Xvfb" ]] || [[ "${comm}" == "Xorg" ]] || [[ "${comm}" == "Xephyr" ]]; then
        return 1
      fi
    fi
    rm -f "${lock_file}" 2>/dev/null || true
  fi

  if [[ -e "${socket_file}" ]]; then
    rm -f "${socket_file}" 2>/dev/null || true
  fi

  return 0
}

start_xvfb() {
  local xvfb_log="${ROOT_DIR}/logs/xvfb.log"
  ensure_x11_socket_dir
  if ! clear_stale_x_locks; then
    for _ in {1..50}; do
      if [[ -S "/tmp/.X11-unix/X${display_num}" ]]; then
        return
      fi
      sleep 0.1
    done
    echo "X11 display ${DISPLAY} appears to be running but socket is missing" >&2
    exit 1
  fi

  : >"${xvfb_log}"
  Xvfb "${DISPLAY}" -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}" >"${xvfb_log}" 2>&1 &
  local xvfb_pid="$!"

  for _ in {1..50}; do
    if [[ -S "/tmp/.X11-unix/X${display_num}" ]] && kill -0 "${xvfb_pid}" 2>/dev/null; then
      return
    fi
    if ! kill -0 "${xvfb_pid}" 2>/dev/null; then
      echo "Xvfb failed to start (see ${xvfb_log}):" >&2
      tail -n 80 "${xvfb_log}" >&2 || true
      exit 1
    fi
    sleep 0.1
  done

  echo "Xvfb did not create X11 socket for display ${DISPLAY} (see ${xvfb_log})" >&2
  tail -n 80 "${xvfb_log}" >&2 || true
  exit 1
}

start_chromium_profile_checkpoint_loop() {
  if [[ "${PROFILE_CHECKPOINT_ENABLED}" != "1" ]]; then
    return
  fi
  if [[ -z "${BROWSER_STATE_DIR}" ]]; then
    return
  fi

  mkdir -p "${BROWSER_STATE_DIR}/profile-checkpoints"

  checkpoint_chromium_profile() {
    if [[ ! -d "${CHROMIUM_USER_DATA_DIR}/Default" ]]; then
      return 0
    fi

    local ts tmp dst
    ts="$(date -u +%Y%m%dT%H%M%SZ)"
    tmp="${BROWSER_STATE_DIR}/profile-checkpoints/.tmp-${ts}"
    dst="${BROWSER_STATE_DIR}/profile-checkpoints/${ts}"

    rm -rf "${tmp}" 2>/dev/null || true
    mkdir -p "${tmp}/Default" 2>/dev/null || true
    if [[ -f "${CHROMIUM_USER_DATA_DIR}/Local State" ]]; then
      cp -a "${CHROMIUM_USER_DATA_DIR}/Local State" "${tmp}/" 2>/dev/null || true
    fi
    if [[ -f "${CHROMIUM_USER_DATA_DIR}/Default/Preferences" ]]; then
      cp -a "${CHROMIUM_USER_DATA_DIR}/Default/Preferences" "${tmp}/Default/" 2>/dev/null || true
    fi
    if [[ -d "${CHROMIUM_USER_DATA_DIR}/Default/Sessions" ]]; then
      mkdir -p "${tmp}/Default/Sessions" 2>/dev/null || true
      cp -a "${CHROMIUM_USER_DATA_DIR}/Default/Sessions/." "${tmp}/Default/Sessions/" 2>/dev/null || true
    fi
    mv -f "${tmp}" "${dst}" 2>/dev/null || true
    return 0
  }

  (
    while true; do
      sleep "${PROFILE_CHECKPOINT_INTERVAL_SEC}" || true
      checkpoint_chromium_profile || true
      ls -1dt "${BROWSER_STATE_DIR}/profile-checkpoints/"* 2>/dev/null \
        | tail -n +"$((PROFILE_CHECKPOINT_KEEP + 1))" \
        | xargs -r rm -rf 2>/dev/null || true
    done
  ) >/dev/null 2>&1 &
}

clear_chromium_singleton_locks() {
  rm -rf \
    "${CHROMIUM_USER_DATA_DIR}/SingletonCookie" \
    "${CHROMIUM_USER_DATA_DIR}/SingletonLock" \
    "${CHROMIUM_USER_DATA_DIR}/SingletonSocket" \
    "${CHROMIUM_USER_DATA_DIR}"/modal-* \
    /tmp/org.chromium.Chromium.* \
    2>/dev/null || true
}

build_chromium_flags() {
  CHROMIUM_ARGS=(
    "--user-data-dir=${CHROMIUM_USER_DATA_DIR}"
    "--no-first-run"
    "--no-default-browser-check"
    "--disable-dev-shm-usage"
    "--disable-gpu"
    "--disable-features=Translate,CommandLineFlagSecurityWarnings"
    "--disable-infobars"
    "--hide-crash-restore-bubble"
    "--disable-session-crashed-bubble"
    "--password-store=basic"
    "--use-mock-keychain"
    "--window-size=${SCREEN_WIDTH},${SCREEN_HEIGHT}"
    "--start-maximized"
    "--restore-last-session"
  )

  if [[ "${CHROMIUM_NO_SANDBOX}" == "1" ]] || [[ "$(id -u)" == "0" ]]; then
    CHROMIUM_ARGS+=("--no-sandbox" "--test-type")
  fi

  if [[ -n "${CHROMIUM_REMOTE_DEBUG_PORT}" ]] && [[ "${CHROMIUM_FLAGS}" != *"--remote-debugging-port"* ]]; then
    CHROMIUM_ARGS+=(
      "--remote-debugging-address=${CHROMIUM_REMOTE_DEBUG_ADDRESS}"
      "--remote-debugging-port=${CHROMIUM_REMOTE_DEBUG_PORT}"
    )
  fi

  if [[ -n "${CHROMIUM_FLAGS}" ]]; then
    # shellcheck disable=SC2206
    CHROMIUM_ARGS+=(${CHROMIUM_FLAGS})
  fi
}

cleanup() {
  local exit_code="${1:-$?}"
  if [[ "${_UI_STACK_CLEANUP_RUNNING:-0}" == "1" ]]; then
    return "${exit_code}"
  fi
  _UI_STACK_CLEANUP_RUNNING=1
  trap - EXIT INT TERM

  if [[ -f "${CHROMIUM_PID_FILE}" ]]; then
    local chromium_pid=""
    chromium_pid="$(tr -cd '0-9' <"${CHROMIUM_PID_FILE}" 2>/dev/null | head -c 12 || true)"
    if [[ -n "${chromium_pid}" ]] && kill -0 "${chromium_pid}" 2>/dev/null; then
      kill -TERM "${chromium_pid}" 2>/dev/null || true
    fi
  fi

  local pids=""
  pids="$(jobs -pr 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    kill ${pids} >/dev/null 2>&1 || true
  fi

  rm -f "${CHROMIUM_PID_FILE}" 2>/dev/null || true
  return "${exit_code}"
}

trap cleanup EXIT
trap 'cleanup 143; exit 143' TERM
trap 'cleanup 130; exit 130' INT

start_xvfb

if command -v autocutsel >/dev/null 2>&1; then
  autocutsel -fork -selection CLIPBOARD >/dev/null 2>&1 || true
  autocutsel -fork -selection PRIMARY >/dev/null 2>&1 || true
fi

mkdir -p "$(dirname "${OPENBOX_LOG_FILE}")"
HOME="${BROWSER_HOME_DIR}" openbox >>"${OPENBOX_LOG_FILE}" 2>&1 &

if [[ -z "${VNC_PASSWORD:-}" ]]; then
  echo "VNC_PASSWORD is required" >&2
  exit 1
fi
x11vnc -storepasswd "${VNC_PASSWORD}" "${VNC_PASSWD_FILE}" >/dev/null
chmod 600 "${VNC_PASSWD_FILE}"
vnc_auth_args=("-rfbauth" "${VNC_PASSWD_FILE}")

x11vnc \
  -display "${DISPLAY}" \
  -rfbport "${VNC_PORT}" \
  -listen 127.0.0.1 \
  -forever \
  -shared \
  -xkb \
  -xrandr \
  "${vnc_auth_args[@]}" \
  >/dev/null 2>&1 &

NOVNC_PROXY="/usr/share/novnc/utils/novnc_proxy"
if [[ ! -x "${NOVNC_PROXY}" ]]; then
  echo "noVNC proxy not found at ${NOVNC_PROXY}" >&2
  exit 1
fi
"${NOVNC_PROXY}" --vnc "127.0.0.1:${VNC_PORT}" --listen "${NOVNC_PORT}" >/dev/null 2>&1 &

start_chromium_profile_checkpoint_loop
build_chromium_flags

while true; do
  clear_chromium_singleton_locks
  mkdir -p "$(dirname "${CHROMIUM_LOG_FILE}")"

  start_url_args=()
  if [[ ! -d "${CHROMIUM_USER_DATA_DIR}/Default" ]]; then
    start_url_args=("${BROWSER_START_URL}")
  fi

  rm -f "${CHROMIUM_PID_FILE}" 2>/dev/null || true
  chromium_env=( "HOME=${BROWSER_HOME_DIR}" )
  if [[ -n "${BROWSER_XDG_CONFIG_HOME}" ]]; then chromium_env+=( "XDG_CONFIG_HOME=${BROWSER_XDG_CONFIG_HOME}" ); fi
  if [[ -n "${BROWSER_XDG_CACHE_HOME}" ]]; then chromium_env+=( "XDG_CACHE_HOME=${BROWSER_XDG_CACHE_HOME}" ); fi
  if [[ -n "${BROWSER_XDG_DATA_HOME}" ]]; then chromium_env+=( "XDG_DATA_HOME=${BROWSER_XDG_DATA_HOME}" ); fi

  env "${chromium_env[@]}" "${CHROMIUM_BIN}" "${CHROMIUM_ARGS[@]}" "${start_url_args[@]}" >>"${CHROMIUM_LOG_FILE}" 2>&1 &
  chromium_pid="$!"
  printf '%s\n' "${chromium_pid}" >"${CHROMIUM_PID_FILE}" 2>/dev/null || true

  wait "${chromium_pid}" 2>/dev/null || true
  rm -f "${CHROMIUM_PID_FILE}" 2>/dev/null || true
  sleep 1
done
