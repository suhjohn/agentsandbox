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

Build to a specific output path (example used by Docker below):

```bash
./agent-go/scripts/dev.sh build-server --output ./agent-go/build-artifacts/agent-server
```

Pull, rebuild, stop the existing standalone binary process, and start the new one:

```bash
./agent-go/scripts/dev.sh restart-server
```

In the container runtime, the entrypoint now runs the main agent API under `runit`,
so this helper will restart that `agent-server` service in place when available.

## Docker image (source-driven server launcher)

The image installs both CLI harness binaries during build: `codex` and `pi`.
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

This push flow rebuilds the tracked `agent-go/build-artifacts/agent-server`
artifact for `linux/amd64` and updates `agent-go/build-artifacts/agent-server.rev`
only when the recorded Git revision changed before running `docker buildx build`.

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

Runtime behavior intentionally keeps the same entrypoint/runit stack used by `agent`:

- `agent-go/docker/entrypoint.sh`
- browser/Xvfb/openbox/x11vnc/websockify startup
- OpenVSCode service startup
- optional dockerd service
- workspace tools sync + harness runtime setup on `agent-server serve` startup (`AGENTS.md`, Codex auth seeding)

The API server command now calls the tracked repo binary directly at
`/opt/agentsandbox/agent-go/build-artifacts/agent-server`. The matching source
revision is recorded in `agent-go/build-artifacts/agent-server.rev`.
OpenVSCode proxying uses that same binary (`/opt/agentsandbox/agent-go/build-artifacts/agent-server openvscode-proxy`).

### Entrypoint + `AGENT_RUNTIME_MODE`

OpenVSCode/noVNC are **not** started by `agent-server serve` itself. They come up via runit services that
are installed/launched by the container entrypoint (`/opt/agentsandbox/agent-go/docker/entrypoint.sh`).

- Docker `ENTRYPOINT` is `/opt/agentsandbox/agent-go/docker/entrypoint.sh` (`agent-go/Dockerfile`).
- That entrypoint always installs the main `agent-server` service when the container command is
  `/opt/agentsandbox/agent-go/build-artifacts/agent-server ...`. In `AGENT_RUNTIME_MODE=all` (default), it also installs the UI/OpenVSCode services.
- When the container command is `/opt/agentsandbox/agent-go/build-artifacts/agent-server ...`, the entrypoint now installs that command
  as the `agent-server` runit service and keeps `runsvdir` as the foreground process.
- In `all` mode, relevant runit services include:
  - `agent-server` (main API service, installed dynamically from the container command)
  - `openvscode-server` (`agent-go/docker/runit/openvscode-server.sh`)
  - `openvscode-proxy` (`agent-go/docker/runit/openvscode-proxy.sh`, runs `/opt/agentsandbox/agent-go/build-artifacts/agent-server openvscode-proxy`)
  - `ui-stack` (Xvfb/VNC/noVNC/Chromium) (`agent-go/docker/runit/ui-stack.sh`)

Service control:

- Restart all installed runit services inside the container:

  ```bash
  sv restart /home/agent/runtime/runit/services/*
  ```

Operational implications:

- If your runtime bypasses Docker `ENTRYPOINT` (for example some Modal execution paths), OpenVSCode/noVNC
  will not start unless you explicitly wrap your command with `/opt/agentsandbox/agent-go/docker/entrypoint.sh`.
- Build/setup sandboxes intentionally run with `AGENT_RUNTIME_MODE=server` (API-only), so OpenVSCode/noVNC
  will be skipped even if the entrypoint runs.

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
- `AGENT_INTERNAL_AUTH_SECRET` for manager <-> runtime auth
