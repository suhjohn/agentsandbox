FROM ubuntu:24.04
WORKDIR /app

ENV NODE_ENV=production

# OpenVSCode Server (configurable at build/run time)
ARG OPENVSCODE_SERVER_RELEASE=openvscode-server-v1.106.3
ENV OPENVSCODE_SERVER_RELEASE=${OPENVSCODE_SERVER_RELEASE}
ENV OPENVSCODE_SERVER_PORT=39393
ARG RUNC_VERSION=1.3.0
ENV RUNC_VERSION=${RUNC_VERSION}

# Install uv (fast Python package manager) for Modal prepare_sandbox scripts
ENV UV_INSTALL_DIR=/usr/local/bin
ENV UV_NO_MODIFY_PATH=1

RUN set -eux; \
  export DEBIAN_FRONTEND=noninteractive; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
    autocutsel \
    bash \
    ca-certificates \
    curl \
    dumb-init \
    fonts-dejavu-core \
    fonts-liberation \
    git \
    gnupg \
    libheif-examples \
    iproute2 \
    iptables \
    jq \
    less \
    nodejs \
    npm \
    openbox \
    openssh-client \
    procps \
    python-is-python3 \
    python3 \
    python3-pip \
    python3-venv \
    ripgrep \
    runit \
    sqlite3 \
    tar \
    unzip \
    websockify \
    novnc \
    xclip \
    x11vnc \
    xvfb \
    zip; \
  arch="$(dpkg --print-architecture)"; \
  install -m 0755 -d /etc/apt/keyrings; \
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
  mkdir -p /home/agent/workspaces /tmp/.X11-unix; \
  chmod 0777 /home/agent/workspaces; \
  chmod 1777 /tmp/.X11-unix; \
  rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  arch="$(dpkg --print-architecture)"; \
  case "${arch}" in \
    amd64) runc_arch="amd64" ;; \
    arm64) runc_arch="arm64" ;; \
    *) echo "Unsupported architecture for runc: ${arch}" >&2; exit 1 ;; \
  esac; \
  curl -fsSL -o /usr/local/bin/runc "https://github.com/opencontainers/runc/releases/download/v${RUNC_VERSION}/runc.${runc_arch}"; \
  chmod +x /usr/local/bin/runc; \
  rm -f /usr/bin/runc /usr/sbin/runc; \
  ln -sfn /usr/local/bin/runc /usr/bin/runc; \
  ln -sfn /usr/local/bin/runc /usr/sbin/runc; \
  case "${arch}" in \
    amd64) ov_arch="x64" ;; \
    arm64) ov_arch="arm64" ;; \
    *) echo "Unsupported architecture for openvscode-server: ${arch}" >&2; exit 1 ;; \
  esac; \
  tmp_dir="$(mktemp -d)"; \
  curl -fsSL -o "${tmp_dir}/openvscode-server.tar.gz" "https://github.com/gitpod-io/openvscode-server/releases/download/${OPENVSCODE_SERVER_RELEASE}/${OPENVSCODE_SERVER_RELEASE}-linux-${ov_arch}.tar.gz"; \
  rm -rf "/opt/${OPENVSCODE_SERVER_RELEASE}-linux-${ov_arch}"; \
  tar -xzf "${tmp_dir}/openvscode-server.tar.gz" -C /opt; \
  ln -sfn "/opt/${OPENVSCODE_SERVER_RELEASE}-linux-${ov_arch}/bin/openvscode-server" /usr/local/bin/openvscode-server; \
  rm -rf "${tmp_dir}"; \
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; \
  apt-get install -y --no-install-recommends nodejs; \
  node --version; \
  npm i -g @openai/codex@latest @mariozechner/pi-coding-agent@latest; \
  command -v codex >/dev/null; \
  command -v pi >/dev/null; \
  curl -LsSf https://astral.sh/uv/install.sh | sh -s -- --quiet

ARG AGENT_SERVER_BINARY=agent-go/build-artifacts/agent-server
COPY ${AGENT_SERVER_BINARY} /app/agent-server
COPY agent-go/docker /app/docker
COPY agent-go/tools /app/tools

RUN chmod +x /app/agent-server \
  && ln -sfn /app/agent-server /usr/local/bin/agent-server \
  && install -m 0755 /app/docker/entrypoint.sh /usr/local/bin/agent-entrypoint \
  && install -m 0755 /app/docker/docker-wrapper.sh /usr/local/bin/docker \
  && mkdir -p /usr/share/novnc \
  && cp -f /app/docker/novnc/index.html /usr/share/novnc/index.html \
  && cp -f /app/docker/novnc/index.html /usr/share/novnc/vnc.html \
  && cp -f /app/docker/novnc/index.html /usr/share/novnc/vnc_lite.html \
  && chmod +x /app/docker/entrypoint.sh /app/docker/docker-wrapper.sh /app/docker/runit/*.sh

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
ENV CODEX_HOME=${AGENT_HOME}/.codex
ENV PI_DIR=${AGENT_HOME}/.pi
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
    "${PI_DIR}" \
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
