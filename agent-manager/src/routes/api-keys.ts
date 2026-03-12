import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppEnv } from "../types/context";
import { registerRoute } from "../openapi/registry";
import {
  createApiKey,
  listApiKeysByUser,
  revokeApiKey,
} from "../services/api-key.service";

const app = new Hono<AppEnv>();
const BASE = "/api-keys";

const apiKeySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(z.string()),
  userId: z.string().uuid(),
  agentId: z.string().uuid().nullable(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const createApiKeySchema = z.object({
  name: z.string().min(1).max(255),
  scopes: z.array(z.string().min(1)).min(1),
  agentId: z.string().uuid().optional(),
  expiresInSeconds: z.coerce.number().int().min(60).max(60 * 60 * 24 * 30).optional(),
});

const apiKeyParamsSchema = z.object({
  id: z.string().uuid(),
});

function serializeApiKey(key: {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly scopes: readonly string[];
  readonly userId: string;
  readonly agentId: string | null;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}) {
  return {
    ...key,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
    updatedAt: key.updatedAt.toISOString(),
  };
}

registerRoute(
  app,
  {
    method: "get",
    path: `${BASE}`,
    summary: "List API keys",
    tags: ["api-keys"],
    security: [{ bearerAuth: [] }],
    responses: {
      200: z.object({ data: z.array(apiKeySchema) }),
    },
  },
  "/",
  async (c) => {
    const user = c.get("user");
    const keys = await listApiKeysByUser(user.id);
    return c.json({ data: keys.map(serializeApiKey) });
  },
);

registerRoute(
  app,
  {
    method: "post",
    path: `${BASE}`,
    summary: "Create API key",
    tags: ["api-keys"],
    security: [{ bearerAuth: [] }],
    request: { json: createApiKeySchema },
    responses: {
      201: z.object({
        key: z.string(),
        apiKey: apiKeySchema,
      }),
      400: z.object({ error: z.string() }),
    },
  },
  "/",
  zValidator("json", createApiKeySchema),
  async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json" as never) as z.infer<typeof createApiKeySchema>;
    try {
      const expiresAt =
        typeof body.expiresInSeconds === "number"
          ? new Date(Date.now() + body.expiresInSeconds * 1000)
          : null;
      const created = await createApiKey({
        userId: user.id,
        name: body.name,
        scopes: body.scopes,
        agentId: body.agentId ?? null,
        expiresAt,
      });
      return c.json(
        {
          key: created.key,
          apiKey: serializeApiKey(created.apiKey),
        },
        201,
      );
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to create API key" },
        400,
      );
    }
  },
);

registerRoute(
  app,
  {
    method: "post",
    path: `${BASE}/{id}/revoke`,
    summary: "Revoke API key",
    tags: ["api-keys"],
    security: [{ bearerAuth: [] }],
    request: { params: apiKeyParamsSchema },
    responses: {
      200: z.object({ apiKey: apiKeySchema }),
      404: z.object({ error: z.string() }),
    },
  },
  "/:id/revoke",
  zValidator("param", apiKeyParamsSchema),
  async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param" as never) as z.infer<typeof apiKeyParamsSchema>;
    const revoked = await revokeApiKey({ id, userId: user.id });
    if (!revoked) {
      return c.json({ error: "API key not found" }, 404);
    }
    return c.json({ apiKey: serializeApiKey(revoked) });
  },
);

export { app as apiKeysRoutes };
