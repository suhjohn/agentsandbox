# agent-go/docker/setup.sh
# Note to future: for any installation that needs to be done, also do it in the agent-go/Dockerfile.
# We basically want any installation of programs to be doubly-bound between Dockerfile and this setup.sh script.

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

log() {
  printf '[agent-setup] %s\n' "$*" >&2
}

APT_UPDATED=0
REPO_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
AGENT_REPO_DIR="${AGENT_REPO_DIR:-${REPO_DIR}}"
SKIP_APT_PACKAGES="${AGENT_SETUP_SKIP_APT_PACKAGES:-0}"

should_skip_apt_packages() {
  [[ "${SKIP_APT_PACKAGES}" == "1" ]]
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "setup.sh must run as root" >&2
    exit 1
  fi
}

apt_update_once() {
  if [[ "${APT_UPDATED}" == "1" ]]; then
    return
  fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  APT_UPDATED=1
}

invalidate_apt_update() {
  APT_UPDATED=0
}

apt_install() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y --no-install-recommends "$@"
}

install_bootstrap_packages() {
  local marker="${SETUP_STATE_DIR}/bootstrap-packages.ready"
  if [[ -f "${marker}" ]] && command -v curl >/dev/null 2>&1 && command -v gpg >/dev/null 2>&1; then
    return
  fi

  if should_skip_apt_packages && command -v curl >/dev/null 2>&1 && command -v gpg >/dev/null 2>&1; then
    log "skipping bootstrap package installation"
    touch "${marker}"
    return
  fi

  log "installing bootstrap packages"
  apt_update_once
  apt_install \
    ca-certificates \
    curl \
    gnupg

  touch "${marker}"
}

ensure_agent_user() {
  local agent_gid=""

  if getent group agent >/dev/null 2>&1; then
    agent_gid="$(getent group agent | cut -d: -f3)"
  elif getent group 1000 >/dev/null 2>&1; then
    groupadd agent
    agent_gid="$(getent group agent | cut -d: -f3)"
  else
    groupadd --gid 1000 agent
    agent_gid="1000"
  fi

  if ! id -u agent >/dev/null 2>&1; then
    if getent passwd 1000 >/dev/null 2>&1; then
      useradd --gid "${agent_gid}" --home-dir "${AGENT_HOME}" --shell /bin/bash agent
    else
      useradd --uid 1000 --gid "${agent_gid}" --home-dir "${AGENT_HOME}" --shell /bin/bash agent
    fi
  fi

  mkdir -p "${AGENT_HOME}" "${WORKSPACES_DIR}" /tmp/.X11-unix /etc/apt/keyrings
  chown -R agent:agent "${AGENT_HOME}"
  chmod 0777 "${WORKSPACES_DIR}"
  chmod 1777 /tmp/.X11-unix
}

install_base_packages() {
  local marker="${SETUP_STATE_DIR}/base-packages.ready"
  if [[ -f "${marker}" ]] \
    && command -v supervisord >/dev/null 2>&1 \
    && command -v git >/dev/null 2>&1; then
    return
  fi

  if should_skip_apt_packages \
    && command -v supervisord >/dev/null 2>&1 \
    && command -v git >/dev/null 2>&1; then
    log "skipping base package installation"
    ln -sfn /usr/bin/fdfind /usr/local/bin/fd
    touch "${marker}"
    return
  fi

  log "installing base packages"
  apt_update_once
  apt_install \
    autocutsel \
    apt-utils \
    dumb-init \
    fd-find \
    fonts-dejavu-core \
    fonts-liberation \
    git \
    iproute2 \
    iptables \
    jq \
    openbox \
    openssh-client \
    openssh-server \
    procps \
    python-is-python3 \
    python3 \
    ripgrep \
    supervisor \
    tar \
    vim \
    websockify \
    novnc \
    x11vnc \
    xvfb

  ln -sfn /usr/bin/fdfind /usr/local/bin/fd
  touch "${marker}"
}

