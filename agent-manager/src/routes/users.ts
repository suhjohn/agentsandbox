import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, ilike, or, sql } from "drizzle-orm";
import type { AppEnv } from "../types/context";
import { db } from "../db";
import { agents, users } from "../db/schema";
import { updateUser } from "../services/user.service";
import { registerRoute } from "../openapi/registry";
import { DEFAULT_REGION, parseRegionText } from "../utils/region";
import { parseWorkspaceKeybindings } from "../utils/workspace-keybindings";

const app = new Hono<AppEnv>();
const BASE = "/users";

const workspaceKeybindingsSchema = z.record(z.string(), z.unknown());
const workspaceKeybindingsResponseSchema = workspaceKeybindingsSchema.nullable();

const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  defaultRegion: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  workspaceKeybindings: workspaceKeybindingsResponseSchema.optional(),
});
const listUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

const booleanQueryParam = z.enum(["true", "false"]).transform(v => v === "true");

const listUsersQuerySchema = z.object({
  q: z.string().min(1).optional(),
  hasAgents: booleanQueryParam.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

registerRoute(
  app,
  {
    method: "get",
    path: `${BASE}`,
    summary: "List users",
    tags: ["users"],
    security: [{ bearerAuth: [] }],
    request: { query: listUsersQuerySchema },
    responses: {
      200: z.object({
        data: z.array(listUserSchema),
      }),
    },
  },
  "/",
  zValidator("query", listUsersQuerySchema),
  async (c) => {
    const query = c.req.valid("query" as never) as z.infer<
      typeof listUsersQuerySchema
    >;

    const conditions = [];

    if (query.q && query.q.trim().length > 0) {
      const raw = query.q.trim();
      conditions.push(
        or(
          ilike(users.name, `%${raw}%`),
          ilike(users.email, `%${raw}%`),
        )!,
      );
    }

    if (query.hasAgents) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${agents} WHERE ${agents.createdBy} = ${users.id})`,
      );
    }

    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
      })
      .from(users)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(users.name))
      .limit(query.limit);
    return c.json({ data: rows });
  },
);

registerRoute(
  app,
  {
    method: "get",
    path: `${BASE}/me`,
    summary: "Get current user",
    tags: ["users"],
    security: [{ bearerAuth: [] }],
    responses: {
      200: z.object({
        id: z.string(),
        email: z.string().email(),
        name: z.string(),
        defaultRegion: z.union([z.string(), z.array(z.string())]),
        workspaceKeybindings: workspaceKeybindingsResponseSchema,
      }),
    },
  },
  "/me",
  (c) => {
    const user = c.get("user");
    return c.json(user);
  },
);

registerRoute(
  app,
  {
    method: "patch",
    path: `${BASE}/me`,
    summary: "Update current user",
    tags: ["users"],
    security: [{ bearerAuth: [] }],
    request: { json: updateUserSchema },
    responses: {
      200: z.object({
        id: z.string(),
        email: z.string().email(),
        name: z.string(),
        defaultRegion: z.union([z.string(), z.array(z.string())]),
        workspaceKeybindings: workspaceKeybindingsResponseSchema,
      }),
      404: z.object({ error: z.string() }),
    },
  },
  "/me",
  zValidator("json", updateUserSchema),
  async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json" as never) as z.infer<
      typeof updateUserSchema
    >;
    const workspaceKeybindings =
      body.workspaceKeybindings === undefined
        ? undefined
        : parseWorkspaceKeybindings(body.workspaceKeybindings);
    const updated = await updateUser(user.id, {
      ...body,
      workspaceKeybindings,
    });
    if (!updated) {
      return c.json({ error: "User not found" }, 404);
    }
    const defaultRegion = parseRegionText(updated.defaultRegion) ?? DEFAULT_REGION;
    return c.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      defaultRegion,
      workspaceKeybindings: parseWorkspaceKeybindings(updated.workspaceKeybindings),
    });
  },
);

export { app as userRoutes };
