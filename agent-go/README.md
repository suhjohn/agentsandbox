# agent-go

Go implementation of the `agent` server migration.

## Commands

```bash
# Run the Go server (default command)
go run ./agent-go/cmd/agent-go

# Explicit server command
go run ./agent-go/cmd/agent-go serve

# Run OpenVSCode reverse proxy
go run ./agent-go/cmd/agent-go openvscode-proxy
```

## Make targets

`agent-go/Makefile` is intentionally small and only keeps the core workflows:

```bash
cd agent-go
make help
```

Targets:

- `make test`
- `make build`
- `make docker-build`
- `make docker-push`

Use `./scripts/dev.sh ...` directly for everything else, including local run/restart and Docker run/refresh flows.

## Server scope

`agent-go serve` implements:

- Session APIs (`/session/*`) + SSE streams
- Workspace APIs (`/workspaces/*`) + diff stream
- Terminal websocket (`/terminal`)
- SQLite persistence (sessions/messages/events outbox)
- Manager outbox sync dispatcher
- A harness registry that dispatches runtime execution by harness ID
- Codex and PI harness implementations backed by CLI wrappers

## Harness CLI model and thinking controls

The runtime exposes model/thinking controls through harness definitions in
`agent-go/internal/harness/*`.

- Shared harness contract and registry live in `agent-go/internal/harness/registry/`.
- The server resolves harness IDs through the registry instead of hard-coding a small set of harness names.
- `agent-manager` and `agent-manager-web` should treat `harness` as a string contract and let the runtime validate the actual value.

### Codex

- Wrapper types live in `agent-go/internal/harness/codex/cli.go`.
- Harness definition lives in `agent-go/internal/harness/codex/definition.go`.
- Model selection is a first-class field on `CodexRootOptions` as `Model`, which emits `--model <id>`.
- Thinking level is not a dedicated struct field. It is passed through `CodexGlobalOptions.Config` as a raw config entry such as `model_reasoning_effort="high"`.
- Supported thinking levels for Codex sessions are: `minimal`, `low`, `medium`, `high`, `xhigh`.

### PI

- Wrapper types live in `agent-go/internal/harness/pi/cli.go`.
- Harness definition lives in `agent-go/internal/harness/pi/definition.go`.
- Model selection is exposed directly on `PiOptions` as `Provider` and `Model`, which emit `--provider <provider>` and `--model <id>`.
- Thinking level is a first-class field on `PiOptions` as `Thinking`, which emits `--thinking <level>`.
- The PI RPC helpers also expose thinking controls through `PiRPCSetThinkingLevel(...)` and `PiRPCCycleThinkingLevel(...)`.
- Supported thinking levels for PI sessions are: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.

## Standalone binary

Build a publishable server binary:

```bash
./agent-go/scripts/dev.sh build-server
```

Or from `agent-go/`:

```bash
make build
```

Repeated `make build` runs produce a reproducible binary (`-buildvcs=false
-trimpath`) and only overwrite the local host-targeted artifact when the
content actually changed.

Build to a specific output path (example used by Docker below):

```bash
./agent-go/scripts/dev.sh build-server --output ./agent-go/build-artifacts/agent-server-linux-amd64
```

Pull, rebuild, stop the existing standalone binary process, and start the new one:

```bash
./agent-go/scripts/dev.sh restart-server
```

In the container runtime, `start.sh` now runs the main agent API under `supervisord`,
so this helper will restart that managed process in place when available.

Install or refresh a live sandbox from the repo checkout:

```bash
/path/to/repo/agent-go/docker/setup.sh
```

This flow will:

- install the full system/runtime dependency set into the container
- refresh installed helper files derived from the repo checkout
- recreate runtime paths and runtime-owned directories
- write source/install markers for the current checkout

## Docker image (source-driven server launcher)

The image now copies the repo and runs `agent-go/docker/setup.sh` during build.
That setup installs the CLI/runtime dependencies, including `codex` and `pi`.
The container runtime also exports harness-specific config roots:

- `CODEX_HOME`
- `PI_CODING_AGENT_DIR`

Build with the repository root as context:

```bash
docker build -f agent-go/Dockerfile -t agent-go:dev .
```

## GHCR push (linux/amd64)

From repo root:

```bash
export GITHUB_USERNAME="your-user-or-org"
export GHCR_TOKEN="github_pat_..."
export GHCR_IMAGE="ghcr.io/$GITHUB_USERNAME/agent"   # optional (default: ghcr.io/suhjohn/agent)
export GHCR_TAG="$(git rev-parse --short HEAD)"      # optional

./agent-go/scripts/dev.sh ghcr-push-amd64
```

