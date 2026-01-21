FROM ubuntu:24.04

WORKDIR /repo/agent-manager

ENV NODE_ENV=production
ENV DEBIAN_FRONTEND=noninteractive

# Install Bun (and minimal deps) for running agent-manager.
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends ca-certificates curl unzip python3 python3-venv; \
  rm -rf /var/lib/apt/lists/*; \
  curl -fsSL https://bun.sh/install -o /tmp/bun-install.sh; \
  BUN_INSTALL=/usr/local/bun bash /tmp/bun-install.sh; \
  rm -f /tmp/bun-install.sh; \
  ln -sfn /usr/local/bun/bin/bun /usr/local/bin/bun; \
  ln -sfn /usr/local/bun/bin/bunx /usr/local/bin/bunx

# Install uv (fast Python package manager) for Modal image build scripts
ENV UV_INSTALL_DIR=/usr/local/bin
ENV UV_NO_MODIFY_PATH=1
RUN set -eux; curl -LsSf https://astral.sh/uv/install.sh | sh -s -- --quiet

# Install deps for agent-manager (cached)
COPY agent-manager/package.json agent-manager/bun.lock ./
RUN bun install --frozen-lockfile

# Copy the full monorepo so the image contains all top-level folders
WORKDIR /repo
COPY . .

WORKDIR /repo/agent-manager

ENV PORT=3132
EXPOSE 3132

CMD ["bun", "run", "src/index.ts"]
