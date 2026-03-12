# Agent Image Versioning & Upgrade Specification

> Status update (2026-03-05):
> The runtime now calls `/opt/agentsandbox/agent-go/build-artifacts/agent-server`
> directly. Source sync
> via `agent-go-update-source` happens during the build flow, not on sandbox startup.
> This document still captures the previous release-infrastructure proposal and
> should be treated as historical design context rather than the active rollout plan.

## Overview

This document specifies how agent-go and platform components are upgraded across different user scenarios.

## Design Goal

**Users should NEVER need to re-do interactive setup work to receive platform updates.**

When a user has done interactive work via "Activate Shell" (OAuth, credentials, manual installs), and we ship a new agent-go version, the upgrade should be **automatic** and **preserve all their work**.

---

# AS-IS (Current State)

## Current Architecture

### Data Model

```
images
├── id
├── defaultVariantId
└── createdBy

imageVariants
├── id
├── imageId              # Parent image
├── baseImageId          # Registry ref OR Modal im-* (INPUT to builds)
├── headBuildId          # Points to latest successful build
└── ownerUserId

imageVariantBuilds
├── id
├── variantId
├── status               # running | succeeded | failed
├── inputPayload         # { imageId, variantId, baseImageId, environmentSecretNames, ... }
├── outputImageId        # Modal im-* (OUTPUT of build) = latest draftImageId
└── ...

agents
├── id
├── imageId
├── imageVariantId
├── snapshotImageId      # Runtime state snapshot
└── ...
```

### Current Image Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  REGISTRY IMAGE (ghcr.io/suhjohn/agent:latest)                              │
│  • agent-go binary, runit services, Chromium, noVNC, OpenVSCode, tools      │
│  • Used when variant.baseImageId is null                                    │
│  • Effective ref is AGENT_BASE_IMAGE_REF (fallback: ghcr.io/suhjohn/agentsandbox:latest) │
│  • Build may resolve tag → digest                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 │                                         │
                 ▼                                         ▼
┌────────────────────────────────┐       ┌────────────────────────────────────┐
│  DIRECT USE                    │       │  "ACTIVATE SHELL" FLOW             │
│  baseImageId = null            │       │  1. Opens setup sandbox from base  │
│  OR registry ref               │       │  2. User runs interactive commands │
│                                │       │  3. Snapshot → sets baseImageId    │
│                                │       │     to Modal im-* (REPLACES base)  │
└────────────────────────────────┘       └────────────────────────────────────┘
                 │                                         │
                 └────────────────────┬────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BASE IMAGE (variant.baseImageId)                                           │
│  • INPUT to build process                                                   │
│  • Can be: null, registry ref, OR Modal im-* (from shell snapshot)          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                              ┌───────┴───────┐
                              │    BUILD      │
                              │ baseImageId + │
                              │ /shared/image-hooks/build.sh │
                              └───────┬───────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  DRAFT IMAGE (variant.draftImageId)                                         │
│  • OUTPUT of build process / setup sandbox snapshot (Modal im-*)            │
│  • Used for future builds and setup sandboxes                               │
│  • Distinct from activeImageId, which creates new agent sandboxes           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  SNAPSHOT IMAGE (agent.snapshotImageId) - optional                          │
│  • Runtime state of a running sandbox                                       │
│  • Tried FIRST when recreating sandbox (before activeImageId)               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Current Files

| File                                            | Purpose                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `agent-manager/src/db/schema.ts`                | Data model definitions                                                               |
| `agent-manager/src/services/image.service.ts`   | Image/variant CRUD, build orchestration                                              |
| `agent-manager/src/services/build.ts`           | Modal sandbox build execution                                                        |
| `agent-manager/src/services/sandbox.service.ts` | Sandbox creation, setup shell, snapshots                                             |
| `agent-go/cmd/agent-go/main.go`                 | CLI entry point (`serve`, `openvscode-proxy`)                                        |
| `agent-go/internal/server/serve.go`             | HTTP server routes (includes `/health`)                                              |
| `agent-go/internal/openapi/openapi.json`        | OpenAPI contract served by `/openapi.json`                                           |
| `agent-go/Dockerfile`                           | Base runtime image build (writes `/etc/agent-image-version`)                         |
| `agent-go/docker/start.sh`                      | Runtime env setup and service bootstrap (exports `AGENT_IMAGE_VERSION`, starts services) |
| `agent-go/scripts/dev.sh`                       | Unified local workflow script for agent-go build, restart, Docker, and publish flows |

### Current Limitations