This push flow rebuilds the tracked `agent-go/build-artifacts/agent-server-linux-amd64`
artifact for `linux/amd64` and updates `agent-go/build-artifacts/agent-server-linux-amd64.rev`
only when the binary content changed before running `docker buildx build`.

Or from `agent-go/`:

```bash
make docker-push
```

Build the Docker image from the `agent-go` directory using Make:

```bash
cd agent-go
make docker-build
```

Run the full container from the repo root:

```bash
./agent-go/scripts/dev.sh docker-run --env-file .env
```

Recreate the full container from the latest repo state in one command:

```bash
./agent-go/scripts/dev.sh docker-refresh --env-file .env
```

Server-only mode (API on port `3131`, no OpenVSCode/noVNC):

```bash
./agent-go/scripts/dev.sh docker-run --env-file .env --server-only
```

If you want the same pull + rebuild + recreate flow in API-only mode:

```bash
./agent-go/scripts/dev.sh docker-refresh --env-file .env --server-only
```

Use a different env file (for example test config):

```bash
./agent-go/scripts/dev.sh docker-run --env-file .env.test
```

Runtime behavior uses a minimal `supervisord` launcher:

- `agent-go/docker/start.sh`
- browser/Xvfb/openbox/x11vnc/websockify startup
- OpenVSCode service startup
- optional dockerd service
- tooling/runtime bootstrap prepared by `agent-go/docker/setup.sh`

The runtime resolves the API server binary through `AGENT_SERVER_BIN`
and points it at an architecture-qualified artifact inside
`/opt/agentsandbox/agent-go/build-artifacts/`. The tracked linux/amd64 source
revision is recorded in `agent-go/build-artifacts/agent-server-linux-amd64.rev`.
OpenVSCode proxying uses that same `AGENT_SERVER_BIN` path with the
`openvscode-proxy` subcommand.

### `setup.sh` + `start.sh`

OpenVSCode/noVNC are **not** started by `agent-server serve` itself. They are launched by
`start.sh` (`/opt/agentsandbox/agent-go/docker/start.sh`) under `supervisord`.

- `agent-go/Dockerfile` copies the repo and runs `agent-go/docker/setup.sh` during image build.
- `agent-go/docker/setup.sh` is the single bootstrap/install script for container dependencies and repo-derived helper files.
- `start.sh` resolves per-start env/secrets, exports the current launch env, and execs `supervisord` with `agent-go/docker/supervisord.conf`.
- In `all` mode, relevant supervised programs include:
  - `main` (typically `${AGENT_SERVER_BIN} serve`)
  - `openvscode-server` (`agent-go/docker/runit/openvscode-server.sh`)
  - `openvscode-proxy` (`agent-go/docker/runit/openvscode-proxy.sh`, runs `${AGENT_SERVER_BIN} openvscode-proxy`)
  - `ui-stack` (Xvfb/VNC/noVNC/Chromium) (`agent-go/docker/runit/ui-stack.sh`)
  - `dockerd` (`agent-go/docker/runit/dockerd.sh`) when enabled

Service control:

- Restart the main supervised program inside the container:

  ```bash
  ROOT_DIR=/home/agent/runtime supervisorctl -c /opt/agentsandbox/agent-go/docker/supervisord.conf restart main
  ```

Operational implications:

- Build sandboxes should refresh the repo and rerun `setup.sh`, then run `/shared/image/hooks/build.sh`, before snapshotting.
- If your runtime bypasses `start.sh`, OpenVSCode/noVNC will not start unless you explicitly run
  `/path/to/repo/agent-go/docker/start.sh`.
- Setup sandboxes intentionally run with `AGENT_RUNTIME_MODE=server` (API-only), so OpenVSCode/noVNC
  will be skipped even when `start.sh` runs.

## Tests

Fast tests:

```bash
cd agent-go
go test ./...
```

Docker integration tests (ported from the legacy Bun agent):

```bash
cd agent-go
go test -tags dockerintegration ./...
```

Optional live-AI coverage for relevant tests:

```bash
RUN_LIVE_AI_IT=1 OPENAI_API_KEY=... SECRET_SEED=... go test -tags dockerintegration ./...
```

## Core env vars

- `PORT`, `DATABASE_PATH`, `SECRET_SEED`
- `DEFAULT_MODEL`, `DEFAULT_REASONING_EFFORT`, `DEFAULT_WORKING_DIR`
- `OPENAI_API_KEY` or `CODEX_API_KEY`
- `PI_CODING_AGENT_DIR`
- `AGENT_HOME`, `ROOT_DIR`, `WORKSPACES_DIR`
- `AGENT_MANAGER_BASE_URL`
- `AGENT_MANAGER_API_KEY` for manager API calls from the runtime
