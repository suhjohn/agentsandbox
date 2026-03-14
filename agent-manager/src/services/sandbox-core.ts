import { createHmac } from "node:crypto";
import { sign } from "hono/jwt";
import { ModalClient, Sandbox } from "modal";
import {
  resolveBaseImageRefForRegistry,
  resolveGhcrDigest,
} from "@/clients/ghcr";
import { env } from "../env";
import { tryResolveTailscaleFunnelPublicBaseUrl } from "../clients/tailscale";
import {
  getImageSharedVolume,
  IMAGE_SHARED_ENV_VAR,
  IMAGE_SHARED_MOUNT_PATH,
} from "./image-volume";
import {
  isLikelyModalImageId,
  normalizeHeadImageId,
} from "@/utils/image-source";

export const modalClient = new ModalClient();

export type SandboxRegion = string | readonly string[];

export type BuildChunk = {
  readonly source: "stdout" | "stderr";
  readonly text: string;
};

export type SetupSandboxSshAccess = {
  readonly username: string;
  readonly host: string;
  readonly port: number;
  readonly hostPublicKey: string;
  readonly hostKeyFingerprint: string;
  readonly knownHostsLine: string;
};

export type SandboxHandle = {
  readonly sandbox: Sandbox;
  readonly sandboxId: string;
  readonly sandboxAccessToken?: string;
  readonly tunnels?: {
    readonly openVscodeUrl: string;
    readonly noVncUrl: string;
    readonly agentApiUrl: string;
  };
};

export type SandboxRuntimeAccess = {
  readonly sandboxId: string;
  readonly runtime: {
    readonly baseUrl: string;
    readonly authToken: string;
    readonly authExpiresInSeconds: number;
    readonly sessionId: string;
  };
  readonly terminal: {
    readonly url: string;
    readonly wsUrl: string;
    readonly authToken: string;
    readonly authExpiresInSeconds: number;
  };
  readonly ui: {
    readonly openVscodeUrl: string | null;
    readonly noVncUrl: string | null;
  };
  readonly ssh: SetupSandboxSshAccess | null;
};

export type TerminalAccess = {
  readonly sandboxId: string;
  readonly terminalUrl: string;
  readonly wsUrl: string;
  readonly authToken: string;
  readonly authTokenExpiresInSeconds: number;
};

type RawSandboxTunnelsResponse = {
  readonly tunnels?: ReadonlyArray<{
    readonly containerPort: number;
    readonly host: string;
    readonly port: number;
    readonly unencryptedHost?: string;
    readonly unencryptedPort?: number;
  }>;
};

type SandboxExecResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

type StreamWithTextRead = {
  readonly readText: () => Promise<string>;
  readonly [Symbol.asyncIterator]?: () => AsyncIterator<string>;
};

type ResolvedModalImage =
  | Awaited<ReturnType<typeof modalClient.images.fromId>>
  | ReturnType<typeof modalClient.images.fromRegistry>;

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : defaultValue;
}

