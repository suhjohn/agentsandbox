import { createHash } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import {
  canUserAccessImageVariant,
  createImageVariantBuild,
  DEFAULT_VARIANT_IMAGE_REF,
  getImageById,
  getImageVariantForImage,
  getVariantDraftImageId,
  setImageVariantDraftImageId,
} from "./image.service";
import { log } from "../log";
import {
  assembleSandboxSecrets,
  buildSandboxRuntimeAccess,
  buildTerminalAccess,
  buildStandardSandboxEnv,
  createModalSandbox,
  describeUnknownError,
  execSandboxCommand,
  getImageHooksMount,
  modalClient,
  normalizeRegions,
  normalizeSetupSandboxSshKeys,
  provisionSandboxSshAccess,
  resolveModalImage,
  safeTerminateSandbox,
  SANDBOX_NOVNC_PORT,
  SANDBOX_OPENVSCODE_PORT,
  SANDBOX_RUNTIME_API_PORT,
  SANDBOX_SSH_PORT,
  SandboxRegion,
  SandboxRuntimeAccess,
  SetupSandboxSshAccess,
  TerminalAccess,
  snapshotSandboxFilesystem,
  STANDARD_RUNTIME_COMMAND,
  STANDARD_SANDBOX_IDLE_TIMEOUT_MS,
  STANDARD_SANDBOX_TIMEOUT_MS,
  waitForSandboxReady,
  waitForSandboxTunnels,
} from "./sandbox-core";

