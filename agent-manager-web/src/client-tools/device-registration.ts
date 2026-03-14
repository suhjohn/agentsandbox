import {
  CLIENT_TOOL_NAMES,
  type ClientToolRegistrationPayload,
  type ClientToolUnregisterPayload,
} from "../../../shared/client-tools-contract";

const DEVICE_ID_STORAGE_KEY = "agent-manager-web/client-tools/device-id";

type RegistrationEntry = {
  count: number;
  config: RegistrationConfig;
};

type RegistrationConfig = {
  readonly agentApiUrl: string;
  readonly agentAuthToken: string;
  readonly payload: ClientToolRegistrationPayload;
};

const registrations = new Map<string, RegistrationEntry>();

function registrationKey(config: RegistrationConfig): string {
  return `${config.agentApiUrl}|${config.payload.userId}|${config.payload.deviceId}`;
}

async function postJson(
  agentApiUrl: string,
  agentAuthToken: string,
  path: string,
  body: ClientToolRegistrationPayload | ClientToolUnregisterPayload,
): Promise<void> {
  await fetch(new URL(path, agentApiUrl).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Auth": `Bearer ${agentAuthToken}`,
    },
    body: JSON.stringify(body),
  });
}

export function getClientToolDeviceId(): string {
  if (typeof window === "undefined") return "device-server";
  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)?.trim();
  if (existing) return existing;
  const next =
    window.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
  return next;
}

export function getSupportedClientTools() {
  return CLIENT_TOOL_NAMES;
}

export async function registerClientTools(
  config: RegistrationConfig,
): Promise<void> {
  await postJson(
    config.agentApiUrl,
    config.agentAuthToken,
    "/client-tools/register",
    config.payload,
  );
}

export async function unregisterClientTools(input: {
  readonly agentApiUrl: string;
  readonly agentAuthToken: string;
  readonly payload: ClientToolUnregisterPayload;
}): Promise<void> {
  await postJson(
    input.agentApiUrl,
    input.agentAuthToken,
    "/client-tools/unregister",
    input.payload,
  );
}

export function retainClientToolRegistration(
  config: RegistrationConfig,
): () => void {
  const key = registrationKey(config);
  const existing = registrations.get(key);
  if (existing) {
    existing.count += 1;
    existing.config = config;
  } else {
    registrations.set(key, { count: 1, config });
    void registerClientTools(config);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = registrations.get(key);
    if (!current) return;
    current.count -= 1;
    if (current.count > 0) return;
    registrations.delete(key);
    void unregisterClientTools({
      agentApiUrl: current.config.agentApiUrl,
      agentAuthToken: current.config.agentAuthToken,
      payload: {
        userId: current.config.payload.userId,
        deviceId: current.config.payload.deviceId,
      },
    });
  };
}