configure_package_repos() {
  local marker="${SETUP_STATE_DIR}/apt-repos.ready"
  if [[ -f "${marker}" ]]; then
    return
  fi

  local arch=""
  arch="$(dpkg --print-architecture)"

  if should_skip_apt_packages; then
    local browser_repo_ready="0"
    if [[ "${arch}" == "amd64" ]]; then
      if [[ -f /etc/apt/keyrings/google-chrome.gpg ]] && [[ -f /etc/apt/sources.list.d/google-chrome.list ]]; then
        browser_repo_ready="1"
      fi
    elif [[ -f /etc/apt/keyrings/debian-archive.gpg ]] \
      && [[ -f /etc/apt/sources.list.d/debian-bookworm-chromium.list ]] \
      && [[ -f /etc/apt/preferences.d/debian-bookworm-chromium ]]; then
      browser_repo_ready="1"
    fi

    if [[ "${browser_repo_ready}" == "1" ]] \
      && [[ -f /etc/apt/keyrings/docker.gpg ]] \
      && [[ -f /etc/apt/sources.list.d/docker.list ]] \
      && [[ -f /etc/apt/keyrings/nodesource.gpg ]] \
      && [[ -f /etc/apt/sources.list.d/nodesource.list ]]; then
      log "skipping package repository configuration"
      touch "${marker}"
      return
    fi
  fi

  log "configuring package repositories"
  mkdir -p /etc/apt/keyrings

  if [[ "${arch}" == "amd64" ]]; then
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg
    chmod a+r /etc/apt/keyrings/google-chrome.gpg
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" >/etc/apt/sources.list.d/google-chrome.list
  else
    curl -fsSL https://ftp-master.debian.org/keys/archive-key-12.asc | gpg --dearmor -o /etc/apt/keyrings/debian-archive.gpg
    chmod a+r /etc/apt/keyrings/debian-archive.gpg
    echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/debian-archive.gpg] http://deb.debian.org/debian bookworm main" >/etc/apt/sources.list.d/debian-bookworm-chromium.list
    cat >/etc/apt/preferences.d/debian-bookworm-chromium <<'EOF'
Package: *
Pin: release n=bookworm
Pin-Priority: 100

Package: chromium chromium-common chromium-sandbox
Pin: release n=bookworm
Pin-Priority: 700
EOF
  fi

  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" >/etc/apt/sources.list.d/docker.list

  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  chmod a+r /etc/apt/keyrings/nodesource.gpg
  echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" >/etc/apt/sources.list.d/nodesource.list

  invalidate_apt_update
  rm -f "${SETUP_STATE_DIR}"/packages-*.ready
  touch "${marker}"
}

install_external_packages() {
  local marker=""
  local browser_pkg=""

  local arch=""
  arch="$(dpkg --print-architecture)"

  marker="${SETUP_STATE_DIR}/packages-${arch}.ready"
  if [[ -f "${marker}" ]] \
    && command -v node >/dev/null 2>&1 \
    && command -v dockerd >/dev/null 2>&1 \
    && { command -v chromium >/dev/null 2>&1 || command -v google-chrome >/dev/null 2>&1; }; then
    return
  fi

  if should_skip_apt_packages \
    && command -v node >/dev/null 2>&1 \
    && command -v dockerd >/dev/null 2>&1 \
    && { command -v chromium >/dev/null 2>&1 || command -v google-chrome >/dev/null 2>&1; }; then
    log "skipping external package installation"
    if [[ "${arch}" == "amd64" ]] && command -v google-chrome >/dev/null 2>&1; then
      ln -sfn /usr/bin/google-chrome /usr/local/bin/chromium
      ln -sfn /usr/bin/google-chrome /usr/local/bin/chromium-browser
    fi
    rm -f "${SETUP_STATE_DIR}"/packages-*.ready
    touch "${marker}"
    return
  fi

  log "installing external packages"
  apt_update_once
  if [[ "${arch}" == "amd64" ]]; then
    browser_pkg="google-chrome-stable"
  else
    browser_pkg="chromium"
  fi

  apt_install \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin \
    nodejs \
    "${browser_pkg}"

  if [[ "${arch}" == "amd64" ]]; then
    ln -sfn /usr/bin/google-chrome /usr/local/bin/chromium
    ln -sfn /usr/bin/google-chrome /usr/local/bin/chromium-browser
  fi

  rm -f "${SETUP_STATE_DIR}"/packages-*.ready
  touch "${marker}"
}

