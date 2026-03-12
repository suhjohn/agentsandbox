import { HTTPException } from "hono/http-exception";
import { createApiKey } from "./api-key.service";
import {
  clearAgentSandboxIfMatches,
  getAgentAccessToken,
  getAgentById,
  setAgentSandbox,
} from "./agent.service";
import {
  DEFAULT_VARIANT_IMAGE_REF,
  getImageByIdIncludingArchived,
  getVariantActiveImageId,
  listEnvironmentSecrets,
  resolveImageVariantForUser,
} from "./image.service";
import { withLock } from "./lock.service";
import { DEFAULT_REGION } from "../utils/region";
import {
  assembleSandboxSecrets,
  buildSandboxRuntimeAccess,
  buildStandardSandboxEnv,
  createModalSandbox,
  describeUnknownError,
  fetchSandboxHealthOk,
  getImageHooksMount,
  isSandboxAlive,
  modalClient,
  normalizeRegions,
  normalizeSecretNames,
  resolveModalImage,
  SANDBOX_HEALTH_RETRY_MS,
  SANDBOX_HEALTH_TIMEOUT_MS,
  SandboxHandle,
  SandboxRegion,
  SandboxRuntimeAccess,
  SANDBOX_NOVNC_PORT,
  SANDBOX_OPENVSCODE_PORT,
  SANDBOX_RUNTIME_API_PORT,
  snapshotSandboxFilesystem,
  sleepMs,
  STANDARD_RUNTIME_COMMAND,
  STANDARD_SANDBOX_IDLE_TIMEOUT_MS,
  STANDARD_SANDBOX_TIMEOUT_MS,
  terminateSandbox,
  waitForSandboxReady,
} from "./sandbox-core";

const AGENT_ID_TO_SANDBOX = new Map<string, SandboxHandle["sandbox"]>();
const AGENT_SANDBOX_APP_NAME = "agent-sandboxes";
const DEFAULT_MODAL_SECRET_NAME = "openinspect-build-secret";
const SESSION_SANDBOX_CREATE_LOCK_WAIT_MS = 5 * 60 * 1000;
const SESSION_SANDBOX_CREATE_LOCK_TTL_MS = 60 * 1000;

export function agentIdToSandboxName(agentId: string): string {
  return `agent-sandbox-${agentId.replace(/-/g, "")}`;
}

export function agentIdToAgentSessionId(agentId: string): string {
  return agentId.replace(/-/g, "");
}

async function getRuntimeUrls(sandboxId: string): Promise<{
  readonly runtimeBaseUrl: string;
  readonly openVscodeBaseUrl: string;
  readonly noVncBaseUrl: string;
}> {
  const urls = await waitForSandboxReady({
    sandboxId,
    runtimePort: SANDBOX_RUNTIME_API_PORT,
    openVscodePort: SANDBOX_OPENVSCODE_PORT,
    noVncPort: SANDBOX_NOVNC_PORT,
  });
  return {
    runtimeBaseUrl: urls.runtimeBaseUrl,
    openVscodeBaseUrl: urls.openVscodeBaseUrl!,
    noVncBaseUrl: urls.noVncBaseUrl!,
  };
}

