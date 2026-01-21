type AgentRuntimeConfig = {
  readonly baseUrl: string;
  readonly agentAuthToken: string | null;
};

let config: AgentRuntimeConfig | null = null;

export function setAgentRuntimeConfig(next: AgentRuntimeConfig | null): void {
  config = next;
}

export type AgentRuntimeRequestInit = RequestInit & {
  readonly baseUrl?: string;
  readonly agentAuthToken?: string | null;
};

function requireConfig(): AgentRuntimeConfig {
  if (!config) {
    throw new Error(
      "Agent runtime baseUrl/auth not configured. Call setAgentRuntimeConfig({ baseUrl, agentAuthToken }).",
    );
  }
  return config;
}

async function readResponseBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return (await res.text()) as T;
}

export async function orvalAgentFetcher<T>(
  pathOrUrl: string,
  init: AgentRuntimeRequestInit = {},
): Promise<T> {
  const fallback = config;
  const baseUrl = init.baseUrl ?? fallback?.baseUrl ?? requireConfig().baseUrl;
  const agentAuthToken =
    init.agentAuthToken ?? fallback?.agentAuthToken ?? requireConfig().agentAuthToken;
  const url = new URL(pathOrUrl, baseUrl).toString();

  const headers: HeadersInit = {
    ...(init.headers ?? {}),
    ...(agentAuthToken ? { "X-Agent-Auth": `Bearer ${agentAuthToken}` } : {}),
  };

  const { baseUrl: _baseUrl, agentAuthToken: _agentAuthToken, ...fetchInit } =
    init as unknown as Record<string, unknown>;

  const res = await fetch(url, {
    ...(fetchInit as RequestInit),
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
