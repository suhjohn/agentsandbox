---
name: open-setup-sandbox
description: Use this skill when the user wants an interactive setup sandbox for an image variant so they can inspect, customize, edit, or prepare a draft image before building.
---

# Open Setup Sandbox

Use this skill for the interactive image-customization flow.

Primary user intents:

- "Open a setup sandbox for this image"
- "Give me a terminal into the image draft"
- "Let me customize the image interactively"
- "Open the setup environment for variant X"
- "Prepare a draft before building"

Do not use this skill when:

- The user wants to create a fresh image record from scratch. Use `create-image`.
- The user wants a reproducible build kicked off immediately without interactive setup. Use the build flow instead.
- The user wants runtime access to an existing agent sandbox. Use `connect-to-agent-runtime`.

## What this flow does

`POST /images/{imageId}/setup-sandbox` creates a temporary setup sandbox attached to an image variant's draft filesystem.

That sandbox is for:

- editing files
- cloning repositories
- installing packages
- preparing hooks or shared assets

Persisting the setup changes happens when the sandbox is closed with:

- `DELETE /images/{imageId}/setup-sandbox/{sandboxId}`

## Default workflow

### 1. Resolve the image and variant

Start by resolving the target image.

Call:

- `GET /images`

Then inspect variants:

- `GET /images/{imageId}/variants`

Rules:

- If the user named a specific variant, match it exactly.
- Otherwise default to the image's default/shared variant.
- Ask a short follow-up only if multiple plausible variants exist and the intended one is unclear.

### 2. Create the setup sandbox

Call:

- `POST /images/{imageId}/setup-sandbox`

Body:

```json
{
  "variantId": "<variant-uuid>"
}
```

Capture:

- `sandboxId`
- any returned metadata needed for follow-up calls

### 3. Open terminal access immediately

After the setup sandbox exists, call:

- `POST /terminal/connect`

Body:

```json
{
  "targetType": "setupSandbox",
  "targetId": "<sandboxId>"
}
```

Report the resulting terminal connection info clearly.

### 4. Enable SSH only when the user explicitly needs it

If the user asked for SSH access or key injection, call:

- `POST /images/{imageId}/setup-sandbox/{sandboxId}/ssh`

Only do this when the user has provided public keys or explicitly asked for the SSH flow.

### 5. Explain persistence semantics

Always state that:

- the setup sandbox is temporary
- draft changes are persisted only when the setup sandbox is closed through the manager API
- closing the setup sandbox snapshots the edited draft image

## Response expectations

Always report:

- `imageId`
- `variantId`
- `sandboxId`
- terminal access information
- whether SSH was enabled
- the next step to persist the draft when the user is done

## Optional follow-up

If the user's request implies they want the sandbox visible in the workspace, open or focus the relevant agent/session panel only when there is a corresponding runtime surface. Otherwise just return the access details cleanly.
