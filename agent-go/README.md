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

`agent-go/Makefile` provides a single-command workflow:

```bash
cd agent-go
make help
```

Key targets:

- `make run`, `make serve`, `make proxy`
- `make build`, `make build-server`
- `make test`, `make test-docker`
- `make fmt`, `make vet`
- `make openapi` (prints OpenAPI spec path)
- `make docker-build`, `make docker-run`, `make docker-run-server`

## Server scope

`agent-go serve` implements:

- Session APIs (`/session/*`) + SSE streams
- Workspace APIs (`/workspaces/*`) + diff stream
- Terminal websocket (`/terminal`)
- SQLite persistence (sessions/messages/events outbox)
- Manager outbox sync dispatcher
- Codex and pi CLI wrappers used by run execution paths

## Standalone binary

Build a publishable server binary:

```bash
./agent-go/scripts/build-agent-server.sh
```

Build to a specific output path (example used by Docker below):

```bash
./agent-go/scripts/build-agent-server.sh --output ./agent-go/build-artifacts/agent-server
```

Pull, rebuild, stop the existing standalone binary process, and start the new one:

```bash
./agent-go/scripts/restart-agent-server.sh
```

This helper is for the standalone compiled-binary flow. It is not used by the Docker
launcher path, which runs `go run ./cmd/agent-go` on startup.

## Docker image (source-driven server launcher)

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

./agent-go/scripts/ghcr-push.sh push-amd64
```

Or from `agent-go/`:

```bash
make ghcr-push
```

Run from the `agent-go` directory using Make:

```bash
cd agent-go
make docker-build
make docker-run
```

Server-only mode (API on port `3131`, no OpenVSCode/noVNC):

```bash
cd agent-go
make docker-run-server
```

Use a different env file (for example test config):

```bash
cd agent-go
make docker-run ENV_FILE=.env.test
```

Runtime behavior intentionally keeps the same entrypoint/runit stack used by `agent`:

- `agent-go/docker/entrypoint.sh`
- browser/Xvfb/openbox/x11vnc/websockify startup
- OpenVSCode service startup
- optional dockerd service
- workspace tools sync + Codex `AGENTS.md` generation

The API server command remains `/app/agent-server`, but this is now an executable launcher
that runs `go run ./cmd/agent-go ...` from the source checkout in the image.
OpenVSCode proxying still uses the same command path (`/app/agent-server openvscode-proxy`).

### Entrypoint + `AGENT_RUNTIME_MODE`

OpenVSCode/noVNC are **not** started by `agent-server serve` itself. They come up via runit services that
are installed/launched by the container entrypoint (`agent-entrypoint`).

- Docker `ENTRYPOINT` is `agent-entrypoint` (`agent-go/Dockerfile`).
- `agent-entrypoint` sets up runit services when `AGENT_RUNTIME_MODE=all` (default), and intentionally
  skips them when `AGENT_RUNTIME_MODE=server` (`agent-go/docker/entrypoint.sh`).
- In `all` mode, relevant runit services include:
  - `openvscode-server` (`agent-go/docker/runit/openvscode-server.sh`)
  - `openvscode-proxy` (`agent-go/docker/runit/openvscode-proxy.sh`, runs `/app/agent-server openvscode-proxy`)
  - `ui-stack` (Xvfb/VNC/noVNC/Chromium) (`agent-go/docker/runit/ui-stack.sh`)

Operational implications:

- If your runtime bypasses Docker `ENTRYPOINT` (for example some Modal execution paths), OpenVSCode/noVNC
  will not start unless you explicitly wrap your command with `agent-entrypoint`.
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
- `DEFAULT_CODEX_MODEL`, `DEFAULT_WORKING_DIR`
- `OPENAI_API_KEY` or `CODEX_API_KEY`
- `PI_DIR`
- `AGENT_HOME`, `ROOT_DIR`, `WORKSPACES_DIR`
- `AGENT_MANAGER_BASE_URL`
- `AGENT_INTERNAL_AUTH_SECRET` for manager <-> runtime auth
- Legacy callback fallbacks (still parsed, but no longer the primary agent-runtime path): `AGENT_MANAGER_API_KEY`, `AGENT_MANAGER_AUTH_TOKEN`
