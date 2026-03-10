import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, ilike, inArray, or, sql } from "drizzle-orm";
import type { AppEnv } from "../types/context";
import { db } from "../db";
import { agents, users } from "../db/schema";
import { getUserById, updateUser } from "../services/user.service";
import { registerRoute } from "../openapi/registry";
import { DEFAULT_REGION, parseRegionText } from "../utils/region";
import { parseWorkspaceKeybindings } from "../utils/workspace-keybindings";
import {
  buildGithubAvatarUrl,
  deleteAvatarPath,
  readAvatar,
  uploadCustomAvatar,
  uploadGithubAvatar,
} from "../services/avatar.service";

const app = new Hono<AppEnv>();
const BASE = "/users";

const workspaceKeybindingsSchema = z.record(z.string(), z.unknown());
const workspaceKeybindingsResponseSchema = workspaceKeybindingsSchema.nullable();
const avatarSchema = z.string().nullable();

const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  defaultRegion: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  workspaceKeybindings: workspaceKeybindingsResponseSchema.optional(),
});
const listUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  avatar: avatarSchema,
});
const meResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  avatar: avatarSchema,
  defaultRegion: z.union([z.string(), z.array(z.string())]),
  workspaceKeybindings: workspaceKeybindingsResponseSchema,
});
const userAvatarParamsSchema = z.object({
  userId: z.string().uuid(),
});

const booleanQueryParam = z.enum(["true", "false"]).transform(v => v === "true");
const userIdsQueryParam = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(z.string().uuid()).min(1).max(100));

const listUsersQuerySchema = z.object({
  ids: userIdsQueryParam.optional(),
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

    if (query.ids) {
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          avatar: users.avatar,
        })
        .from(users)
        .where(inArray(users.id, query.ids));

      const byId = new Map(rows.map((row) => [row.id, row] as const));
      return c.json({
        data: query.ids
          .map((id) => byId.get(id))
          .filter((row): row is (typeof rows)[number] => row !== undefined),
      });
    }

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
        avatar: users.avatar,
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
        ...meResponseSchema.shape,
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
        ...meResponseSchema.shape,
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
      avatar: updated.avatar ?? null,
      defaultRegion,
      workspaceKeybindings: parseWorkspaceKeybindings(updated.workspaceKeybindings),
    });
  },
);

registerRoute(
  app,
  {
    method: "get",
    path: `${BASE}/:userId/avatar`,
    summary: "Get a user's avatar image",
    tags: ["users"],
    security: [{ bearerAuth: [] }],
    request: { params: userAvatarParamsSchema },
    responses: {
      200: z.any(),
      404: z.object({ error: z.string() }),
    },
  },
  "/:userId/avatar",
  zValidator("param", userAvatarParamsSchema),
  async (c) => {
    const params = c.req.valid("param" as never) as z.infer<
      typeof userAvatarParamsSchema
    >;
    const targetUser = await getUserById(params.userId);
    if (!targetUser?.avatar) {
      return c.json({ error: "Avatar not found" }, 404);
    }

    try {
      const avatar = await readAvatar(targetUser.avatar);
      return new Response(avatar.bytes, {
        headers: {
          "Content-Type": avatar.contentType,
          "Cache-Control": "private, max-age=31536000, immutable",
          Vary: "Authorization",
        },
      });
    } catch {
      return c.json({ error: "Avatar not found" }, 404);
    }
  },
);

registerRoute(
  app,
  {
    method: "put",
    path: `${BASE}/me/avatar`,
    summary: "Upload an avatar for the current user",
    tags: ["users"],
    security: [{ bearerAuth: [] }],
    responses: {
      200: meResponseSchema,
      400: z.object({ error: z.string() }),
      500: z.object({ error: z.string() }),
    },
  },
  "/me/avatar",
  async (c) => {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const maybeFile = body.file;
    const file =
      maybeFile instanceof File
        ? maybeFile
        : Array.isArray(maybeFile) && maybeFile[0] instanceof File
          ? maybeFile[0]
          : null;

    if (!(file instanceof File)) {
      return c.json({ error: "Avatar image is required" }, 400);
    }

    try {
      const existing = await getUserById(user.id);
      if (!existing) {
        return c.json({ error: "User not found" }, 404);
      }

      const avatarPath = await uploadCustomAvatar({
        userId: user.id,
        file,
      });

      if (existing.avatar && existing.avatar !== avatarPath) {
        await deleteAvatarPath(existing.avatar);
      }

      const updated = await updateUser(user.id, { avatar: avatarPath });
      if (!updated) {
        return c.json({ error: "User not found" }, 404);
      }

      const defaultRegion = parseRegionText(updated.defaultRegion) ?? DEFAULT_REGION;
      return c.json({
        id: updated.id,
        name: updated.name,
        email: updated.email,
        avatar: updated.avatar ?? null,
        defaultRegion,
        workspaceKeybindings: parseWorkspaceKeybindings(updated.workspaceKeybindings),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Avatar upload failed";
      return c.json({ error: message }, 400);
    }
  },
);

registerRoute(
  app,
  {
    method: "delete",
    path: `${BASE}/me/avatar`,
    summary: "Reset the current user's avatar",
    tags: ["users"],
    security: [{ bearerAuth: [] }],
    responses: {
      200: meResponseSchema,
      404: z.object({ error: z.string() }),
      500: z.object({ error: z.string() }),
    },
  },
  "/me/avatar",
  async (c) => {
    const user = c.get("user");
    const existing = await getUserById(user.id);
    if (!existing) {
      return c.json({ error: "User not found" }, 404);
    }

    let nextAvatar: string | null = null;
    try {
      if (existing.githubId) {
        nextAvatar = await uploadGithubAvatar({
          userId: existing.id,
          avatarUrl: buildGithubAvatarUrl(existing.githubId),
        });
      }

      if (existing.avatar && existing.avatar !== nextAvatar) {
        await deleteAvatarPath(existing.avatar);
      }

      const updated = await updateUser(user.id, { avatar: nextAvatar });
      if (!updated) {
        return c.json({ error: "User not found" }, 404);
      }

      const defaultRegion = parseRegionText(updated.defaultRegion) ?? DEFAULT_REGION;
      return c.json({
        id: updated.id,
        name: updated.name,
        email: updated.email,
        avatar: updated.avatar ?? null,
        defaultRegion,
        workspaceKeybindings: parseWorkspaceKeybindings(updated.workspaceKeybindings),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Avatar reset failed";
      return c.json({ error: message }, 500);
    }
  },
);

export { app as userRoutes };
