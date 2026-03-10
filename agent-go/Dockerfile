FROM ubuntu:24.04
WORKDIR /app

ENV NODE_ENV=production

# Build arguments for version pinning
ARG OPENVSCODE_SERVER_RELEASE=openvscode-server-v1.106.3
ARG RUNC_VERSION=1.3.0
ARG GO_VERSION=1.24.0

# Persist versions as ENV for runtime access
ENV OPENVSCODE_SERVER_RELEASE=${OPENVSCODE_SERVER_RELEASE} \
  OPENVSCODE_SERVER_PORT=39393 \
  RUNC_VERSION=${RUNC_VERSION} \
  GO_VERSION=${GO_VERSION} \
  UV_INSTALL_DIR=/usr/local/bin \
  UV_NO_MODIFY_PATH=1 \
  PATH="/usr/local/go/bin:${PATH}"

# Layer 1: Base system packages (rarely changes)
RUN set -eux; \
  export DEBIAN_FRONTEND=noninteractive; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
  autocutsel \
  ca-certificates \
  curl \
  dumb-init \
  fonts-dejavu-core \
  fonts-liberation \
  git \
  gnupg \
  iproute2 \
  iptables \
  jq \
  openbox \
  procps \
  python-is-python3 \
  python3 \
  ripgrep \
  runit \
  tar \
  websockify \
  novnc \
  x11vnc \
  xvfb; \
  mkdir -p /home/agent/workspaces /tmp/.X11-unix /etc/apt/keyrings; \
  chmod 0777 /home/agent/workspaces; \
  chmod 1777 /tmp/.X11-unix; \
  rm -rf /var/lib/apt/lists/*

# Layer 2: Browser installation (architecture-specific, changes rarely)
RUN set -eux; \
  export DEBIAN_FRONTEND=noninteractive; \
  arch="$(dpkg --print-architecture)"; \
  if [ "${arch}" = "amd64" ]; then \
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg; \
  chmod a+r /etc/apt/keyrings/google-chrome.gpg; \
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list; \
  apt-get update; \
  apt-get install -y --no-install-recommends google-chrome-stable; \
  ln -sfn /usr/bin/google-chrome /usr/local/bin/chromium; \
  ln -sfn /usr/bin/google-chrome /usr/local/bin/chromium-browser; \
  else \
  curl -fsSL https://ftp-master.debian.org/keys/archive-key-12.asc | gpg --dearmor -o /etc/apt/keyrings/debian-archive.gpg; \
  chmod a+r /etc/apt/keyrings/debian-archive.gpg; \
  echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/debian-archive.gpg] http://deb.debian.org/debian bookworm main" > /etc/apt/sources.list.d/debian-bookworm-chromium.list; \
  apt-get update; \
  apt-get install -y --no-install-recommends chromium; \
  rm -f /etc/apt/sources.list.d/debian-bookworm-chromium.list; \
  fi; \
  rm -rf /var/lib/apt/lists/*

# Layer 3: Docker installation (changes rarely)
RUN set -eux; \
  export DEBIAN_FRONTEND=noninteractive; \
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg; \
  chmod a+r /etc/apt/keyrings/docker.gpg; \
  . /etc/os-release; \
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin; \
  rm -rf /var/lib/apt/lists/*

# Layer 4: runc override (version-pinned, changes when RUNC_VERSION changes)
RUN set -eux; \
  arch="$(dpkg --print-architecture)"; \
  curl -fsSL -o /usr/local/bin/runc "https://github.com/opencontainers/runc/releases/download/v${RUNC_VERSION}/runc.${arch}"; \
  chmod +x /usr/local/bin/runc; \
  rm -f /usr/bin/runc /usr/sbin/runc; \
  ln -sfn /usr/local/bin/runc /usr/bin/runc; \
  ln -sfn /usr/local/bin/runc /usr/sbin/runc

# Layer 5: Go installation (version-pinned)
RUN set -eux; \
  arch="$(dpkg --print-architecture)"; \
  rm -rf /usr/local/go; \
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${arch}.tar.gz" | tar -C /usr/local -xz; \
  /usr/local/go/bin/go version

# Layer 6: Node.js + npm packages (changes when updating codex/pi/opencode versions)
RUN set -eux; \
  export DEBIAN_FRONTEND=noninteractive; \
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; \
  apt-get install -y --no-install-recommends nodejs; \
  node --version; \
  npm i -g @openai/codex@latest @mariozechner/pi-coding-agent@latest opencode-ai@latest; \
  npm cache clean --force; \
  command -v codex >/dev/null; \
  command -v pi >/dev/null; \
  command -v opencode >/dev/null; \
  rm -rf /var/lib/apt/lists/*

# Layer 7: OpenVSCode Server (version-pinned, large download)
RUN set -eux; \
  arch="$(dpkg --print-architecture)"; \
  case "${arch}" in \
  amd64) ov_arch="x64" ;; \
  arm64) ov_arch="arm64" ;; \
  *) echo "Unsupported architecture for openvscode-server: ${arch}" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://github.com/gitpod-io/openvscode-server/releases/download/${OPENVSCODE_SERVER_RELEASE}/${OPENVSCODE_SERVER_RELEASE}-linux-${ov_arch}.tar.gz" | tar -xz -C /opt; \
  ln -sfn "/opt/${OPENVSCODE_SERVER_RELEASE}-linux-${ov_arch}/bin/openvscode-server" /usr/local/bin/openvscode-server

# Layer 8: uv (Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh -s -- --quiet

ARG AGENT_REPO_DIR=/opt/agentsandbox
ENV AGENT_GO_CACHE_DIR=/var/cache/agent-go \
  GOCACHE=/var/cache/agent-go/build-cache \
  GOMODCACHE=/var/cache/agent-go/mod-cache

RUN mkdir -p "${AGENT_REPO_DIR}/agent-go" "${GOCACHE}" "${GOMODCACHE}"

# Layer 9: Prewarm Go module cache from agent-go/go.mod/go.sum
COPY agent-go/go.mod agent-go/go.sum ${AGENT_REPO_DIR}/agent-go/
RUN set -eux; \
  cd "${AGENT_REPO_DIR}/agent-go"; \
  go mod download

# Layer 10: Copy entire repo (includes agent-go/docker and agent-go/tools)
COPY . ${AGENT_REPO_DIR}

# Symlink docker/tools to /app for backwards compatibility
RUN ln -sfn "${AGENT_REPO_DIR}/agent-go/docker" /app/docker \
  && ln -sfn "${AGENT_REPO_DIR}/agent-go/tools" /app/tools \
  && ln -sfn "${AGENT_REPO_DIR}/agent-go/docker/agent-server.sh" /app/agent-server \
  && ln -sfn /app/agent-server /usr/local/bin/agent-server \
  && install -m 0755 "${AGENT_REPO_DIR}/agent-go/docker/update-agent-go-source.sh" /usr/local/bin/agent-go-update-source \
  && install -m 0755 "${AGENT_REPO_DIR}/agent-go/docker/entrypoint.sh" /usr/local/bin/agent-entrypoint \
  && install -m 0755 "${AGENT_REPO_DIR}/agent-go/docker/docker-wrapper.sh" /usr/local/bin/docker \
  && mkdir -p /usr/share/novnc \
  && cp -f "${AGENT_REPO_DIR}/agent-go/docker/novnc/index.html" /usr/share/novnc/index.html \
  && cp -f "${AGENT_REPO_DIR}/agent-go/docker/novnc/index.html" /usr/share/novnc/vnc.html \
  && cp -f "${AGENT_REPO_DIR}/agent-go/docker/novnc/index.html" /usr/share/novnc/vnc_lite.html \
  && chmod +x "${AGENT_REPO_DIR}/agent-go/docker/runit/"*.sh

ARG PORT=3131
ENV PORT=${PORT}

ENV DISPLAY=:99
ENV SCREEN_WIDTH=1280
ENV SCREEN_HEIGHT=720
ENV SCREEN_DEPTH=24
ENV NOVNC_PORT=6080
ENV VNC_PORT=5900
ENV CHROMIUM_NO_SANDBOX=1
ENV PROFILE_CHECKPOINT_ENABLED=1
ENV PROFILE_CHECKPOINT_INTERVAL_SEC=15
ENV PROFILE_CHECKPOINT_KEEP=40
ENV CHROMIUM_REMOTE_DEBUG_ADDRESS=127.0.0.1
ENV CHROMIUM_REMOTE_DEBUG_PORT=9222

ENV AGENT_HOME=/home/agent
ENV AGENT_ID=default
ENV WORKSPACES_DIR=${AGENT_HOME}/workspaces
ENV ROOT_DIR=${AGENT_HOME}/runtime
ENV AGENT_GO_REPO_DIR=${AGENT_REPO_DIR}/agent-go
ENV AGENT_GO_AUTO_PULL=1
ENV AGENT_GO_PULL_REF=main
ENV CODEX_HOME=${AGENT_HOME}/.codex
ENV PI_CODING_AGENT_DIR=${AGENT_HOME}/.pi
ENV HOME=${AGENT_HOME}
ENV RUNTIME_DIR=${ROOT_DIR}/runtime
ENV DATABASE_PATH=${ROOT_DIR}/app/agent.db
ENV BROWSER_STATE_DIR=${ROOT_DIR}/browser
ENV CHROMIUM_USER_DATA_DIR=${BROWSER_STATE_DIR}/chromium
ENV BROWSER_HOME_DIR=${BROWSER_STATE_DIR}/home
ENV BROWSER_XDG_CONFIG_HOME=${BROWSER_STATE_DIR}/xdg/config
ENV BROWSER_XDG_CACHE_HOME=${BROWSER_STATE_DIR}/xdg/cache
ENV BROWSER_XDG_DATA_HOME=${BROWSER_STATE_DIR}/xdg/data
ENV CHROMIUM_LOG_FILE=${ROOT_DIR}/logs/chromium.log
ENV OPENBOX_LOG_FILE=${ROOT_DIR}/logs/openbox.log
ENV AGENT_SERVER_LOG_FILE=${ROOT_DIR}/logs/agent-server.log
ENV AGENT_SERVER_LOG_ENABLED=1
ENV CHROMIUM_PID_FILE=${ROOT_DIR}/run/chromium.pid
ENV XDG_CONFIG_HOME=${ROOT_DIR}/xdg/config
ENV XDG_CACHE_HOME=${ROOT_DIR}/xdg/cache
ENV XDG_DATA_HOME=${ROOT_DIR}/xdg/data
ENV DOCKERD_ENABLED=0
ENV DOCKERD_LOG_FILE=${ROOT_DIR}/logs/dockerd.log
ENV DOCKERD_DATA_ROOT=${ROOT_DIR}/docker
ENV OPENVSCODE_SERVER_HOST=0.0.0.0
ENV OPENVSCODE_SERVER_WORKSPACE_DIR=${WORKSPACES_DIR}
ENV OPENVSCODE_PROXY_ENABLED=1
ENV OPENVSCODE_PROXY_HOST=${OPENVSCODE_SERVER_HOST}
ENV OPENVSCODE_PROXY_PORT=${OPENVSCODE_SERVER_PORT}
ENV OPENVSCODE_UPSTREAM_HOST=127.0.0.1
ENV OPENVSCODE_UPSTREAM_PORT=39395
ENV BROWSER_START_URL=https://www.google.com
ENV CHROMIUM_FLAGS=""
RUN set -eux; \
  mkdir -p \
  "${AGENT_HOME}" \
  "${WORKSPACES_DIR}" \
  "${ROOT_DIR}/logs" \
  "${ROOT_DIR}/run" \
  "${ROOT_DIR}/app" \
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
  "${ROOT_DIR}/vnc"

ENV AGENT_MANAGER_BASE_URL=""

EXPOSE ${PORT} ${OPENVSCODE_SERVER_PORT} 6080 5900

ARG AGENT_IMAGE_VERSION=dev
LABEL org.opencontainers.image.revision=${AGENT_IMAGE_VERSION}
ENV AGENT_IMAGE_VERSION=${AGENT_IMAGE_VERSION}
RUN set -eux; \
  printf '%s\n' "${AGENT_IMAGE_VERSION}" > /etc/agent-image-version; \
  mkdir -p /etc/profile.d; \
  printf '%s\n' \
  'if [ -z "${AGENT_IMAGE_VERSION:-}" ] && [ -f /etc/agent-image-version ]; then' \
  '  export AGENT_IMAGE_VERSION="$(cat /etc/agent-image-version 2>/dev/null || true)"' \
  'fi' \
  > /etc/profile.d/agent-image-version.sh; \
  chmod 0644 /etc/profile.d/agent-image-version.sh

ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/agent-entrypoint"]
CMD ["/app/agent-server"]
