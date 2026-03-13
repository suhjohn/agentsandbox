# Sandbox Runtime Refactor Spec

Status: implemented

## Goal

Clean up sandbox boot and build so the shell side owns sandbox reconciliation and the TypeScript side only orchestrates sandbox lifecycle.

This spec assumes:

- no migration compatibility work
- no preserving the current script layout
- no creating extra shell entrypoints when two are enough

## Desired Shape

There are two shell entrypoints:

- `agent-go/docker/setup.sh`
- `agent-go/docker/start.sh`

There is no `entrypoint.sh`, no `update-agent-go-source.sh`, and no separate build or upgrade helper.

## File Changes

### Delete

- `agent-go/docker/entrypoint.sh`
- `agent-go/docker/update-agent-go-source.sh`
- `agent-go/scripts/reconcile-runtime.sh`

### Create

- `agent-go/docker/start.sh`
- `agent-go/docker/setup.sh`

### Keep

- `agent-go/docker/docker-wrapper.sh`
- `agent-go/docker/runit/dockerd.sh`
- `agent-go/docker/runit/openvscode-server.sh`
- `agent-go/docker/runit/openvscode-proxy.sh`
- `agent-go/docker/runit/ui-stack.sh`

## Ownership Boundary

### TypeScript owns orchestration

TypeScript decides:

- which sandbox to create
- which image to use
- which env vars, secrets, and volumes to mount
- when to snapshot
- when to run setup

TypeScript does not own sandbox reconciliation details.

### Shell owns reconciliation

Shell scripts decide how a sandbox becomes correct for a given version:

- installed runtime file sync
- runtime directory creation
- tool linking
- baseline seeding
- auth/token setup
- supervisor program generation
- runtime launch through `start.sh`

## Script Responsibilities

### `setup.sh`

`setup.sh` is the single install/bootstrap entrypoint.

It owns:

- installing system dependencies into the container
- syncing installed runtime files into their final locations
- preparing runtime directories and linked tools
- writing commit and version markers

### `start.sh`

`start.sh` is the runtime launcher.

It is used by:

- normal agent sandboxes
- setup sandboxes
- any sandbox that should boot into a running environment

It owns:

- env and derived path resolution
- auth secret and token resolution
- exporting the current launch env for `agent-go/docker/supervisord.conf`
- starting the correct runtime mode

Runtime mode is controlled by env such as:

- `AGENT_RUNTIME_MODE=all`
- `AGENT_RUNTIME_MODE=server`

### Build sandbox refresh

The manager build flow runs:

- `git pull --ff-only`
- `agent-go/docker/setup.sh`
- `/shared/image/hooks/build.sh`
- verifying required binaries and files before snapshot

The purpose of `setup.sh` is to ensure build sandboxes get the same baseline layout as agent sandboxes before the filesystem is snapshotted.

`start.sh` runs `setup.sh` first, then launches the requested runtime command and foreground services.

## Dockerfile

`agent-go/Dockerfile` should:

- stay minimal
- avoid preinstalling runtime dependencies
- avoid hard-wiring an entrypoint

## Manager Changes

### `agent-manager/src/services/sandbox.service.ts`

This file should continue to own sandbox orchestration only.

It should:

- create normal sandboxes that boot through `start.sh`
- create setup sandboxes that also boot through `start.sh`
- control runtime behavior through env like `AGENT_RUNTIME_MODE=server`

It should not contain ad hoc shell reconciliation logic that belongs in the sandbox scripts.

### `agent-manager/src/services/build.ts`

This file should continue to own build orchestration only.

It should:

- create the build sandbox
- stream logs
- invoke `agent-go/docker/setup.sh` inside the sandbox
- snapshot the filesystem
- return the built image id

It should stop assembling shell setup logic inline when that logic belongs in `setup.sh`.

## State Model

Separate the sandbox into three kinds of state.

### Install state

- repo checkout under `/opt/agentsandbox`
- copied runtime files in final installed locations
- generated supervisor launch files

### Runtime state

- directories under the runtime root
- pid files
- logs
- browser state scaffolding
- supervisor config and wrapper scripts
- commit and version markers

### User state

- workspace files
- user browser state, if preserved
- any persistent data the user owns

User state must stay outside the install tree.

## Version Tracking

Setup/runtime state should be recorded with marker files in runtime state.

Track at least:

- `current_source_commit`
- `installed_commit`
- `running_commit`

The target model is:

- `setup.sh` installs and reconciles the container to the current checkout
- `start.sh` records the running version after services are launched

## Service Model

`supervisord` is the runtime supervisor.

`agent-go/docker/supervisord.conf` is the checked-in static supervisor config.

`start.sh` regenerates the service tree each launch after `setup.sh` completes.

The expected service set remains:

- `agent-server`
- `ui-stack`
- `openvscode-server`
- `openvscode-proxy`
- `dockerd`

depending on runtime mode and env.

## Design Rules

- `setup.sh` is the only install/setup script.
- `start.sh` is the only runtime launcher.
- TypeScript selects lifecycle and version targets.
- Shell scripts own sandbox reconciliation.
- Build sandboxes and setup sandboxes must get the same baseline runtime layout as agent sandboxes.
- Runtime reconciliation logic should not be split across multiple shell fragments and inline TypeScript snippets.

## Follow-Up Work

- Update `agent-go/Dockerfile`
- Implement `agent-go/docker/setup.sh`
- Implement `agent-go/docker/start.sh`
- Remove deleted scripts
- Update `agent-manager/src/services/sandbox.service.ts`
- Update `agent-manager/src/services/build.ts`
- Update tests and docs that reference `entrypoint.sh`