1. **No version tracking** - agent-go binary has no embedded version (image builds do write `/etc/agent-image-version` via `AGENT_IMAGE_VERSION`, but that is not the agent-go binary version)
2. **No upgrade mechanism** - No way to update agent-go without rebuilding image
3. **Pinned baseImageId problem** - If user did "Activate Shell", their baseImageId is a Modal im-\* snapshot that contains old agent-go. Clicking "Build" still uses old base.

### Current Upgrade Path (Manual)

| User Scenario                              | To Get New Agent-Go                         |
| ------------------------------------------ | ------------------------------------------- |
| Uses default base                          | Click "Build" (picks up new registry image) |
| Used "Activate Shell" (pinned baseImageId) | ❌ Must re-do interactive setup on new base |
| Running sandbox                            | ❌ Must recreate from new activeImageId     |

**The "re-do Activate Shell" requirement is the anti-pattern we want to eliminate.**

---

# TO-BE (Proposed Changes)

## New Architecture

### Agent-Go Versioning

Add version package and CLI command:

```
agent-go/
├── internal/
│   └── version/
│       └── version.go      # NEW: Version, GitCommit, BuildTime vars
├── cmd/
│   └── agent-go/
│       └── main.go         # MODIFY: Add "version" command
└── scripts/
    └── dev.sh                 # MODIFY: Inject version via ldflags in build-server flow
```

**agent-go/internal/version/version.go:**

```go
package version

var (
    Version   = "dev"
    GitCommit = "unknown"
    BuildTime = "unknown"
)
```

**Build with ldflags:**

```bash
VERSION="1.2.3"
GIT_COMMIT=$(git rev-parse --short HEAD)
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

LDFLAGS="-s -w"
LDFLAGS="$LDFLAGS -X agent-go/internal/version.Version=$VERSION"
LDFLAGS="$LDFLAGS -X agent-go/internal/version.GitCommit=$GIT_COMMIT"
LDFLAGS="$LDFLAGS -X agent-go/internal/version.BuildTime=$BUILD_TIME"

go build -ldflags="$LDFLAGS" -o agent-server ./cmd/agent-go
```

**New CLI commands:**

```bash
$ agent-server version
1.2.3 (abc1234) built 2025-01-15T10:30:00Z

$ agent-server --version
1.2.3
```

**Health endpoint includes version:**

```json
GET /health
{
  "status": "ok",
  "version": "1.2.3",
  "commit": "abc1234"
}
```

### Release Infrastructure

Host upgrade scripts and binaries:

```
https://releases.example.com/agent/
├── latest-version              # Plain text: "1.2.3"
├── upgrade.sh                  # Entry point → fetches latest version's script
├── common/
│   └── lib.sh                  # Shared upgrade functions
├── 1.2.3/
│   ├── agent-server-linux-amd64
│   ├── agent-server-linux-arm64
│   ├── upgrade.sh              # Version-specific upgrade logic
│   ├── checksums.txt
│   └── CHANGELOG.md
└── 1.2.2/
    └── ...
```

### Upgrade Scripts

**Root upgrade.sh (entry point):**

```bash
#!/bin/bash
set -e
RELEASES_URL="${AGENT_RELEASES_URL:-https://releases.example.com/agent}"
LATEST=$(curl -fsSL "$RELEASES_URL/latest-version")
exec bash <(curl -fsSL "$RELEASES_URL/$LATEST/upgrade.sh")
```

**common/lib.sh (shared functions):**

```bash
#!/bin/bash

get_arch() {
  case "$(uname -m)" in
    x86_64)  echo "amd64" ;;
    aarch64) echo "arm64" ;;
    *)       echo "Unsupported: $(uname -m)" >&2; exit 1 ;;
  esac
}

backup_create() {
  local dir="/tmp/agent-backup-$(date +%s)"
  mkdir -p "$dir"
  cp /app/agent-server "$dir/" 2>/dev/null || true
  cp -a /opt/novnc "$dir/" 2>/dev/null || true
  echo "$dir"
}

backup_restore() {
  local dir="$1"
  cp "$dir/agent-server" /app/agent-server 2>/dev/null || true
  [ -d "$dir/novnc" ] && cp -a "$dir/novnc" /opt/novnc
}

install_binary() {
  local url="$1"
  curl -fsSL "$url" -o /tmp/agent-server-new
  chmod +x /tmp/agent-server-new
  /tmp/agent-server-new version >/dev/null 2>&1 || { rm -f /tmp/agent-server-new; return 1; }
  mv /tmp/agent-server-new /app/agent-server
}

apt_install() {
  [ $# -eq 0 ] && return
  apt-get update -qq && apt-get install -y "$@"
}

install_tarball() {
  local url="$1" dest="$2"
  rm -rf "$dest.new" && mkdir -p "$dest.new"
  curl -fsSL "$url" | tar -xz --strip-components=1 -C "$dest.new"
  rm -rf "$dest.old"
  [ -d "$dest" ] && mv "$dest" "$dest.old"
  mv "$dest.new" "$dest"
  rm -rf "$dest.old"
}

restart_services() {
  for svc in "$@"; do
    sv restart "$svc" 2>/dev/null || supervisorctl restart "$svc" 2>/dev/null || true
  done
}

version_lt() {
  [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$1" ] && [ "$1" != "$2" ]
}
```

