const SECRET_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const SECRET_STORAGE_PREFIX = "agent-manager-web/client-tools/secrets";

function getStorageKey(userId: string, deviceId: string): string {
  return `${SECRET_STORAGE_PREFIX}/${userId}/${deviceId}`;
}

function readSecrets(userId: string, deviceId: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(getStorageKey(userId, deviceId));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeSecrets(
  userId: string,
  deviceId: string,
  secrets: Record<string, string>,
): void {
  if (typeof window === "undefined") {
    throw new Error("Secret storage is unavailable outside the browser.");
  }
  window.localStorage.setItem(
    getStorageKey(userId, deviceId),
    JSON.stringify(secrets),
  );
}

export async function addClientSecret(input: {
  readonly userId: string;
  readonly deviceId: string;
  readonly name: string;
  readonly value: string;
  readonly overwrite?: boolean;
}): Promise<{ readonly stored: true; readonly name: string }> {
  const name = input.name.trim();
  if (!SECRET_NAME_PATTERN.test(name)) {
    throw new Error("INVALID_SECRET_NAME");
  }
  if (input.value.length === 0) {
    throw new Error("INVALID_SECRET_VALUE");
  }
  const secrets = readSecrets(input.userId, input.deviceId);
  if (!input.overwrite && Object.prototype.hasOwnProperty.call(secrets, name)) {
    throw new Error("SECRET_ALREADY_EXISTS");
  }
  secrets[name] = input.value;
  writeSecrets(input.userId, input.deviceId, secrets);
  return { stored: true, name };
}
