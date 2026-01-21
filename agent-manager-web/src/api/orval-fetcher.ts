import { getAgentManagerBaseUrl } from "@/lib/env";

const AUTH_STORAGE_KEY = "agent-manager-web/auth";

type StoredAuthSession = {
  readonly accessToken: string;
  readonly user: unknown;
};

function isStoredAuthSession(value: unknown): value is StoredAuthSession {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.accessToken === "string";
}

function getStoredAccessToken(): string | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isStoredAuthSession(parsed)) return null;
    return parsed.accessToken;
  } catch {
    return null;
  }
}

function buildUrl(pathOrUrl: string): string {
  const baseUrl = getAgentManagerBaseUrl();
  return new URL(pathOrUrl, baseUrl).toString();
}

async function readResponseBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return (await res.text()) as T;
}

export async function orvalFetcher<T>(
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<T> {
  const url = buildUrl(pathOrUrl);
  const accessToken = getStoredAccessToken();
  const headers: HeadersInit = {
    ...(init.headers ?? {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };

  const isDev = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  const { signal: _signal, ...initWithoutSignal } = init;

  const res = await fetch(url, {
    ...(isDev ? initWithoutSignal : init),
    credentials: init.credentials ?? "include",
    headers,
  });

  if (!res.ok) {
    const errorBody = await readResponseBody<unknown>(res).catch(() => null);
    const message =
      typeof errorBody === "string"
        ? errorBody
        : typeof errorBody === "object" && errorBody !== null && "error" in errorBody
          ? String((errorBody as { error?: unknown }).error ?? res.statusText)
          : res.statusText;
    throw new Error(message || `Request failed (${res.status})`);
  }

  return await readResponseBody<T>(res);
}