install_node_tools() {
  local marker="${SETUP_STATE_DIR}/node-tools.ready"
  if [[ -f "${marker}" ]] && command -v node >/dev/null 2>&1 && command -v codex >/dev/null 2>&1 && command -v pi >/dev/null 2>&1; then
    return
  fi

  log "installing node + cli tools"
  npm i -g @openai/codex@latest @mariozechner/pi-coding-agent@latest
  npm cache clean --force
  touch "${marker}"
}

install_runc_override() {
  local marker="${SETUP_STATE_DIR}/runc-${RUNC_VERSION}.ready"
  if [[ -f "${marker}" ]] && [[ -x /usr/local/bin/runc ]]; then
    return
  fi

  log "installing runc v${RUNC_VERSION}"
  local arch=""
  arch="$(dpkg --print-architecture)"
  curl -fsSL -o /usr/local/bin/runc "https://github.com/opencontainers/runc/releases/download/v${RUNC_VERSION}/runc.${arch}"
  chmod +x /usr/local/bin/runc
  rm -f /usr/bin/runc /usr/sbin/runc
  ln -sfn /usr/local/bin/runc /usr/bin/runc
  ln -sfn /usr/local/bin/runc /usr/sbin/runc
  rm -f "${SETUP_STATE_DIR}"/runc-*.ready
  touch "${marker}"
}

install_openvscode() {
  local marker="${SETUP_STATE_DIR}/openvscode-${OPENVSCODE_SERVER_RELEASE}.ready"
  if [[ -f "${marker}" ]] && command -v openvscode-server >/dev/null 2>&1; then
    return
  fi

  log "installing openvscode-server ${OPENVSCODE_SERVER_RELEASE}"
  local arch=""
  local ov_arch=""
  arch="$(dpkg --print-architecture)"
  case "${arch}" in
    amd64) ov_arch="x64" ;;
    arm64) ov_arch="arm64" ;;
    *)
      echo "Unsupported architecture for openvscode-server: ${arch}" >&2
      exit 1
      ;;
  esac

  curl -fsSL "https://github.com/gitpod-io/openvscode-server/releases/download/${OPENVSCODE_SERVER_RELEASE}/${OPENVSCODE_SERVER_RELEASE}-linux-${ov_arch}.tar.gz" | tar -xz -C /opt
  ln -sfn "/opt/${OPENVSCODE_SERVER_RELEASE}-linux-${ov_arch}/bin/openvscode-server" /usr/local/bin/openvscode-server
  rm -f "${SETUP_STATE_DIR}"/openvscode-*.ready
  touch "${marker}"
}

install_uv() {
  local marker="${SETUP_STATE_DIR}/uv.ready"
  if [[ -f "${marker}" ]] && command -v uv >/dev/null 2>&1; then
    return
  fi

  log "installing uv"
  export UV_INSTALL_DIR
  export UV_NO_MODIFY_PATH
  curl -LsSf https://astral.sh/uv/install.sh | sh -s -- --quiet
  touch "${marker}"
}

sync_repo_files() {
  local novnc_src="${AGENT_DOCKER_DIR}/novnc/index.html"
  local docker_wrapper_src="${AGENT_DOCKER_DIR}/docker-wrapper.sh"
  local marker="${SETUP_STATE_DIR}/repo-sync.ready"
  local desired_state=""
  local current_state=""

  desired_state="$(
    {
      sha256sum "${docker_wrapper_src}"
      sha256sum "${novnc_src}"
      find "${AGENT_DOCKER_DIR}/runit" -maxdepth 1 -type f -name '*.sh' -print0 | sort -z | xargs -0 sha256sum
      [[ -f "${AGENT_SERVER_BIN}" ]] && sha256sum "${AGENT_SERVER_BIN}" || true
    } | sha256sum | awk '{print $1}'
  )"
  current_state="$(cat "${marker}" 2>/dev/null || true)"
  if [[ "${desired_state}" == "${current_state}" ]]; then
    return
  fi

  install -m 0755 "${docker_wrapper_src}" /usr/local/bin/docker
  mkdir -p /usr/share/novnc
  install -m 0644 "${novnc_src}" /usr/share/novnc/index.html
  install -m 0644 "${novnc_src}" /usr/share/novnc/vnc.html
  install -m 0644 "${novnc_src}" /usr/share/novnc/vnc_lite.html
  [[ -f "${AGENT_SERVER_BIN}" ]] && chmod +x "${AGENT_SERVER_BIN}"
  printf '%s\n' "${desired_state}" >"${marker}"
}