type ImageSetupSandboxSession = {
  readonly sandboxId: string;
  readonly imageId: string;
  readonly variantId: string;
  readonly userId: string;
  readonly sandboxAccessToken?: string;
  readonly sshAuthorizedPublicKeys: readonly string[];
  readonly sshAccess: SetupSandboxSshAccess | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type SetupSandboxSshStatus = {
  readonly authorizedPublicKeys: readonly string[];
  readonly ssh: SetupSandboxSshAccess | null;
};

export type CreateSetupSandboxResult = {
  readonly sandboxId: string;
  readonly variantId: string;
  readonly draftImageId: string;
  readonly authorizedPublicKeys: readonly string[];
  readonly ssh: SetupSandboxSshAccess | null;
};

export type CloseSetupSandboxResult = {
  readonly baseImageId: string;
  readonly draftImageId: string;
  readonly variantId: string;
};

const SETUP_APP_NAME = "image-builder";
const SETUP_SECRET_NAME = "openinspect-build-secret";
const SETUP_SNAPSHOT_TIMEOUT_MS = 10 * 60 * 1000;
const SETUP_PRE_SNAPSHOT_CHOWN_TIMEOUT_MS = 60_000;
const IMAGE_SETUP_SANDBOXES = new Map<string, ImageSetupSandboxSession>();

function setupSandboxSubjectId(imageId: string): string {
  return `setup-${imageId}`;
}

function toSetupSandboxSshStatus(
  session: ImageSetupSandboxSession,
): SetupSandboxSshStatus {
  return {
    authorizedPublicKeys: [...session.sshAuthorizedPublicKeys],
    ssh: session.sshAccess,
  };
}

async function buildSetupSshAccess(input: {
  readonly sandboxId: string;
  readonly sandbox: Awaited<ReturnType<typeof modalClient.sandboxes.fromId>>;
  readonly publicKeys: readonly string[];
}): Promise<SetupSandboxSshAccess> {
  const sshMetadata = await provisionSandboxSshAccess({
    sandbox: input.sandbox,
    publicKeys: input.publicKeys,
  });
  const tunnels = await waitForSandboxTunnels({
    sandboxId: input.sandboxId,
    ports: [SANDBOX_SSH_PORT],
    unencryptedPorts: [SANDBOX_SSH_PORT],
  });
  const tunnel = tunnels.get(SANDBOX_SSH_PORT)!;
  return {
    username: "root",
    host: tunnel.host,
    port: tunnel.port,
    hostPublicKey: sshMetadata.hostPublicKey,
    hostKeyFingerprint: sshMetadata.hostKeyFingerprint,
    knownHostsLine: `[${tunnel.host}]:${tunnel.port} ${sshMetadata.hostPublicKey}`,
  };
}

export function getImageSetupSandboxSession(input: {
  readonly sandboxId: string;
}): ImageSetupSandboxSession | null {
  const sandboxId = input.sandboxId.trim();
  if (sandboxId.length === 0) return null;
  return IMAGE_SETUP_SANDBOXES.get(sandboxId) ?? null;
}

export async function createSetupSandboxSession(input: {
  readonly imageId: string;
  readonly variantId: string;
  readonly userId: string;
  readonly region?: SandboxRegion;
  readonly sshPublicKeys?: readonly string[];
}): Promise<CreateSetupSandboxResult> {
  const image = await getImageById(input.imageId);
  if (!image) throw new Error("Image not found");

  const variant = await getImageVariantForImage({
    imageId: input.imageId,
    variantId: input.variantId,
  });
  if (!variant || !canUserAccessImageVariant({ userId: input.userId, variant })) {
    throw new Error("Image variant not found");
  }

  const normalizedDraftImageId = getVariantDraftImageId(variant);
  const sshPublicKeys = normalizeSetupSandboxSshKeys(input.sshPublicKeys);
  const shouldEnableSsh = sshPublicKeys.length > 0;
  const sandboxAccessToken = crypto.randomUUID();
  const envVars = await buildStandardSandboxEnv({
    subjectId: setupSandboxSubjectId(input.imageId),
    sandboxAccessToken,
  });
  const secrets = await assembleSandboxSecrets({
    envVars,
    namedSecretNames: [SETUP_SECRET_NAME],
  });

  let handle;
  try {
    const { image: modalImage, resolvedImageSource } = await resolveModalImage({
      imageIdOrRef: normalizedDraftImageId || DEFAULT_VARIANT_IMAGE_REF,
    });
    handle = await createModalSandbox({
      appName: SETUP_APP_NAME,
      image: modalImage,
      command: STANDARD_RUNTIME_COMMAND,
      secrets,
      volumes: await getImageHooksMount({
        imageId: input.imageId,
        readOnly: false,
      }),
      encryptedPorts: [
        SANDBOX_RUNTIME_API_PORT,
        SANDBOX_OPENVSCODE_PORT,
        SANDBOX_NOVNC_PORT,
      ],
      unencryptedPorts: [SANDBOX_SSH_PORT],
      timeoutMs: STANDARD_SANDBOX_TIMEOUT_MS,
      idleTimeoutMs: STANDARD_SANDBOX_IDLE_TIMEOUT_MS,
      regions: normalizeRegions(input.region),
      experimentalOptions: { enable_docker: true },
    });
    await waitForSandboxReady({
      sandboxId: handle.sandboxId,
      runtimePort: SANDBOX_RUNTIME_API_PORT,
      openVscodePort: SANDBOX_OPENVSCODE_PORT,
      noVncPort: SANDBOX_NOVNC_PORT,
    });
    let sshAccess: SetupSandboxSshAccess | null = null;
    if (shouldEnableSsh) {
      sshAccess = await buildSetupSshAccess({
        sandboxId: handle.sandboxId,
        sandbox: handle.sandbox,
        publicKeys: sshPublicKeys,
      });
    }

    const session: ImageSetupSandboxSession = {
      sandboxId: handle.sandboxId,
      imageId: input.imageId,
      variantId: input.variantId,
      userId: input.userId,
      sandboxAccessToken,
      sshAuthorizedPublicKeys: [...sshPublicKeys],
      sshAccess,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    IMAGE_SETUP_SANDBOXES.set(handle.sandboxId, session);

    return {
      sandboxId: handle.sandboxId,
      variantId: input.variantId,
      draftImageId: normalizedDraftImageId || resolvedImageSource,
      authorizedPublicKeys: [...sshPublicKeys],
      ssh: sshAccess,
    };
  } catch (err) {
    if (handle) await safeTerminateSandbox(handle);
    log.error("Setup sandbox create failed", {
      imageId: input.imageId,
      variantId: input.variantId,
      error: err,
    });
    throw new Error(
      `Setup sandbox create failed: ${describeUnknownError(err)}`,
    );
  }
}

export async function getSetupSandboxRuntimeAccess(input: {
  readonly userId: string;
  readonly sandboxId: string;
  readonly authTtlSeconds?: number;
}): Promise<SandboxRuntimeAccess> {
  const sandboxId = input.sandboxId.trim();
  if (sandboxId.length === 0) throw new Error("sandboxId is required");
  const session = IMAGE_SETUP_SANDBOXES.get(sandboxId);
  if (!session) {
    throw new HTTPException(404, { message: "Setup sandbox not found" });
  }
  if (session.userId !== input.userId) {
    throw new HTTPException(404, { message: "Setup sandbox not found" });
  }
  IMAGE_SETUP_SANDBOXES.set(sandboxId, { ...session, updatedAt: Date.now() });
  const urls = await waitForSandboxReady({
    sandboxId,
    runtimePort: SANDBOX_RUNTIME_API_PORT,
    openVscodePort: SANDBOX_OPENVSCODE_PORT,
    noVncPort: SANDBOX_NOVNC_PORT,
  });
  return await buildSandboxRuntimeAccess({
    sandboxId,
    runtimeBaseUrl: urls.runtimeBaseUrl,
    openVscodeBaseUrl: urls.openVscodeBaseUrl,
    noVncBaseUrl: urls.noVncBaseUrl,
    sandboxAccessToken: session.sandboxAccessToken ?? sandboxId,
    userId: input.userId,
    subjectId: setupSandboxSubjectId(session.imageId),
    sessionId: `setup-${sandboxId}`,
    authTtlSeconds: input.authTtlSeconds,
    ssh: session.sshAccess,
  });
}

export async function getSetupSandboxTerminalAccess(input: {
  readonly userId: string;
  readonly sandboxId: string;
  readonly authTtlSeconds?: number;
}): Promise<TerminalAccess> {
  const access = await getSetupSandboxRuntimeAccess(input);
  return buildTerminalAccess({
    sandboxId: access.sandboxId,
    baseUrl: access.runtime.baseUrl,
    authToken: access.terminal.authToken,
    authTokenExpiresInSeconds: access.terminal.authExpiresInSeconds,
  });
}

export async function upsertSetupSandboxSshAccess(input: {
  readonly userId: string;
  readonly sandboxId: string;
  readonly sshPublicKeys: readonly string[];
}): Promise<SetupSandboxSshStatus> {
  const sandboxId = input.sandboxId.trim();
  if (sandboxId.length === 0) throw new Error("sandboxId is required");
  const session = IMAGE_SETUP_SANDBOXES.get(sandboxId);
  if (!session || session.userId !== input.userId) {
    throw new HTTPException(404, { message: "Setup sandbox not found" });
  }
  const mergedPublicKeys = normalizeSetupSandboxSshKeys([
    ...session.sshAuthorizedPublicKeys,
    ...input.sshPublicKeys,
  ]);
  if (mergedPublicKeys.length === 0) {
    throw new Error("At least one SSH public key is required");
  }
  const sandbox = await modalClient.sandboxes.fromId(sandboxId);
  const sshAccess = await buildSetupSshAccess({
    sandboxId,
    sandbox,
    publicKeys: mergedPublicKeys,
  });
  const updatedSession: ImageSetupSandboxSession = {
    ...session,
    sshAuthorizedPublicKeys: mergedPublicKeys,
    sshAccess,
    updatedAt: Date.now(),
  };
  IMAGE_SETUP_SANDBOXES.set(sandboxId, updatedSession);
  return toSetupSandboxSshStatus(updatedSession);
}

export async function finalizeSetupSandboxSession(input: {
  readonly userId: string;
  readonly sandboxId: string;
}): Promise<CloseSetupSandboxResult> {
  const sandboxId = input.sandboxId.trim();
  if (sandboxId.length === 0) throw new Error("sandboxId is required");
  const session = IMAGE_SETUP_SANDBOXES.get(sandboxId);
  if (!session) {
    throw new HTTPException(404, { message: "Setup sandbox not found" });
  }
  if (session.userId !== input.userId) {
    throw new HTTPException(404, { message: "Setup sandbox not found" });
  }

  const variant = await getImageVariantForImage({
    imageId: session.imageId,
    variantId: session.variantId,
  });
  if (!variant) {
    throw new Error("Image variant not found for setup sandbox session");
  }

  const baseImageId = getVariantDraftImageId(variant);
  const sandbox = await modalClient.sandboxes.fromId(sandboxId);
  const normalizeOwnershipResult = await execSandboxCommand({
    sandbox,
    command: [
      "bash",
      "-lc",
      [
        "set -euo pipefail",
        "if id -u agent >/dev/null 2>&1 && [[ -d /home/agent ]]; then",
        "  chown -R agent:agent /home/agent",
        "fi",
      ].join("\n"),
    ],
    timeoutMs: SETUP_PRE_SNAPSHOT_CHOWN_TIMEOUT_MS,
  });
  if (normalizeOwnershipResult.exitCode !== 0) {
    throw new Error(
      `Failed to normalize setup sandbox ownership before snapshot (exit ${
        normalizeOwnershipResult.exitCode
      }): ${
        normalizeOwnershipResult.stderr.trim() ||
        normalizeOwnershipResult.stdout.trim() ||
        "unknown error"
      }`,
    );
  }

  const snapshotImageId = await snapshotSandboxFilesystem({
    sandbox,
    timeoutMs: SETUP_SNAPSHOT_TIMEOUT_MS,
    missingImageMessage: "Snapshot did not return an image id.",
  });

  const buildInputPayload = {
    imageId: session.imageId,
    variantId: session.variantId,
    source: "setup-sandbox",
    setupSandboxId: sandboxId,
    baseImageId,
  } as const;
  const inputHash = createHash("sha256")
    .update(JSON.stringify(buildInputPayload))
    .digest("hex");

  await createImageVariantBuild({
    imageId: session.imageId,
    variantId: session.variantId,
    requestedByUserId: input.userId,
    status: "succeeded",
    inputHash,
    inputPayload: buildInputPayload as unknown as Record<string, unknown>,
    logs: "",
    outputImageId: snapshotImageId,
    errorMessage: null,
    finishedAt: new Date(),
  });

  const updatedVariant = await setImageVariantDraftImageId({
    variantId: session.variantId,
    draftImageId: snapshotImageId,
  });
  if (!updatedVariant) {
    throw new Error("Image variant not found for setup sandbox session");
  }

  await safeTerminateSandbox(sandbox);
  IMAGE_SETUP_SANDBOXES.delete(sandboxId);

  return {
    baseImageId,
    draftImageId: snapshotImageId,
    variantId: session.variantId,
  };
}

export const createSetupSandbox = createSetupSandboxSession;
export const closeSetupSandbox = finalizeSetupSandboxSession;