const MODAL_SANDBOX_CREATE_STEP_TIMEOUT_MS = envInt(
  "MODAL_SANDBOX_CREATE_STEP_TIMEOUT_MS",
  30_000,
);
const MODAL_SANDBOX_CREATE_CALL_TIMEOUT_MS = envInt(
  "MODAL_SANDBOX_CREATE_CALL_TIMEOUT_MS",
  2 * 60_000,
);
export const MODAL_TERMINATE_RPC_TIMEOUT_MS = envInt(
  "MODAL_TERMINATE_RPC_TIMEOUT_MS",
  10_000,
);
export const SANDBOX_START_SCRIPT = "/opt/agentsandbox/agent-go/docker/start.sh";
export const SANDBOX_RUNTIME_API_PORT = envInt(
  process.env.AGENT_SANDBOX_AGENT_API_PORT != null
    ? "AGENT_SANDBOX_AGENT_API_PORT"
    : "SESSION_SANDBOX_AGENT_API_PORT",
  48213,
);
export const SANDBOX_OPENVSCODE_PORT = 39393;
export const SANDBOX_NOVNC_PORT = 6080;
export const SANDBOX_SSH_PORT = 22;
export const STANDARD_SANDBOX_TIMEOUT_MS = 60 * 60 * 1000;
export const STANDARD_SANDBOX_IDLE_TIMEOUT_MS = envInt(
  process.env.AGENT_SANDBOX_IDLE_TIMEOUT_MS != null
    ? "AGENT_SANDBOX_IDLE_TIMEOUT_MS"
    : "SESSION_SANDBOX_IDLE_TIMEOUT_MS",
  10 * 60 * 1000,
);
export const SANDBOX_HEALTH_TIMEOUT_MS = envInt(
  process.env.AGENT_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS != null
    ? "AGENT_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS"
    : "SESSION_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS",
  5 * 60 * 1000,
);
export const SANDBOX_HEALTH_RETRY_MS = envInt(
  process.env.AGENT_SANDBOX_POST_CREATE_HEALTH_RETRY_MS != null
    ? "AGENT_SANDBOX_POST_CREATE_HEALTH_RETRY_MS"
    : "SESSION_SANDBOX_POST_CREATE_HEALTH_RETRY_MS",
  1000,
);
export const SANDBOX_TUNNELS_RPC_WAIT_SECONDS = envInt(
  process.env.AGENT_SANDBOX_TUNNELS_RPC_WAIT_SECONDS != null
    ? "AGENT_SANDBOX_TUNNELS_RPC_WAIT_SECONDS"
    : "SESSION_SANDBOX_TUNNELS_RPC_WAIT_SECONDS",
  3,
);
export const SANDBOX_TUNNELS_READY_TIMEOUT_MS = envInt(
  process.env.AGENT_SANDBOX_TUNNELS_READY_TIMEOUT_MS != null
    ? "AGENT_SANDBOX_TUNNELS_READY_TIMEOUT_MS"
    : "SESSION_SANDBOX_TUNNELS_READY_TIMEOUT_MS",
  20_000,
);
export const SANDBOX_TUNNELS_RETRY_INTERVAL_MS = envInt(
  process.env.AGENT_SANDBOX_TUNNELS_RETRY_INTERVAL_MS != null
    ? "AGENT_SANDBOX_TUNNELS_RETRY_INTERVAL_MS"
    : "SESSION_SANDBOX_TUNNELS_RETRY_INTERVAL_MS",
  400,
);
export const DEFAULT_SANDBOX_AUTH_TTL_SECONDS = 24 * 60 * 60;
export const STANDARD_RUNTIME_COMMAND = parseSandboxStartCommand();
const BASE_IMAGE_WARM_APP_NAME = "base-image-warmer";
const BASE_IMAGE_WARM_TIMEOUT_MS = 2 * 60 * 1000;

