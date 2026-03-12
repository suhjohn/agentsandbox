import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../types/context";
import { authenticateApiKey } from "../services/api-key.service";
import { loadUser, verifyJwt } from "./auth";
import {
  buildRoutePermissionId,
  matchRegisteredRoute,
} from "../openapi/registry";

function readApiKey(c: {
  readonly req: { readonly header: (name: string) => string | undefined };
}): string | null {
  const explicit = (c.req.header("x-api-key") ?? "").trim();
  if (explicit.length > 0) return explicit;
  const auth = (c.req.header("authorization") ?? "").trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() ?? "";
  if (token.startsWith("amk_")) return token;
  return null;
}

function extractPathParam(
  template: string,
  actualPath: string,
  paramName: string,
): string | null {
  const templateParts = template.split("/").filter(Boolean);
  const actualParts = actualPath.split("/").filter(Boolean);
  if (templateParts.length !== actualParts.length) return null;
  for (let i = 0; i < templateParts.length; i += 1) {
    const templatePart = templateParts[i];
    const actualPart = actualParts[i];
    if (!templatePart || !actualPart) return null;
    if (templatePart === `:${paramName}`) return actualPart;
  }
  return null;
}

export const managerAuth = createMiddleware<AppEnv>(async (c, next) => {
  const apiKey = readApiKey(c);
  if (apiKey) {
    const authenticated = await authenticateApiKey(apiKey);
    if (!authenticated) {
      throw new HTTPException(401, { message: "Invalid API key" });
    }
    c.set("authMode", "api-key");
    c.set("user", authenticated.user);
    c.set("apiKeyId", authenticated.apiKey.id);
    c.set("apiKeyScopes", authenticated.apiKey.scopes ?? []);
    c.set("apiKeyAgentId", authenticated.apiKey.agentId ?? null);
    await next();
    return;
  }

  await verifyJwt(c, async () => {
    c.set("authMode", "jwt");
    await loadUser(c, next);
  });
});

export const requireApiKeyRouteScope = createMiddleware<AppEnv>(
  async (c, next) => {
    if ((c.get("authMode") ?? "jwt") !== "api-key") {
      await next();
      return;
    }

    const spec = matchRegisteredRoute(c.req.method, c.req.path);
    if (!spec) {
      throw new HTTPException(403, { message: "API key route is not allowed" });
    }

    const permission = buildRoutePermissionId(spec.method, spec.path);
    const scopes = c.get("apiKeyScopes") ?? [];
    if (!scopes.includes("*") && !scopes.includes(permission)) {
      throw new HTTPException(403, {
        message: `Missing API key permission: ${permission}`,
      });
    }

    const boundAgentId = c.get("apiKeyAgentId") ?? null;
    if (boundAgentId) {
      const pathAgentId = extractPathParam(spec.path, c.req.path, "agentId");
      if (pathAgentId && pathAgentId !== boundAgentId) {
        throw new HTTPException(403, { message: "API key agent mismatch" });
      }
    }

    await next();
  },
);
