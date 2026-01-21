#!/usr/bin/env bash
set -euo pipefail

REAL_DOCKER="/usr/bin/docker"
if [[ ! -x "${REAL_DOCKER}" ]]; then
  REAL_DOCKER="$(command -v docker 2>/dev/null || true)"
fi
if [[ -z "${REAL_DOCKER}" ]] || [[ ! -x "${REAL_DOCKER}" ]]; then
  echo "[docker-wrapper] real docker binary not found" >&2
  exit 127
fi

force_host_network="${AGENT_DOCKER_FORCE_HOST_NETWORK:-0}"
if [[ "${force_host_network}" != "1" ]]; then
  exec "${REAL_DOCKER}" "$@"
fi

cmd="${1:-}"
shift || true

has_flag() {
  local needle="$1"
  shift || true
  local a
  for a in "$@"; do
    if [[ "${a}" == "${needle}" ]] || [[ "${a}" == "${needle}="* ]]; then
      return 0
    fi
  done
  return 1
}

exec_compose() {
  # docker compose v2 warns when a compose file includes the now-obsolete top-level `version` key.
  # It's harmless, but noisy; filter just that line by default.
  if [[ "${AGENT_DOCKER_SILENCE_COMPOSE_VERSION_WARN:-1}" == "1" ]]; then
    exec "${REAL_DOCKER}" compose "$@" 2> >(awk '!/attribute `version` is obsolete/' >&2)
  fi
  exec "${REAL_DOCKER}" compose "$@"
}

inject_build_network_host() {
  if has_flag "--network" "$@"; then
    exec "${REAL_DOCKER}" build "$@"
  fi
  exec "${REAL_DOCKER}" build --network=host "$@"
}

inject_run_network_host() {
  if has_flag "--network" "$@" || has_flag "--net" "$@"; then
    exec "${REAL_DOCKER}" run "$@"
  fi
  exec "${REAL_DOCKER}" run --network=host "$@"
}

compose_default_file_for_dir() {
  local dir="$1"
  local f
  for f in compose.yml compose.yaml docker-compose.yml docker-compose.yaml; do
    if [[ -f "${dir}/${f}" ]]; then
      printf '%s' "${dir}/${f}"
      return 0
    fi
  done
  return 1
}