function parseSandboxStartCommand(): readonly string[] {
  const name = "AGENT_SANDBOX_COMMAND_JSON";
  const raw = process.env[name]?.trim();
  if (!raw) {
    return [
      SANDBOX_START_SCRIPT,
      "/opt/agentsandbox/agent-go/build-artifacts/agent-server-linux-amd64",
      "serve",
    ];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("must be a non-empty JSON array of strings");
    }
    for (const part of parsed) {
      if (typeof part !== "string" || part.trim().length === 0) {
        throw new Error("must be a non-empty JSON array of strings");
      }
    }
    return [SANDBOX_START_SCRIPT, ...parsed.map((part) => part.trim())];
  } catch (err) {
    throw new Error(
      `${name} must be a JSON array of command arguments: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function splitCommaList(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function normalizeNullableText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeSecretNames(rawNames: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawName of rawNames) {
    const name = rawName.trim();
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    normalized.push(name);
  }
  return normalized;
}

export function normalizeRegions(
  region: SandboxRegion | null | undefined,
): string[] | undefined {
  if (typeof region === "string") return [region];
  if (region) return [...region];
  return undefined;
}

export function describeUnknownError(err: unknown): string {
  if (err instanceof Error) {
    const message = err.message.trim();
    if (message.length > 0) return message;
  }
  if (typeof err === "string") {
    const trimmed = err.trim();
    if (trimmed.length > 0) return trimmed;
  }
  try {
    const serialized = JSON.stringify(err);
    if (serialized && serialized !== "{}") return serialized;
  } catch {
    /* ignore */
  }
  const fallback = String(err ?? "");
  return fallback.trim().length > 0 ? fallback.trim() : "Unknown error";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function isTransientSandboxLookupError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("loading sandbox") ||
    normalized.includes("expected tunnel for port") ||
    normalized.includes("file does not exist") ||
    normalized.includes("sandbox not found")
  );
}

export async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolveAgentManagerBaseUrl(): Promise<string> {
  const normalize = (value: string): string | null => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
      return normalized.length > 0 ? normalized : url.origin;
    } catch {
      return null;
    }
  };

  let baseUrl = normalize(process.env.SERVER_PUBLIC_URL ?? "");
  if (!baseUrl) {
    const funnel = await tryResolveTailscaleFunnelPublicBaseUrl();
    if (funnel) {
      process.env.SERVER_PUBLIC_URL = funnel;
      baseUrl = normalize(funnel);
    }
  }

  if (!baseUrl) throw new Error("AGENT_MANAGER_BASE_URL is required");
  return baseUrl;
}

function buildAllowedOrigins(agentManagerBaseUrl: string): string {
  const rawUrls = [
    agentManagerBaseUrl,
    env.FRONTEND_URL ?? "",
    ...splitCommaList(env.AGENT_ALLOWED_ORIGINS),
    ...splitCommaList(env.VSCODE_PROXY_FRAME_ANCESTORS),
  ];

  const origins = new Set<string>();
  for (const url of rawUrls) {
    const trimmed = url.trim();
    if (trimmed.length === 0) continue;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      /* ignore invalid URLs */
    }
  }
  return [...origins].sort().join(",");
}

export async function buildStandardSandboxEnv(input: {
  readonly subjectId: string;
  readonly sandboxAccessToken: string;
  readonly managerApiKey?: string | null;
}): Promise<Record<string, string>> {
  const agentManagerBaseUrl = await resolveAgentManagerBaseUrl();
  const envVars: Record<string, string> = {
    PORT: String(SANDBOX_RUNTIME_API_PORT),
    DOCKERD_ENABLED: "1",
    DOCKERD_BRIDGE: "none",
    AGENT_DOCKER_FORCE_HOST_NETWORK: "1",
    OPENVSCODE_CONNECTION_TOKEN: input.sandboxAccessToken,
    SECRET_SEED: env.SANDBOX_SIGNING_SECRET,
    AGENT_ID: input.subjectId,
    AGENT_RUNTIME_MODE: "server",
    AGENT_MANAGER_BASE_URL: agentManagerBaseUrl,
    AGENT_ALLOWED_ORIGINS: buildAllowedOrigins(agentManagerBaseUrl),
    [IMAGE_SHARED_ENV_VAR]: IMAGE_SHARED_MOUNT_PATH,
    TERM: "xterm-256color",
  };
  if (input.managerApiKey && input.managerApiKey.trim().length > 0) {
    envVars.AGENT_MANAGER_API_KEY = input.managerApiKey.trim();
  }
  return envVars;
}

export async function resolveModalImage(input: {
  readonly imageIdOrRef: string;
  readonly resolveDigest?: boolean;
}): Promise<{
  readonly image: ResolvedModalImage;
  readonly resolvedImageSource: string;
}> {
  const requestedImageSource = normalizeHeadImageId(input.imageIdOrRef);
  if (isLikelyModalImageId(requestedImageSource)) {
    return {
      image: await withTimeout(
        modalClient.images.fromId(requestedImageSource),
        MODAL_SANDBOX_CREATE_STEP_TIMEOUT_MS,
        `image lookup (${requestedImageSource})`,
      ),
      resolvedImageSource: requestedImageSource,
    };
  }

  let resolvedImageSource = await resolveBaseImageRefForRegistry(
    requestedImageSource,
  );
  if (input.resolveDigest !== false) {
    const digest = await resolveGhcrDigest(resolvedImageSource).catch(
      () => null,
    );
    if (digest) resolvedImageSource = digest;
  }
  return {
    image: modalClient.images.fromRegistry(resolvedImageSource),
    resolvedImageSource,
  };
}

export async function assembleSandboxSecrets(input: {
  readonly envVars?: Record<string, string>;
  readonly namedSecretNames?: readonly string[];
  readonly environmentSecretNames?: readonly string[];
  readonly includeProviderApiKeys?: boolean;
  readonly onMissingNamedSecret?: (name: string) => void;
  readonly onMissingEnvironmentSecret?: (name: string) => void;
}): Promise<readonly unknown[]> {
  const secrets: unknown[] = [];

  if (input.envVars && Object.keys(input.envVars).length > 0) {
    secrets.push(await modalClient.secrets.fromObject(input.envVars));
  }

  const namedSecretNames = normalizeSecretNames(input.namedSecretNames ?? []);
  for (const secretName of namedSecretNames) {
    try {
      secrets.push(
        await withTimeout(
          modalClient.secrets.fromName(secretName),
          MODAL_SANDBOX_CREATE_STEP_TIMEOUT_MS,
          `secret lookup (${secretName})`,
        ),
      );
    } catch {
      input.onMissingNamedSecret?.(secretName);
    }
  }

  const environmentSecretNames = normalizeSecretNames(
    input.environmentSecretNames ?? [],
  ).filter((name) => !namedSecretNames.includes(name));
  for (const secretName of environmentSecretNames) {
    try {
      secrets.push(
        await withTimeout(
          modalClient.secrets.fromName(secretName),
          MODAL_SANDBOX_CREATE_STEP_TIMEOUT_MS,
          `secret lookup (${secretName})`,
        ),
      );
    } catch {
      input.onMissingEnvironmentSecret?.(secretName);
    }
  }

  if (input.includeProviderApiKeys) {
    const apiKeys = {
      OPENAI_API_KEY: (process.env.OPENAI_API_KEY ?? "").trim(),
      ANTHROPIC_API_KEY: (process.env.ANTHROPIC_API_KEY ?? "").trim(),
      GOOGLE_GENERATIVE_AI_API_KEY: (
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? ""
      ).trim(),
    };
    const filteredKeys = Object.fromEntries(
      Object.entries(apiKeys).filter(([, value]) => value.length > 0),
    );
    if (Object.keys(filteredKeys).length > 0) {
      secrets.push(await modalClient.secrets.fromObject(filteredKeys));
    }
  }

  return secrets;
}

export async function createModalSandbox(input: {
  readonly appName: string;
  readonly image: ResolvedModalImage;
  readonly command: readonly string[];
  readonly secrets: readonly unknown[];
  readonly volumes?: Record<string, unknown>;
  readonly encryptedPorts?: readonly number[];
  readonly unencryptedPorts?: readonly number[];
  readonly timeoutMs: number;
  readonly idleTimeoutMs?: number;
  readonly regions?: readonly string[];
  readonly experimentalOptions?: Record<string, unknown>;
}): Promise<SandboxHandle> {
  const app = await withTimeout(
    modalClient.apps.fromName(input.appName, { createIfMissing: true }),
    MODAL_SANDBOX_CREATE_STEP_TIMEOUT_MS,
    `app lookup (${input.appName})`,
  );
  const sandbox = await withTimeout(
    modalClient.sandboxes.create(app, input.image, {
      command: [...input.command],
      secrets: [...input.secrets] as never,
      ...(input.volumes ? { volumes: input.volumes as never } : {}),
      ...(input.encryptedPorts ? { encryptedPorts: [...input.encryptedPorts] } : {}),
      ...(input.unencryptedPorts
        ? { unencryptedPorts: [...input.unencryptedPorts] }
        : {}),
      timeoutMs: input.timeoutMs,
      ...(typeof input.idleTimeoutMs === "number"
        ? { idleTimeoutMs: input.idleTimeoutMs }
        : {}),
      ...(input.regions ? { regions: [...input.regions] } : {}),
      ...(input.experimentalOptions
        ? { experimentalOptions: input.experimentalOptions as never }
        : {}),
    }),
    MODAL_SANDBOX_CREATE_CALL_TIMEOUT_MS,
    "sandbox create",
  );
  return { sandbox, sandboxId: sandbox.sandboxId };
}

export async function warmBaseImage(): Promise<void> {
  const { image } = await resolveModalImage({
    imageIdOrRef: env.AGENT_BASE_IMAGE_REF,
  });
  const handle = await createModalSandbox({
    appName: BASE_IMAGE_WARM_APP_NAME,
    image,
    command: ["sleep", "infinity"],
    secrets: [],
    timeoutMs: BASE_IMAGE_WARM_TIMEOUT_MS,
  });

  try {
    const result = await execSandboxCommand({
      sandbox: handle.sandbox,
      command: ["/bin/sh", "-lc", "echo warm-base-image >/dev/null"],
      timeoutMs: 15_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `base image warmup failed (exit ${result.exitCode})${
          result.stderr.trim().length > 0 ? `: ${result.stderr.trim()}` : ""
        }`,
      );
    }
  } finally {
    await safeTerminateSandbox(handle);
  }
}

export async function waitForSandboxTunnels(input: {
  readonly sandboxId: string;
  readonly ports: readonly number[];
  readonly timeoutMs?: number;
  readonly retryIntervalMs?: number;
  readonly rpcTimeoutSeconds?: number;
  readonly unencryptedPorts?: readonly number[];
}): Promise<Map<number, { host: string; port: number }>> {
  const deadline = Date.now() + (input.timeoutMs ?? SANDBOX_TUNNELS_READY_TIMEOUT_MS);
  const retryIntervalMs =
    input.retryIntervalMs ?? SANDBOX_TUNNELS_RETRY_INTERVAL_MS;
  const rpcTimeoutSeconds =
    input.rpcTimeoutSeconds ?? SANDBOX_TUNNELS_RPC_WAIT_SECONDS;
  const expectUnencrypted = new Set(input.unencryptedPorts ?? []);
  let lastErr: unknown = null;

  while (Date.now() <= deadline) {
    try {
      const response = (await modalClient.cpClient.sandboxGetTunnels({
        sandboxId: input.sandboxId,
        timeout: rpcTimeoutSeconds,
      })) as unknown as RawSandboxTunnelsResponse;
      const byPort = new Map<number, { host: string; port: number }>();
      for (const tunnel of response.tunnels ?? []) {
        if (expectUnencrypted.has(tunnel.containerPort)) {
          if (
            typeof tunnel.unencryptedHost === "string" &&
            tunnel.unencryptedHost.trim().length > 0 &&
            typeof tunnel.unencryptedPort === "number" &&
            Number.isFinite(tunnel.unencryptedPort) &&
            tunnel.unencryptedPort > 0
          ) {
            byPort.set(tunnel.containerPort, {
              host: tunnel.unencryptedHost,
              port: Math.floor(tunnel.unencryptedPort),
            });
          }
          continue;
        }
        byPort.set(tunnel.containerPort, {
          host: tunnel.host,
          port: tunnel.port,
        });
      }
      for (const port of input.ports) {
        if (!byPort.has(port)) throw new Error(`Expected tunnel for port ${port}`);
      }
      return byPort;
    } catch (err) {
      lastErr = err;
      if (!isTransientSandboxLookupError(err)) throw err;
      if (Date.now() >= deadline) break;
      await sleepMs(retryIntervalMs);
    }
  }

  throw new Error(
    `Sandbox tunnels unavailable after ${
      (input.timeoutMs ?? SANDBOX_TUNNELS_READY_TIMEOUT_MS)
    }ms: ${describeUnknownError(lastErr)}`,
  );
}

export function buildTunnelUrl(host: string, port: number): string {
  return port !== 443 ? `https://${host}:${port}` : `https://${host}`;
}

export function buildTerminalAccess(input: {
  readonly sandboxId: string;
  readonly baseUrl: string;
  readonly authToken: string;
  readonly authTokenExpiresInSeconds: number;
}): TerminalAccess {
  const terminalUrl = new URL(input.baseUrl);
  const basePath = terminalUrl.pathname.endsWith("/")
    ? terminalUrl.pathname.slice(0, -1)
    : terminalUrl.pathname;
  terminalUrl.pathname = `${basePath}/terminal`;
  terminalUrl.search = "";
  terminalUrl.hash = "";

  const wsUrl = new URL(terminalUrl.toString());
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

  return {
    sandboxId: input.sandboxId,
    terminalUrl: terminalUrl.toString(),
    wsUrl: wsUrl.toString(),
    authToken: input.authToken,
    authTokenExpiresInSeconds: input.authTokenExpiresInSeconds,
  };
}

export function buildUiAccessUrls(input: {
  readonly openVscodeBaseUrl?: string | null;
  readonly noVncBaseUrl?: string | null;
  readonly sandboxAccessToken: string;
}): { readonly openVscodeUrl: string | null; readonly noVncUrl: string | null } {
  const token = input.sandboxAccessToken.trim();
  if (token.length === 0) throw new Error("sandboxAccessToken is required");

  const openVscodeUrl = input.openVscodeBaseUrl
    ? (() => {
        const url = new URL(input.openVscodeBaseUrl);
        if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
        url.searchParams.set("tkn", token);
        return url.toString();
      })()
    : null;

  const noVncUrl = input.noVncBaseUrl
    ? (() => {
        const url = new URL(input.noVncBaseUrl);
        url.pathname = `${url.pathname.replace(/\/+$/, "")}/vnc.html`;
        url.searchParams.set("password", token);
        return url.toString();
      })()
    : null;

  return { openVscodeUrl, noVncUrl };
}

export async function mintSandboxAuthToken(input: {
  readonly userId: string;
  readonly subjectId: string;
  readonly sessionId: string;
  readonly expiresInSeconds?: number;
}): Promise<{ readonly token: string; readonly expiresInSeconds: number }> {
  const now = Math.floor(Date.now() / 1000);
  const desiredExpiresInSeconds = Math.max(
    30,
    Math.floor(input.expiresInSeconds ?? DEFAULT_SANDBOX_AUTH_TTL_SECONDS),
  );
  const exp = now + desiredExpiresInSeconds;
  const secret = createHmac("sha256", env.SANDBOX_SIGNING_SECRET)
    .update(`sandbox-agent:${input.sessionId}`)
    .digest("hex");
  const token = await sign(
    {
      sub: input.userId,
      agentId: input.subjectId,
      iat: now,
      exp,
      typ: "sandbox-agent",
      sid: input.sessionId,
      jti: crypto.randomUUID(),
    },
    secret,
    "HS256",
  );
  return { token, expiresInSeconds: Math.max(1, exp - now) };
}

export async function buildSandboxRuntimeAccess(input: {
  readonly sandboxId: string;
  readonly runtimeBaseUrl: string;
  readonly sandboxAccessToken: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly subjectId: string;
  readonly authTtlSeconds?: number;
  readonly openVscodeBaseUrl?: string | null;
  readonly noVncBaseUrl?: string | null;
  readonly ssh?: SetupSandboxSshAccess | null;
}): Promise<SandboxRuntimeAccess> {
  const auth = await mintSandboxAuthToken({
    userId: input.userId,
    subjectId: input.subjectId,
    sessionId: input.sessionId,
    expiresInSeconds: input.authTtlSeconds,
  });
  const terminal = buildTerminalAccess({
    sandboxId: input.sandboxId,
    baseUrl: input.runtimeBaseUrl,
    authToken: auth.token,
    authTokenExpiresInSeconds: auth.expiresInSeconds,
  });
  const ui = buildUiAccessUrls({
    openVscodeBaseUrl: input.openVscodeBaseUrl ?? null,
    noVncBaseUrl: input.noVncBaseUrl ?? null,
    sandboxAccessToken: input.sandboxAccessToken,
  });

  return {
    sandboxId: input.sandboxId,
    runtime: {
      baseUrl: input.runtimeBaseUrl,
      authToken: auth.token,
      authExpiresInSeconds: auth.expiresInSeconds,
      sessionId: input.sessionId,
    },
    terminal: {
      url: terminal.terminalUrl,
      wsUrl: terminal.wsUrl,
      authToken: terminal.authToken,
      authExpiresInSeconds: terminal.authTokenExpiresInSeconds,
    },
    ui,
    ssh: input.ssh ?? null,
  };
}

export async function fetchSandboxHealthOk(runtimeBaseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const healthUrl = new URL(runtimeBaseUrl);
    if (!healthUrl.pathname.endsWith("/")) healthUrl.pathname = `${healthUrl.pathname}/`;
    healthUrl.pathname = `${healthUrl.pathname}health`;
    healthUrl.search = "";
    healthUrl.hash = "";
    const response = await fetch(healthUrl.toString(), {
      method: "GET",
      headers: { "Cache-Control": "no-store" },
      signal: controller.signal,
      ...(healthUrl.hostname.endsWith(".modal.host")
        ? { tls: { rejectUnauthorized: false } }
        : {}),
    });
    if (!response.ok) return false;
    const bodyText = await response.text();
    try {
      const data = JSON.parse(bodyText) as unknown;
      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        "status" in data
      ) {
        return (data as { readonly status?: unknown }).status === "ok";
      }
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForSandboxReady(input: {
  readonly sandboxId: string;
  readonly runtimePort?: number;
  readonly openVscodePort?: number | null;
  readonly noVncPort?: number | null;
  readonly timeoutMs?: number;
  readonly retryMs?: number;
}): Promise<{
  readonly runtimeBaseUrl: string;
  readonly openVscodeBaseUrl: string | null;
  readonly noVncBaseUrl: string | null;
}> {
  const ports = [input.runtimePort ?? SANDBOX_RUNTIME_API_PORT];
  if (input.openVscodePort) ports.push(input.openVscodePort);
  if (input.noVncPort) ports.push(input.noVncPort);

  const tunnels = await waitForSandboxTunnels({
    sandboxId: input.sandboxId,
    ports,
  });
  const runtimeBaseUrl = buildTunnelUrl(
    tunnels.get(input.runtimePort ?? SANDBOX_RUNTIME_API_PORT)!.host,
    tunnels.get(input.runtimePort ?? SANDBOX_RUNTIME_API_PORT)!.port,
  );
  const openVscodeBaseUrl = input.openVscodePort
    ? buildTunnelUrl(
        tunnels.get(input.openVscodePort)!.host,
        tunnels.get(input.openVscodePort)!.port,
      )
    : null;
  const noVncBaseUrl = input.noVncPort
    ? buildTunnelUrl(
        tunnels.get(input.noVncPort)!.host,
        tunnels.get(input.noVncPort)!.port,
      )
    : null;

  const deadline = Date.now() + (input.timeoutMs ?? SANDBOX_HEALTH_TIMEOUT_MS);
  while (Date.now() <= deadline) {
    if (await fetchSandboxHealthOk(runtimeBaseUrl)) {
      return { runtimeBaseUrl, openVscodeBaseUrl, noVncBaseUrl };
    }
    await sleepMs(input.retryMs ?? SANDBOX_HEALTH_RETRY_MS);
  }
  throw new Error(
    `Sandbox health check did not pass within ${
      input.timeoutMs ?? SANDBOX_HEALTH_TIMEOUT_MS
    }ms`,
  );
}

export async function execSandboxCommand(input: {
  readonly sandbox: Sandbox;
  readonly command: readonly string[];
  readonly timeoutMs?: number;
}): Promise<SandboxExecResult> {
  const proc = await input.sandbox.exec([...input.command], {
    stdout: "pipe",
    stderr: "pipe",
    ...(typeof input.timeoutMs === "number"
      ? { timeoutMs: input.timeoutMs }
      : {}),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.readText(),
    proc.stderr.readText(),
    proc.wait(),
  ]);
  return { exitCode, stdout, stderr };
}

export async function execSandboxTextCommand(
  sandbox: Sandbox,
  command: readonly string[],
  options?: {
    readonly timeoutMs?: number;
    readonly secrets?: readonly unknown[];
    readonly onStdoutChunk?: (chunk: string) => void;
    readonly onStderrChunk?: (chunk: string) => void;
  },
): Promise<SandboxExecResult> {
  const proc = await sandbox.exec([...command], {
    mode: "text",
    ...(typeof options?.timeoutMs === "number"
      ? { timeoutMs: options.timeoutMs }
      : {}),
    ...(options?.secrets ? { secrets: [...options.secrets] as never } : {}),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readProcessText(proc.stdout as StreamWithTextRead, options?.onStdoutChunk),
    readProcessText(proc.stderr as StreamWithTextRead, options?.onStderrChunk),
    proc.wait(),
  ]);
  return { exitCode, stdout, stderr };
}

async function readProcessText(
  stream: StreamWithTextRead,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  if (!onChunk || typeof stream[Symbol.asyncIterator] !== "function") {
    const text = await stream.readText();
    if (onChunk && text.length > 0) onChunk(text);
    return text;
  }
  let output = "";
  for await (const rawChunk of stream as AsyncIterable<string>) {
    const chunk = typeof rawChunk === "string" ? rawChunk : String(rawChunk);
    if (chunk.length === 0) continue;
    onChunk(chunk);
    output += chunk;
  }
  return output;
}

export function createLineBuffer(onLine: (line: string) => void): {
  readonly push: (chunk: string) => void;
  readonly flush: () => void;
} {
  let buffer = "";
  return {
    push: (chunk: string) => {
      if (chunk.length === 0) return;
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      for (const line of parts) onLine(line);
    },
    flush: () => {
      if (buffer.length === 0) return;
      onLine(buffer);
      buffer = "";
    },
  };
}

async function writeSandboxFile(
  sandbox: Sandbox,
  path: string,
  contents: string,
): Promise<void> {
  const file = await sandbox.open(path, "w");
  try {
    await file.write(new TextEncoder().encode(contents));
    await file.flush();
  } finally {
    await file.close();
  }
}

export async function writeSandboxFileIfMissing(
  sandbox: Sandbox,
  path: string,
  contents: string,
): Promise<void> {
  try {
    const file = await sandbox.open(path, "r");
    await file.close();
    return;
  } catch {
    /* ignore missing file */
  }
  try {
    await writeSandboxFile(sandbox, path, contents);
  } catch {
    /* best effort only */
  }
}

export async function snapshotSandboxFilesystem(input: {
  readonly sandbox: Sandbox;
  readonly timeoutMs: number;
  readonly missingImageMessage: string;
}): Promise<string> {
  const snapshot = await input.sandbox.snapshotFilesystem(input.timeoutMs);
  const imageId =
    typeof snapshot.imageId === "string" ? snapshot.imageId.trim() : "";
  if (imageId.length === 0) throw new Error(input.missingImageMessage);
  return imageId;
}

export async function terminateSandbox(
  sandbox: Sandbox | SandboxHandle,
): Promise<void> {
  const target = "sandbox" in sandbox ? sandbox.sandbox : sandbox;
  await target.terminate();
}

export async function safeTerminateSandbox(
  sandbox: Sandbox | SandboxHandle,
): Promise<void> {
  try {
    await terminateSandbox(sandbox);
  } catch {
    /* ignore cleanup failures */
  }
}

export async function isSandboxAlive(sb: Sandbox): Promise<boolean> {
  try {
    const proc = await sb.exec(["echo", "hello"], {
      stdout: "pipe",
      stderr: "pipe",
      timeoutMs: 2_000,
    });
    return (await proc.wait()) === 0;
  } catch {
    return false;
  }
}

export async function getImageSharedMount(input: {
  readonly imageId: string;
  readonly readOnly: boolean;
}): Promise<Record<string, unknown>> {
  const sharedVolume = await getImageSharedVolume({
    imageId: input.imageId,
    readOnly: input.readOnly,
  });
  return { [IMAGE_SHARED_MOUNT_PATH]: sharedVolume as unknown };
}

export function normalizeSetupSandboxSshKeys(
  rawKeys: readonly string[] | null | undefined,
): readonly string[] {
  if (!rawKeys) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawKey of rawKeys) {
    const key = rawKey.trim();
    if (key.length === 0) continue;
    if (key.includes("\n") || key.includes("\r")) {
      throw new Error("sshPublicKeys entries must be single-line public keys");
    }
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

export async function provisionSandboxSshAccess(input: {
  readonly sandbox: Sandbox;
  readonly publicKeys: readonly string[];
  readonly username?: string;
  readonly authorizedKeysHome?: string;
  readonly sshPort?: number;
}): Promise<Pick<SetupSandboxSshAccess, "hostPublicKey" | "hostKeyFingerprint">> {
  const username = input.username ?? "root";
  const authorizedKeysHome = input.authorizedKeysHome ?? "/root";
  const sshPort = input.sshPort ?? SANDBOX_SSH_PORT;
  const authorizedKeys = `${input.publicKeys.join("\n")}\n`;
  const script = [
    "set -euo pipefail",
    `if ! id -u ${shellQuote(username)} >/dev/null 2>&1; then`,
    `  echo "missing ssh user: ${username}" >&2`,
    "  exit 1",
    "fi",
    `SSH_HOME="${authorizedKeysHome}"`,
    'SSH_DIR="${SSH_HOME}/.ssh"',
    'HOST_DIR="${ROOT_DIR:-/home/agent/runtime}/ssh-hostkeys"',
    'RUNTIME_DIR="${ROOT_DIR:-/home/agent/runtime}"',
    'CONFIG_PATH="${RUNTIME_DIR}/run/sshd_config"',
    'PID_PATH="${RUNTIME_DIR}/run/sshd.pid"',
    'mkdir -p /run/sshd "${SSH_DIR}" "${HOST_DIR}" "${RUNTIME_DIR}/run"',
    'chmod 755 "${SSH_HOME}"',
    'chmod 700 "${SSH_DIR}" "${HOST_DIR}"',
    "cat > \"${SSH_DIR}/authorized_keys\" <<'__AUTHORIZED_KEYS__'",
    authorizedKeys.trimEnd(),
    "__AUTHORIZED_KEYS__",
    'chown -R root:root "${SSH_DIR}"',
    'chmod 600 "${SSH_DIR}/authorized_keys"',
    'if [[ ! -f "${HOST_DIR}/ssh_host_ed25519_key" ]]; then',
    '  ssh-keygen -q -t ed25519 -N "" -f "${HOST_DIR}/ssh_host_ed25519_key"',
    "fi",
    'cat > "${CONFIG_PATH}" <<EOF',
    `Port ${sshPort}`,
    "ListenAddress 0.0.0.0",
    "Protocol 2",
    "AddressFamily any",
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "ChallengeResponseAuthentication no",
    "UsePAM no",
    "PermitRootLogin yes",
    "PubkeyAuthentication yes",
    `AuthorizedKeysFile ${authorizedKeysHome}/.ssh/authorized_keys`,
    `AllowUsers ${username}`,
    "HostKey ${HOST_DIR}/ssh_host_ed25519_key",
    "PidFile ${PID_PATH}",
    "PrintMotd no",
    "Subsystem sftp internal-sftp",
    "EOF",
    'if [[ -f "${PID_PATH}" ]]; then',
    '  old_pid="$(cat "${PID_PATH}" 2>/dev/null || true)"',
    '  if [[ -n "${old_pid}" ]] && kill -0 "${old_pid}" 2>/dev/null; then',
    '    kill "${old_pid}" 2>/dev/null || true',
    "    sleep 0.2",
    "  fi",
    '  rm -f "${PID_PATH}"',
    "fi",
    '/usr/sbin/sshd -t -f "${CONFIG_PATH}"',
    'nohup /usr/sbin/sshd -D -f "${CONFIG_PATH}" >/tmp/agent-manager-sshd.log 2>&1 </dev/null &',
    "for _ in $(seq 1 40); do",
    `  if ss -tln | grep -qE '[:.]${sshPort}[[:space:]]'; then`,
    "    break",
    "  fi",
    "  sleep 0.25",
    "done",
    `if ! ss -tln | grep -qE '[:.]${sshPort}[[:space:]]'; then`,
    '  echo "sshd failed to start" >&2',
    "  exit 1",
    "fi",
    'HOST_PUBLIC_KEY="$(cat "${HOST_DIR}/ssh_host_ed25519_key.pub")"',
    'HOST_FINGERPRINT="$(ssh-keygen -lf "${HOST_DIR}/ssh_host_ed25519_key.pub" -E sha256 | awk \'{print $2}\')"',
    'HOST_PUBLIC_KEY="${HOST_PUBLIC_KEY}" HOST_FINGERPRINT="${HOST_FINGERPRINT}" python3 - <<\'__PY__\'',
    "import json",
    "import os",
    "print(json.dumps({",
    '  "hostPublicKey": os.environ["HOST_PUBLIC_KEY"],',
    '  "hostKeyFingerprint": os.environ["HOST_FINGERPRINT"],',
    "}))",
    "__PY__",
  ].join("\n");

  const result = await execSandboxCommand({
    sandbox: input.sandbox,
    command: ["bash", "-lc", script],
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to provision sandbox SSH access (exit ${result.exitCode}): ${
        result.stderr.trim() || result.stdout.trim() || "unknown error"
      }`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error("Failed to parse sandbox SSH metadata");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof (parsed as { hostPublicKey?: unknown }).hostPublicKey !== "string" ||
    typeof (parsed as { hostKeyFingerprint?: unknown }).hostKeyFingerprint !==
      "string"
  ) {
    throw new Error("Sandbox SSH metadata was incomplete");
  }
  return {
    hostPublicKey: (parsed as { hostPublicKey: string }).hostPublicKey,
    hostKeyFingerprint: (parsed as { hostKeyFingerprint: string })
      .hostKeyFingerprint,
  };
}
