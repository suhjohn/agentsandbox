# agent-go/Dockerfile
FROM ubuntu:24.04

ARG AGENT_REPO_DIR=/opt/agentsandbox

### Note to future: if you ever add any additional installations, add them to agent-go/docker/setup.sh as well. 
# We basically want any installation of programs to be doubly-bound between Dockerfile and this setup.sh script.

#### INSTALLATIONS START HERE ####
RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg; \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    mkdir -p /etc/apt/keyrings; \
    arch="$(dpkg --print-architecture)"; \
    if [ "${arch}" = "amd64" ]; then \
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg; \
    chmod a+r /etc/apt/keyrings/google-chrome.gpg; \
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" >/etc/apt/sources.list.d/google-chrome.list; \
    else \
    curl -fsSL https://ftp-master.debian.org/keys/archive-key-12.asc | gpg --dearmor -o /etc/apt/keyrings/debian-archive.gpg; \
    chmod a+r /etc/apt/keyrings/debian-archive.gpg; \
    echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/debian-archive.gpg] http://deb.debian.org/debian bookworm main" >/etc/apt/sources.list.d/debian-bookworm-chromium.list; \
    fi; \
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg; \
    chmod a+r /etc/apt/keyrings/docker.gpg; \
    . /etc/os-release; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" >/etc/apt/sources.list.d/docker.list; \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
    chmod a+r /etc/apt/keyrings/nodesource.gpg; \
    echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" >/etc/apt/sources.list.d/nodesource.list

RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    arch="$(dpkg --print-architecture)"; \
    browser_pkg="chromium"; \
    if [ "${arch}" = "amd64" ]; then \
    browser_pkg="google-chrome-stable"; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
    autocutsel \
    apt-utils \
    containerd.io \
    docker-buildx-plugin \
    docker-ce \
    docker-ce-cli \
    docker-compose-plugin \
    dumb-init \
    fd-find \
    fonts-dejavu-core \
    fonts-liberation \
    git \
    iproute2 \
    iptables \
    jq \
    nodejs \
    novnc \
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
    x11vnc \
    xvfb \
    "${browser_pkg}"; \
    ln -sfn /usr/bin/fdfind /usr/local/bin/fd; \
    if [ "${arch}" = "amd64" ]; then \
    ln -sfn /usr/bin/google-chrome /usr/local/bin/chromium; \
    ln -sfn /usr/bin/google-chrome /usr/local/bin/chromium-browser; \
    fi; \
    rm -rf /var/lib/apt/lists/*

#### INSTALLATIONS END HERE ####

COPY . ${AGENT_REPO_DIR}

WORKDIR ${AGENT_REPO_DIR}/agent-go

RUN AGENT_SETUP_SKIP_APT_PACKAGES=1 bash docker/setup.sh

CMD ["sleep", "infinity"]