compose_parse_options() {
  # Prints:
  #   - one line "SUBCMD=<subcmd>"
  #   - one line "OPTCOUNT=<n>"
  #   - then OPTCOUNT lines of options/args (already split)
  #   - one line "RESTCOUNT=<m>"
  #   - then RESTCOUNT lines of remaining args (already split)
  #
  # Also sets COMPOSE_PROJECT_DIR and COMPOSE_FILES in the parent scope via stdout parsing.
  local -a args=("$@")
  local -a opts=()
  local -a rest=()
  local subcmd=""
  local project_dir="."

  local i=0
  while [[ $i -lt ${#args[@]} ]]; do
    local a="${args[$i]}"

    if [[ "${a}" == "--project-directory" ]]; then
      opts+=("${a}")
      i=$((i + 1))
      if [[ $i -lt ${#args[@]} ]]; then
        opts+=("${args[$i]}")
        project_dir="${args[$i]}"
        i=$((i + 1))
        continue
      fi
      break
    fi
    if [[ "${a}" == --project-directory=* ]]; then
      opts+=("${a}")
      project_dir="${a#--project-directory=}"
      i=$((i + 1))
      continue
    fi

    if [[ "${a}" == "-f" ]] || [[ "${a}" == "--file" ]] || [[ "${a}" == "--env-file" ]] || [[ "${a}" == "-p" ]] || [[ "${a}" == "--project-name" ]] || [[ "${a}" == "--profile" ]]; then
      opts+=("${a}")
      i=$((i + 1))
      if [[ $i -lt ${#args[@]} ]]; then
        opts+=("${args[$i]}")
        i=$((i + 1))
        continue
      fi
      break
    fi
    if [[ "${a}" == --file=* ]] || [[ "${a}" == --env-file=* ]] || [[ "${a}" == --project-name=* ]] || [[ "${a}" == --profile=* ]]; then
      opts+=("${a}")
      i=$((i + 1))
      continue
    fi

    if [[ "${a}" == -* ]]; then
      # Flag without an argument.
      opts+=("${a}")
      i=$((i + 1))
      continue
    fi

    subcmd="${a}"
    i=$((i + 1))
    while [[ $i -lt ${#args[@]} ]]; do
      rest+=("${args[$i]}")
      i=$((i + 1))
    done
    break
  done

  echo "SUBCMD=${subcmd}"
  echo "PROJECT_DIR=${project_dir}"
  echo "OPTCOUNT=${#opts[@]}"
  local o
  for o in "${opts[@]}"; do echo "${o}"; done
  echo "RESTCOUNT=${#rest[@]}"
  local r
  for r in "${rest[@]}"; do echo "${r}"; done
}

compose_collect_files_from_opts() {
  local -a opts=("$@")
  local -a files=()
  local i=0
  while [[ $i -lt ${#opts[@]} ]]; do
    local a="${opts[$i]}"
    if [[ "${a}" == "-f" ]] || [[ "${a}" == "--file" ]]; then
      i=$((i + 1))
      if [[ $i -lt ${#opts[@]} ]]; then
        files+=("${opts[$i]}")
      fi
      i=$((i + 1))
      continue
    fi
    if [[ "${a}" == --file=* ]]; then
      files+=("${a#--file=}")
      i=$((i + 1))
      continue
    fi
    i=$((i + 1))
  done
  printf '%s\n' "${files[@]}"
}

compose_make_hostnet_override() {
  local override_path="$1"
  shift
  local -a compose_opts=("$@")

  local cfg_json=""
  cfg_json="$("${REAL_DOCKER}" compose "${compose_opts[@]}" config --format json 2>/dev/null || true)"
  if [[ -z "${cfg_json}" ]]; then
    return 1
  fi

  python3 - <<'PY' "${override_path}" <<<"${cfg_json}"
import json
import sys
from pathlib import Path

override_path = Path(sys.argv[1])
config = json.load(sys.stdin)
services = config.get("services") or {}
names = [str(n) for n in services.keys() if n]
names_sorted = sorted(names)

def q(s: str) -> str:
  return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'

lines = []
lines.append("services:")
for name in names_sorted:
  lines.append(f"  {name}:")
  lines.append("    network_mode: host")
  lines.append("    networks: []")
  lines.append("    ports: []")
  lines.append("    extra_hosts:")
  for host in names_sorted:
    lines.append(f"      - {q(host + ':127.0.0.1')}")

override_path.parent.mkdir(parents=True, exist_ok=True)
override_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
  return 0
}

compose_exec_with_hostnet() {
  local -a raw=("$@")

  local parsed
  parsed="$(compose_parse_options "${raw[@]}")"

  local subcmd="" project_dir="."
  local optcount=0 restcount=0
  subcmd="$(printf '%s\n' "${parsed}" | awk -F= '/^SUBCMD=/ {print $2}' | head -n 1)"
  project_dir="$(printf '%s\n' "${parsed}" | awk -F= '/^PROJECT_DIR=/ {print $2}' | head -n 1)"
  optcount="$(printf '%s\n' "${parsed}" | awk -F= '/^OPTCOUNT=/ {print $2}' | head -n 1)"
  restcount="$(printf '%s\n' "${parsed}" | awk -F= '/^RESTCOUNT=/ {print $2}' | head -n 1)"

  if [[ -z "${subcmd}" ]]; then
    exec_compose "${raw[@]}"
  fi

  # Re-hydrate opts/rest arrays from the parsed output.
  local -a opts=()
  local -a rest=()
  local line_no=0
  while IFS= read -r line; do
    line_no=$((line_no + 1))
    if (( line_no <= 3 )); then
      continue
    fi
    if (( ${#opts[@]} < optcount )); then
      opts+=("${line}")
      continue
    fi
    if [[ "${line}" == "RESTCOUNT="* ]]; then
      continue
    fi
    if (( ${#rest[@]} < restcount )); then
      rest+=("${line}")
      continue
    fi
  done <<<"$(printf '%s\n' "${parsed}")"

  local -a files=()
  while IFS= read -r f; do
    [[ -n "${f}" ]] || continue
    files+=("${f}")
  done < <(compose_collect_files_from_opts "${opts[@]}")

  if [[ ${#files[@]} -eq 0 ]]; then
    local default_file=""
    default_file="$(compose_default_file_for_dir "${project_dir}" || true)"
    if [[ -n "${default_file}" ]]; then
      opts+=("-f" "${default_file}")
      files+=("${default_file}")
    fi
  fi

  if [[ ${#files[@]} -eq 0 ]]; then
    exec_compose "${raw[@]}"
  fi

  local override="/tmp/agent-compose-hostnet-override.$(printf '%s' "${project_dir}" | sha256sum | awk '{print $1}').yml"
  if ! compose_make_hostnet_override "${override}" "${opts[@]}"; then
    exec_compose "${raw[@]}"
  fi

  # Insert the override as an additional compose file.
  opts+=("-f" "${override}")
  exec_compose "${opts[@]}" "${subcmd}" "${rest[@]}"
}

case "${cmd}" in
  build)
    inject_build_network_host "$@"
    ;;
  run)
    inject_run_network_host "$@"
    ;;
  compose)
    compose_exec_with_hostnet "$@"
    ;;
  *)
    exec "${REAL_DOCKER}" "${cmd}" "$@"
    ;;
esac