**Version-specific 1.2.3/upgrade.sh:**

```bash
#!/bin/bash
set -e

VERSION="1.2.3"
RELEASES_URL="${AGENT_RELEASES_URL:-https://releases.example.com/agent}"

source <(curl -fsSL "$RELEASES_URL/common/lib.sh")

CURRENT=$(cat /etc/agent-version 2>/dev/null || echo "0.0.0")
[ "$CURRENT" = "$VERSION" ] && echo "Already at $VERSION" && exit 0

echo "Upgrading: $CURRENT → $VERSION"

BACKUP=$(backup_create)
trap "backup_restore '$BACKUP'; exit 1" ERR

# Agent binary
install_binary "$RELEASES_URL/$VERSION/agent-server-linux-$(get_arch)"

# Dependencies for this version
apt_install uv ripgrep

# Platform components
install_tarball "https://github.com/novnc/noVNC/archive/v1.4.0.tar.gz" /opt/novnc

# Migrations
if version_lt "$CURRENT" "1.2.0"; then
  mv /etc/agent/old.conf /etc/agent/config.toml 2>/dev/null || true
fi

echo "$VERSION" > /etc/agent-version
restart_services agent-server novnc openvscode
rm -rf "$BACKUP"

echo "Upgraded to $VERSION"
```

### Build.ts Integration

Inject upgrade preamble into every build:

```typescript
// agent-manager/src/services/build.ts

const UPGRADE_PREAMBLE = `
#!/bin/bash
set -e

echo "[upgrade] Running upgrade check..."
curl -fsSL "\${AGENT_RELEASES_URL:-https://releases.example.com/agent}/upgrade.sh" | bash || {
  echo "[upgrade] Upgrade failed or unavailable, continuing..."
}
echo "[upgrade] Starting image build hook..."
`.trim();

// In runModalImageBuild():
// execute /shared/image-hooks/build.sh when present
```

### New Upgrade Paths

| User Scenario                              | To Get New Agent-Go                      |
| ------------------------------------------ | ---------------------------------------- |
| Uses default base                          | Click "Build" ✅                         |
| Used "Activate Shell" (pinned baseImageId) | Click "Build" ✅ (upgrade.sh runs first) |
| Running sandbox                            | Run `curl upgrade.sh \| bash` ✅         |

**All scenarios now work without re-doing interactive setup.**

---

## Comparison

| Aspect                  | AS-IS                          | TO-BE                         |
| ----------------------- | ------------------------------ | ----------------------------- |
| Version in binary       | ❌ None                        | ✅ Embedded via ldflags       |
| Version command         | ❌ None                        | ✅ `agent-server version`     |
| Version in /health      | ❌ None                        | ✅ Included                   |
| Upgrade pinned base     | ❌ Re-do Activate Shell        | ✅ Automatic via upgrade.sh   |
| Upgrade running sandbox | ❌ Recreate                    | ✅ In-place via upgrade.sh    |
| Platform components     | ❌ Stuck on build-time version | ✅ Upgradeable via upgrade.sh |

---

## Implementation Checklist

### Phase 1: Agent-Go Versioning

- [ ] Create `agent-go/internal/version/version.go`
- [ ] Add `version` command to CLI
- [ ] Update build script with ldflags
- [ ] Add version to `/health` endpoint
- [ ] Write `/etc/agent-image-version` in Dockerfile

### Phase 2: Release Infrastructure

- [ ] Set up releases CDN (S3/R2/GCS)
- [ ] Create `common/lib.sh`
- [ ] Create root `upgrade.sh`
- [ ] Create first version-specific upgrade script
- [ ] Set up CI to build and upload on tag

### Phase 3: Build Integration

- [ ] Add upgrade preamble to `build.ts`
- [ ] Test builds with pinned baseImageId get upgraded

### Phase 4: Sandbox Upgrade API

- [ ] Add `POST /api/sandboxes/:id/upgrade` endpoint
- [ ] Execute upgrade.sh inside running sandbox

### Phase 5: Automation (Future)

- [ ] Periodic rebuild cronjob
- [ ] "Update available" UI badge