ensure_workspace_tools_links() {
  local workspace_tools_root="${WORKSPACE_TOOLS_DIR}"
  local tools_path="${workspace_tools_root}/tools"
  local bundled_tools_path=""
  local image_tools_path=""
  local src_root=""

  if [[ ! -d "${AGENT_TOOLS_DIR}" ]] && [[ ! -d "${IMAGE_TOOLS_DIR}" ]]; then
    return 0
  fi

  if [[ -e "${workspace_tools_root}" ]] && [[ ! -d "${workspace_tools_root}" ]]; then
    workspace_tools_root="${ROOT_DIR}"
    WORKSPACE_TOOLS_DIR="${workspace_tools_root}"
    export WORKSPACE_TOOLS_DIR
    tools_path="${workspace_tools_root}/tools"
  fi

  if [[ -L "${tools_path}" ]]; then
    local resolved=""
    resolved="$(readlink -f "${tools_path}" 2>/dev/null || true)"
    if [[ "${resolved}" == "${AGENT_TOOLS_DIR}" ]] || [[ "${resolved}" == "${IMAGE_TOOLS_DIR}" ]]; then
      rm -f "${tools_path}" 2>/dev/null || true
    fi
  fi

  if [[ -e "${tools_path}" ]] && [[ ! -d "${tools_path}" ]]; then
    workspace_tools_root="${ROOT_DIR}"
    WORKSPACE_TOOLS_DIR="${workspace_tools_root}"
    export WORKSPACE_TOOLS_DIR
    tools_path="${workspace_tools_root}/tools"
  fi

  bundled_tools_path="${tools_path}/default"
  image_tools_path="${tools_path}/image"
  mkdir -p "${workspace_tools_root}" "${tools_path}" "${bundled_tools_path}" "${image_tools_path}" 2>/dev/null || true

  local src_path=""
  if [[ -d "${AGENT_TOOLS_DIR}" ]]; then
    src_root="${AGENT_TOOLS_DIR}"
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
    done < <(find "${src_root}" -mindepth 1 -maxdepth 1 -print0)
  fi

  if [[ -d "${IMAGE_TOOLS_DIR}" ]]; then
    src_root="${IMAGE_TOOLS_DIR}"
    while IFS= read -r -d '' src_path; do
      local name=""
      local target_path=""
      local resolved_target=""
      name="$(basename "${src_path}")"
      target_path="${image_tools_path}/${name}"

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
    done < <(find "${src_root}" -mindepth 1 -maxdepth 1 -print0)
  fi
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
  cp -a -n "${src}/." "${dst}/" 2>/dev/null || true
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
    "${SETUP_STATE_DIR}" \
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
    local staged_hook=""
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

write_image_version_file() {
  local version="${1:-unknown}"
  printf '%s\n' "${version}" >/etc/agent-image-version
}

require_root
mkdir -p "${SETUP_STATE_DIR}"

install_bootstrap_packages
ensure_agent_user
install_base_packages
configure_package_repos
install_external_packages
install_runc_override
install_node_tools
install_openvscode
install_uv
sync_repo_files
prepare_runtime_state
run_hook_file_if_present "${IMAGE_SETUP_HOOK_PATH}"

source_version="$(resolve_source_version)"
write_marker_file "current_source_commit" "${source_version}"
write_marker_file "installed_commit" "${source_version}"
write_image_version_file "${source_version}"

rm -rf /var/lib/apt/lists/*

log "setup complete"