async function createAgentSandbox(input: {
  readonly agentId: string;
  readonly imageId: string;
  readonly region?: SandboxRegion;
}): Promise<SandboxHandle> {
  const agent = await getAgentById(input.agentId);
  if (!agent) throw new Error("Agent not found");
  if (typeof agent.createdBy !== "string" || agent.createdBy.length === 0) {
    throw new HTTPException(409, { message: "Agent owner is missing" });
  }
  const imageRecord = await getImageByIdIncludingArchived(agent.imageId!);
  if (!imageRecord) throw new HTTPException(404, { message: "Image not found" });

  const sandboxAccessToken = await getAgentAccessToken(input.agentId);
  const { key: managerApiKey } = await createApiKey({
    userId: agent.createdBy,
    agentId: input.agentId,
    name: `sandbox-${input.agentId}`,
    scopes: ["*"],
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const envVars = await buildStandardSandboxEnv({
    subjectId: input.agentId,
    sandboxAccessToken,
    managerApiKey,
  });
  const environmentSecretNames = normalizeSecretNames(
    (await listEnvironmentSecrets(agent.imageId!)).map(
      (binding) => binding.modalSecretName,
    ),
  ).filter((name) => name !== DEFAULT_MODAL_SECRET_NAME);
  const secrets = await assembleSandboxSecrets({
    envVars,
    namedSecretNames: [DEFAULT_MODAL_SECRET_NAME],
    environmentSecretNames,
    includeProviderApiKeys: true,
  });
  const { image } = await resolveModalImage({ imageIdOrRef: input.imageId });
  const handle = await createModalSandbox({
    appName: AGENT_SANDBOX_APP_NAME,
    image,
    command: STANDARD_RUNTIME_COMMAND,
    secrets,
    volumes: await getImageHooksMount({
      imageId: agent.imageId!,
      readOnly: true,
    }),
    encryptedPorts: [
      SANDBOX_RUNTIME_API_PORT,
      SANDBOX_OPENVSCODE_PORT,
      SANDBOX_NOVNC_PORT,
    ],
    timeoutMs: STANDARD_SANDBOX_TIMEOUT_MS,
    idleTimeoutMs: STANDARD_SANDBOX_IDLE_TIMEOUT_MS,
    regions: normalizeRegions(input.region),
    experimentalOptions: { enable_docker: true },
  });

  await getRuntimeUrls(handle.sandboxId);
  await setAgentSandbox({
    id: input.agentId,
    currentSandboxId: handle.sandboxId,
  });
  AGENT_ID_TO_SANDBOX.set(input.agentId, handle.sandbox);
  return handle;
}

export async function getAgentSandbox(input: {
  readonly agentId: string;
}): Promise<SandboxHandle> {
  const agentId = input.agentId.trim();
  if (agentId.length === 0) throw new Error("agentId is required");
  const agent = await getAgentById(agentId);
  if (!agent) throw new Error("Agent not found");
  if (!agent.currentSandboxId) throw new Error("Agent has no current sandbox");

  const cached = AGENT_ID_TO_SANDBOX.get(agentId);
  const sandbox =
    cached && cached.sandboxId === agent.currentSandboxId
      ? cached
      : await modalClient.sandboxes.fromId(agent.currentSandboxId);

  if (!(await isSandboxAlive(sandbox))) {
    throw new Error("Modal sandbox tunnels unreachable");
  }
  AGENT_ID_TO_SANDBOX.set(agentId, sandbox);
  return { sandbox, sandboxId: sandbox.sandboxId };
}

export async function ensureAgentSandbox(input: {
  readonly agentId: string;
  readonly imageId?: string;
  readonly region?: SandboxRegion;
  readonly waitForLock?: boolean;
}): Promise<SandboxHandle> {
  const agentId = input.agentId.trim();
  if (agentId.length === 0) throw new Error("agentId is required");

  return await withLock(
    {
      key: `locks:agent-sandbox:create:${agentId}`,
      ttlMs: SESSION_SANDBOX_CREATE_LOCK_TTL_MS,
      waitMs:
        input.waitForLock === false ? 0 : SESSION_SANDBOX_CREATE_LOCK_WAIT_MS,
      retryDelayMs: 250,
    },
    async () => {
      const agent = await getAgentById(agentId);
      if (!agent) throw new HTTPException(404, { message: "Agent not found" });

      try {
        return await getAgentSandbox({ agentId });
      } catch {
        /* create below */
      }

      let candidateImageIds: string[];
      if (input.imageId) {
        candidateImageIds = [input.imageId];
      } else {
        if (
          typeof agent.createdBy !== "string" ||
          agent.createdBy.length === 0
        ) {
          throw new HTTPException(409, { message: "Agent owner is missing" });
        }
        const baseVariant =
          typeof agent.imageId === "string" && agent.imageId.length > 0
            ? await resolveImageVariantForUser({
                imageId: agent.imageId,
                userId: agent.createdBy,
                variantId: agent.imageVariantId,
              })
            : null;
        const activeImageId = baseVariant
          ? getVariantActiveImageId(baseVariant)
          : DEFAULT_VARIANT_IMAGE_REF;
        const snapshotImageId = agent.snapshotImageId?.trim() ?? "";
        candidateImageIds = [snapshotImageId, activeImageId].filter(Boolean);
      }

      const region = input.region ?? agent.region ?? DEFAULT_REGION;
      let lastErr: unknown = null;
      for (const imageId of candidateImageIds) {
        try {
          return await createAgentSandbox({ agentId, imageId, region });
        } catch (err) {
          lastErr = err;
          if (agent.currentSandboxId) {
            await clearAgentSandboxIfMatches({
              id: agentId,
              currentSandboxId: agent.currentSandboxId,
            }).catch(() => {});
          }
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    },
  );
}

export async function getAgentSandboxRuntimeAccess(input: {
  readonly userId: string;
  readonly agentId: string;
  readonly authTtlSeconds?: number;
}): Promise<SandboxRuntimeAccess> {
  const handle = await ensureAgentSandbox({ agentId: input.agentId });
  const sandboxAccessToken = await getAgentAccessToken(input.agentId);
  const urls = await getRuntimeUrls(handle.sandboxId);
  const agentId = input.agentId.trim();
  return await buildSandboxRuntimeAccess({
    sandboxId: handle.sandboxId,
    runtimeBaseUrl: urls.runtimeBaseUrl,
    openVscodeBaseUrl: urls.openVscodeBaseUrl,
    noVncBaseUrl: urls.noVncBaseUrl,
    sandboxAccessToken,
    userId: input.userId,
    subjectId: agentId,
    sessionId: agentIdToAgentSessionId(agentId),
    authTtlSeconds: input.authTtlSeconds,
  });
}

export async function snapshotAgentSandbox(input: {
  readonly sandboxId: string;
}): Promise<{ readonly imageId: string }> {
  const sandboxId = input.sandboxId.trim();
  if (sandboxId.length === 0) throw new Error("sandboxId is required");
  const sandbox =
    [...AGENT_ID_TO_SANDBOX.values()].find((candidate) => candidate.sandboxId === sandboxId) ??
    (await modalClient.sandboxes.fromId(sandboxId));
  try {
    return {
      imageId: await snapshotSandboxFilesystem({
        sandbox,
        timeoutMs: 10 * 60 * 1000,
        missingImageMessage: "Sandbox snapshot response missing `imageId`",
      }),
    };
  } catch (err) {
    throw new HTTPException(502, {
      message: `Modal sandbox snapshot failed: ${describeUnknownError(err)}`,
    });
  }
}

export async function terminateAgentSandbox(input: {
  readonly sandboxId: string;
}): Promise<void> {
  const sandboxId = input.sandboxId.trim();
  if (sandboxId.length === 0) throw new Error("sandboxId is required");
  try {
    const sandbox = await modalClient.sandboxes.fromId(sandboxId);
    await terminateSandbox(sandbox);
  } catch (err) {
    throw new HTTPException(502, {
      message: `Modal sandbox terminate failed: ${describeUnknownError(err)}`,
    });
  }
}

export async function isAgentSandboxHealthy(input: {
  readonly sandboxId: string;
}): Promise<boolean> {
  const sandboxId = input.sandboxId.trim();
  if (sandboxId.length === 0) return false;
  try {
    const urls = await getRuntimeUrls(sandboxId);
    const deadline = Date.now() + SANDBOX_HEALTH_TIMEOUT_MS;
    while (Date.now() <= deadline) {
      if (await fetchSandboxHealthOk(urls.runtimeBaseUrl)) return true;
      await sleepMs(SANDBOX_HEALTH_RETRY_MS);
    }
  } catch {
    return false;
  }
  return false;
}
