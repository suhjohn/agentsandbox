# Sandbox Runtime Refactor Spec

Status: implemented

## Goal

Clean up sandbox boot, build, and in-place upgrade so the shell side owns sandbox reconciliation and the TypeScript side only orchestrates sandbox lifecycle.

This spec assumes:

- no migration compatibility work
- no preserving the current script layout
- no creating new sandboxes for upgrade
- a running sandbox can be upgraded in place to a target commit or ref

## Desired Shape

There are three shell entrypoints:

- `agent-go/docker/start.sh`
- `agent-go/docker/build.sh`
- `agent-go/docker/upgrade.sh`

There is no `entrypoint.sh`, no `update-agent-go-source.sh`, and no separate runtime reconcile script.

## File Changes

### Delete

- `agent-go/docker/entrypoint.sh`
- `agent-go/docker/update-agent-go-source.sh`
- `agent-go/scripts/reconcile-runtime.sh`

### Create

- `agent-go/docker/start.sh`
- `agent-go/docker/build.sh`
- `agent-go/docker/upgrade.sh`

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
- which commit or ref to upgrade to

TypeScript does not own sandbox reconciliation details.

### Shell owns reconciliation

Shell scripts decide how a sandbox becomes correct for a given version:

- source checkout sync
- installed runtime file sync
- runtime directory creation
- tool linking
- baseline seeding
- auth/token setup
- runit service generation
- service restart during upgrade

## Script Responsibilities

### `start.sh`

`start.sh` is the only container entrypoint.

It is used by:

- normal agent sandboxes
- setup sandboxes
- any sandbox that should boot into a running environment

It owns:

- env and derived path resolution
- runtime directory creation
- workspace tool linking
- baseline runtime seeding
- auth secret and token resolution
- syncing installed runtime files into their final locations
- generating runit services
- starting the correct runtime mode

Runtime mode is controlled by env such as:

- `AGENT_RUNTIME_MODE=all`
- `AGENT_RUNTIME_MODE=server`

### `build.sh`

`build.sh` is the only in-sandbox build/setup convergence script.

It is invoked by the manager build flow inside a running build sandbox.

It owns:

- syncing source checkout to a target commit or ref when needed
- creating the same runtime directories and tool links as agent sandboxes
- syncing installed runtime files into their final locations
- running shared build hooks
- verifying required binaries and files before snapshot

The purpose of `build.sh` is to ensure build sandboxes get the same baseline layout as agent sandboxes before the filesystem is snapshotted.

### `upgrade.sh`

`upgrade.sh` is the only in-place updater for a running sandbox.

It is invoked directly inside the sandbox, for example:

```bash
/opt/agentsandbox/agent-go/docker/upgrade.sh <commit-or-ref>
```

It owns:

- syncing the repo checkout to the target commit or ref
- syncing installed runtime files into their final locations
- rerunning runtime preparation
- regenerating runit service definitions
- restarting affected services
- writing commit and version markers

## Dockerfile

`agent-go/Dockerfile` should:

- point `ENTRYPOINT` directly at `/opt/agentsandbox/agent-go/docker/start.sh`
- keep scripts in the repo checkout and call them directly
- `chmod +x` the shell scripts after `COPY`
- stop referencing `entrypoint.sh`
- stop referencing `update-agent-go-source.sh`

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
- invoke `agent-go/docker/build.sh` inside the sandbox
- snapshot the filesystem
- return the built image id

It should stop assembling shell setup logic inline when that logic belongs in `build.sh`.

## State Model

Separate the sandbox into three kinds of state.

### Install state

- repo checkout under `/opt/agentsandbox`
- copied runtime files in final installed locations
- generated service definitions

### Runtime state

- directories under the runtime root
- pid files
- logs
- browser state scaffolding
- runit service tree
- commit and version markers

### User state

- workspace files
- user browser state, if preserved
- any persistent data the user owns

User state must stay outside the install tree.

## Version Tracking

Upgrade state should be recorded with marker files in runtime state.

Track at least:

- `current_source_commit`
- `installed_commit`
- `running_commit`

The target model is:

- `upgrade.sh` moves the source checkout to a target commit or ref
- `upgrade.sh` reconciles the sandbox to that version
- `upgrade.sh` records the successful applied version

## Upgrade Semantics

The meaning of upgrade is:

> Bring this running sandbox into conformance with target commit or ref `X`.

Upgrade does not:

- create a new sandbox
- preserve old script structure
- rely on scattered TypeScript shell snippets

Upgrade does:

- sync the repo checkout
- sync runtime-installed files
- rerun filesystem and runtime reconciliation
- restart the affected services
- write success markers

## Service Model

Runit remains the service supervisor.

`start.sh` generates the service tree.

`upgrade.sh` regenerates the service tree and restarts affected services.

The expected service set remains:

- `agent-server`
- `ui-stack`
- `openvscode-server`
- `openvscode-proxy`
- `dockerd`

depending on runtime mode and env.

## Design Rules

- `start.sh` is the only container entrypoint.
- `build.sh` is the only build sandbox convergence script.
- `upgrade.sh` is the only in-place sandbox updater.
- TypeScript selects lifecycle and version targets.
- Shell scripts own sandbox reconciliation.
- Build sandboxes and setup sandboxes must get the same baseline runtime layout as agent sandboxes.
- Runtime reconciliation logic should not be split across multiple shell fragments and inline TypeScript snippets.

## Follow-Up Work

- Update `agent-go/Dockerfile`
- Implement `agent-go/docker/start.sh`
- Implement `agent-go/docker/build.sh`
- Implement `agent-go/docker/upgrade.sh`
- Remove deleted scripts
- Update `agent-manager/src/services/sandbox.service.ts`
- Update `agent-manager/src/services/build.ts`
- Update tests and docs that reference `entrypoint.sh`
