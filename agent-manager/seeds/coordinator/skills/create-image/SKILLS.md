---
name: create-image
description: Use this skill when the user wants to create a brand new manager image from scratch, initialize its first variant, configure image secrets, open a setup sandbox, or run the first build. Do not use it when the user wants to clone an existing image; use the clone-image flow instead.
---

# Create Image

Use this skill for end-to-end image creation in AgentSandbox.

Primary user intents:

- "Create a new image"
- "Set up a fresh image from scratch"
- "Make me a new buildable image"
- "Create a new image, open a terminal, and let me customize it"
- "Create a new image and wire up build hooks/secrets"
- "Create an image for this GitHub repository"

Do not use this skill when:

- The user explicitly wants to clone/copy an existing image.
- The user only wants to rebuild or troubleshoot an existing image.
- The user only wants to create or manage agents from an existing image.

## GitHub-first default

Assume the user's code lives in a GitHub repository unless they clearly say otherwise.

If the repository URL is missing, ask exactly one short question:

- "What is the GitHub repository URL for this image?"

Do not ask broader setup questions unless the repo alone is not enough to proceed.

## What "create image" means in this system

Creating an image record does not build a new Modal image by itself.

`POST /images` creates:

- the image row
- a default shared variant named `Default`
- `defaultVariantId` pointing at that default variant

The actual runnable image pointers live on the variant:

- `activeImageId`: used for new agent sandboxes
- `draftImageId`: used for setup sandboxes and draft editing

After creation, the usual next step is one of:

1. Open a setup sandbox and customize the draft interactively.
2. Edit `/shared/image/hooks/build.sh` and run a build.
3. Set explicit `activeImageId` / `draftImageId` if the user already knows the base image to use.

## Default workflow

### 1. Create the image

Call:

- `POST /images`

Body:

```json
{
  "name": "my-image-name"
}
```

Minimum rule:

- `name` is required.

Only add these if the user explicitly needs them:

- `description`
- `activeImageId`
- `draftImageId`

If `activeImageId` is omitted, the default variant starts from the manager default base image.
If `draftImageId` is omitted, it defaults to the resolved `activeImageId`.

Important follow-up:

- The create response gives back the image, not the variant row.
- Immediately call `GET /images/{imageId}/variants` and capture the default variant id.

### 2. Inspect the first variant

Call:

- `GET /images/{imageId}/variants`

Expected result:

- one default shared variant
- use that variant id for setup sandbox, build, and default-selection flows

### 2.5. Request the GitHub repository URL if missing

In most image-creation flows, the next required input is the repository URL.

Ask for the repository URL when it was not already provided.

Accepted forms:

- `https://github.com/org/repo`
- `git@github.com:org/repo.git`

### 3. Choose the initialization path

#### Path A: interactive setup sandbox

Use when the user wants to:

- open a terminal
- clone repos manually
- install dependencies by hand
- edit files under `/home/agent` or `/shared/image`
- save a draft snapshot before promoting it

Calls:

1. `POST /images/{imageId}/setup-sandbox` with:

```json
{
  "variantId": "<default-variant-id>"
}
```

2. `POST /terminal/connect` with:

```json
{
  "targetType": "setupSandbox",
  "targetId": "<sandboxId>"
}
```

3. Only if the user needs SSH or SCP, enable SSH:

- `POST /images/{imageId}/setup-sandbox/{sandboxId}/ssh`

Body:

```json
{
  "sshPublicKeys": ["ssh-ed25519 AAAA..."]
}
```

4. Persist the edited draft:

- `DELETE /images/{imageId}/setup-sandbox/{sandboxId}`

Effect:

- snapshots the live sandbox filesystem
- writes the resulting image id to the variant `draftImageId`
- records a succeeded `setup-sandbox` build row
- does not change `activeImageId`

#### Path B: build-hook driven initialization

Use when the user wants a reproducible build flow.

The manager build flow executes `/shared/image/hooks/build.sh` when present.

Recommended order:

1. Create the image.
2. Open a setup sandbox for the default variant.
3. Write `/shared/image/hooks/build.sh` automatically from the GitHub repo URL.
4. Close the setup sandbox to persist shared-volume edits if needed.
5. Run `POST /images/{imageId}/build` with the variant id.

Build call:

- `POST /images/{imageId}/build`

Body:

```json
{
  "variantId": "<default-variant-id>"
}
```

If the caller wants logs, send `Accept: text/event-stream` and read:

- `status`
- `log`
- `result`
- `error`

Effect on success:

- creates a build row
- snapshots the build sandbox filesystem
- writes the built image id to both `activeImageId` and `draftImageId`

### 4. Configure image environment secrets only when needed

