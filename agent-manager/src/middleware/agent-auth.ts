import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../types/context";
import { env } from "../env";
import { verifyJwt, loadUser } from "./auth";
import { getAgentById } from "../services/agent.service";
import { getUserById } from "../services/user.service";
import { DEFAULT_REGION, parseRegionText } from "../utils/region";
import { parseWorkspaceKeybindings } from "../utils/workspace-keybindings";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function readApiKeyHeader(c: { readonly req: { readonly header: (name: string) => string | undefined } }): string | null {
  const v = (c.req.header("x-agent-manager-api-key") ?? "").trim();
  return v.length > 0 ? v : null;
}

function getAgentIdFromPath(path: string): string | null {
  const match = path.match(/^\/agents\/([^/]+)/);
  if (!match) return null;
  const id = (match[1] ?? "").trim();
  return id.length > 0 ? id : null;
}

async function getParentAgentIdFromJsonBody(c: {
  readonly req: {
    readonly method: string;
    readonly path: string;
    readonly raw: Request;
  };
}): Promise<string | null> {
  if (c.req.method.toUpperCase() !== "POST") return null;
  if (!/^\/agents\/?$/.test(c.req.path)) return null;

  try {
    const cloned = c.req.raw.clone();
    const contentType = (cloned.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("application/json")) return null;
    const body = (await cloned.json()) as unknown;
    if (!body || typeof body !== "object") return null;
    const candidate = (body as { parentAgentId?: unknown }).parentAgentId;
    if (typeof candidate !== "string") return null;
    const id = candidate.trim();
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

async function loadUserForAgentId(agentId: string) {
  const agent = await getAgentById(agentId);
  if (!agent) {
    throw new HTTPException(404, { message: "Agent not found" });
  }
  const user = await getUserById(agent.createdBy);
  if (!user) {
    throw new HTTPException(401, { message: "User not found" });
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    defaultRegion: parseRegionText(user.defaultRegion) ?? DEFAULT_REGION,
    workspaceKeybindings: parseWorkspaceKeybindings(user.workspaceKeybindings),
  };
}

export const agentAuth = createMiddleware<AppEnv>(async (c, next) => {
  const suppliedApiKey = readApiKeyHeader(c);
  if (suppliedApiKey !== null) {
    const configuredApiKey = (env.AGENT_MANAGER_API_KEY ?? "").trim();
    if (!configuredApiKey) {
      throw new HTTPException(401, { message: "API key auth is not configured" });
    }
    if (suppliedApiKey !== configuredApiKey) {
      throw new HTTPException(401, { message: "Invalid API key" });
    }

    const agentIdFromPath = getAgentIdFromPath(c.req.path);
    const agentId =
      agentIdFromPath && isUuid(agentIdFromPath)
        ? agentIdFromPath
        : await getParentAgentIdFromJsonBody(c);

    if (!agentId || !isUuid(agentId)) {
      throw new HTTPException(401, {
        message:
          "API key auth requires either a valid /agents/:agentId route or POST /agents with parentAgentId",
      });
    }

    c.set("user", await loadUserForAgentId(agentId));
    await next();
    return;
  }

  await verifyJwt(c, async () => {
    await loadUser(c, next);
  });
});