Skip this unless the build or runtime actually needs secrets.

If needed:

1. bind the secret name to the image:

- `PUT /images/{imageId}/environment-secrets`

Body:

```json
{
  "modalSecretName": "my-image-secret"
}
```

2. store values in Modal:

- `POST /images/{imageId}/modal-secrets`

Body:

```json
{
  "name": "my-image-secret",
  "env": {
    "API_KEY": "value",
    "TOKEN": "value"
  }
}
```

### 5. Finalize variant defaults only when needed

Usually the created image already has its first default variant set.

Useful follow-up calls:

- set global image default:
  - `POST /images/{imageId}/variants/{variantId}/default`
- set per-user default:
  - `POST /images/{imageId}/variants/{variantId}/user-default`

## Recommended end-to-end sequence for a completely new image

If the user says "create a completely new image from scratch", prefer this sequence:

1. `POST /images`
2. `GET /images/{imageId}/variants`
3. `POST /images/{imageId}/setup-sandbox`
4. connect terminal with `POST /terminal/connect`
5. create or edit:
   - `/shared/image/hooks/build.sh`
   - repo checkouts under `/home/agent/workspaces`
   - any shared image tools under `/shared/image`
6. `DELETE /images/{imageId}/setup-sandbox/{sandboxId}` to persist draft state
7. `POST /images/{imageId}/build` to produce the first reproducible built image
8. `GET /images/{imageId}/variants`
9. summarize:
   - `imageId`
   - default `variantId`
   - `draftImageId`
   - `activeImageId`

## Short version

Use this minimum flow by default:

1. If missing, ask for the GitHub repository URL.
2. `POST /images` with `{ "name": "..." }`
3. `GET /images/{imageId}/variants`
4. `POST /images/{imageId}/setup-sandbox` with `{ "variantId": "..." }`
5. `POST /terminal/connect` with `{ "targetType": "setupSandbox", "targetId": "..." }`
6. write `/shared/image/hooks/build.sh`
7. `DELETE /images/{imageId}/setup-sandbox/{sandboxId}`
8. `POST /images/{imageId}/build` with `{ "variantId": "..." }`
9. `GET /images/{imageId}/variants`

Only introduce secrets, SSH keys, explicit base image ids, or default-override APIs if the user asks for them.

## GitHub repository default `build.sh`

When the user gives a GitHub repository URL, do not leave `build.sh` as a placeholder. Write a concrete default script.

Replace:

- `__REPO_URL__` with the exact repository URL
- `__REPO_DIR__` with the repository directory name

Use this as an inspiration for `/shared/image/hooks/build.sh`. Adapt it to the structure of the repository so that you can better understand it.

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "${WORKSPACES_DIR:-/home/agent/workspaces}"

REPO_URL="__REPO_URL__"
REPO_DIR="__REPO_DIR__"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  git clone "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"
git fetch --all --prune
git reset --hard origin/HEAD || true

if [[ -f pnpm-lock.yaml ]]; then
  corepack enable
  pnpm install --frozen-lockfile || pnpm install
  [[ -f package.json ]] && pnpm run build || true
elif [[ -f yarn.lock ]]; then
  corepack enable
  yarn install --frozen-lockfile || yarn install
  [[ -f package.json ]] && yarn build || true
elif [[ -f package-lock.json || -f npm-shrinkwrap.json ]]; then
  npm ci || npm install
  [[ -f package.json ]] && npm run build || true
elif [[ -f bun.lockb || -f bun.lock ]]; then
  bun install
  [[ -f package.json ]] && bun run build || true
elif [[ -f pyproject.toml ]]; then
  python3 -m pip install --upgrade pip
  if grep -q "tool.poetry" pyproject.toml; then
    python3 -m pip install poetry
    poetry install
  else
    python3 -m pip install -e .
  fi
elif [[ -f requirements.txt ]]; then
  python3 -m pip install --upgrade pip
  python3 -m pip install -r requirements.txt
elif [[ -f Cargo.toml ]]; then
  cargo build
elif [[ -f go.mod ]]; then
  go mod download
  go build ./...
fi
```

Guidance:

- Prefer this script on the first pass for GitHub repos.
- If the repo has an obvious `README.md`, `Makefile`, `justfile`, workspace config, or framework-specific setup, adapt the script to match that repo instead of forcing the generic template.
- If the repo is a monorepo, update the script to build the specific package/app the user cares about.

## Response expectations

When completing this flow for a user, always report:

- created `imageId`
- chosen `variantId`
- whether a setup sandbox was created
- whether a build ran
- final `activeImageId`
- final `draftImageId`
- next concrete action if the image is still only partially initialized
