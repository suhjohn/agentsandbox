import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { globalSettings } from "../db/schema";
import type { AppEnv } from "../types/context";
import { registerRoute } from "../openapi/registry";

const app = new Hono<AppEnv>();
const BASE = "/settings";
const GLOBAL_SETTINGS_ID = "default";

const defaultDiffIgnorePatterns = [
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/pnpm-lock.yml",
  "**/bun.lock",
  "**/bun.lockb",
  "**/uv.lock",
  "**/poetry.lock",
  "**/Pipfile.lock",
  "**/requirements.lock",
  "**/Cargo.lock",
  "**/Gemfile.lock",
  "**/composer.lock",
  "**/Podfile.lock",
  "**/Package.resolved",
  "**/go.sum",
  "**/mix.lock",
  "**/pubspec.lock",
  "**/flake.lock",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/target/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.svelte-kit/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/.pytest_cache/**",
  "**/.mypy_cache/**",
  "**/.ruff_cache/**",
  "**/.gradle/**",
] as const;

const globalSettingsSchema = z.object({
  diffignore: z.array(z.string()),
  defaultCoordinatorImageId: z.string().uuid().nullable(),
});

const updateGlobalSettingsSchema = z.object({
  diffignore: z.array(z.string().min(1)).optional(),
  defaultCoordinatorImageId: z.string().uuid().nullable().optional(),
}).refine(
  (value) =>
    Object.prototype.hasOwnProperty.call(value, "diffignore") ||
    Object.prototype.hasOwnProperty.call(value, "defaultCoordinatorImageId"),
  { message: "At least one field must be provided" },
);

function normalizeDiffIgnorePatterns(values: readonly string[]): string[] {
  if (values.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim().replaceAll("\\", "/");
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseStoredDiffignore(value: unknown): string[] {
  if (!Array.isArray(value)) return [...defaultDiffIgnorePatterns];
  return normalizeDiffIgnorePatterns(
    value.filter((item): item is string => typeof item === "string"),
  );
}

function hasRelationMissingError(value: unknown): boolean {
  let current: unknown = value;
  while (current && typeof current === "object") {
    const code = (current as { code?: unknown }).code;
    if (code === "42P01") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

async function ensureGlobalSettingsRow() {
  await db
    .insert(globalSettings)
    .values({
      id: GLOBAL_SETTINGS_ID,
      diffignore: [...defaultDiffIgnorePatterns],
      defaultCoordinatorImageId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
}

async function readGlobalSettings() {
  await ensureGlobalSettingsRow();
  const rows = await db
    .select({
      diffignore: globalSettings.diffignore,
      defaultCoordinatorImageId: globalSettings.defaultCoordinatorImageId,
    })
    .from(globalSettings)
    .where(eq(globalSettings.id, GLOBAL_SETTINGS_ID))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return {
      diffignore: [...defaultDiffIgnorePatterns],
      defaultCoordinatorImageId: null,
    };
  }
  return {
    diffignore: parseStoredDiffignore(row.diffignore),
    defaultCoordinatorImageId: row.defaultCoordinatorImageId ?? null,
  };
}

registerRoute(
  app,
  {
    method: "get",
    path: `${BASE}/global`,
    summary: "Get global settings",
    tags: ["settings"],
    security: [{ bearerAuth: [] }],
    responses: {
      200: globalSettingsSchema,
    },
  },
  "/global",
  async (c) => {
    try {
      return c.json(await readGlobalSettings());
    } catch (err) {
      if (hasRelationMissingError(err)) {
        // Degrade gracefully when migrations have not been applied yet.
        return c.json({
          diffignore: [...defaultDiffIgnorePatterns],
          defaultCoordinatorImageId: null,
        });
      }
      throw err;
    }
  },
);

registerRoute(
  app,
  {
    method: "patch",
    path: `${BASE}/global`,
    summary: "Update global settings",
    tags: ["settings"],
    security: [{ bearerAuth: [] }],
    request: { json: updateGlobalSettingsSchema },
    responses: {
      200: globalSettingsSchema,
    },
  },
  "/global",
  zValidator("json", updateGlobalSettingsSchema),
  async (c) => {
    const body = c.req.valid("json" as never) as z.infer<
      typeof updateGlobalSettingsSchema
    >;
    const diffignore = Array.isArray(body.diffignore)
      ? normalizeDiffIgnorePatterns(body.diffignore)
      : undefined;
    try {
      await ensureGlobalSettingsRow();
      const rows = await db
        .update(globalSettings)
        .set({
          ...(diffignore ? { diffignore } : {}),
          ...(Object.prototype.hasOwnProperty.call(
            body,
            "defaultCoordinatorImageId",
          )
            ? {
                defaultCoordinatorImageId: body.defaultCoordinatorImageId ?? null,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(globalSettings.id, GLOBAL_SETTINGS_ID))
        .returning({
          diffignore: globalSettings.diffignore,
          defaultCoordinatorImageId: globalSettings.defaultCoordinatorImageId,
        });

      const row = rows[0];
      return c.json({
        diffignore: parseStoredDiffignore(row?.diffignore ?? diffignore ?? []),
        defaultCoordinatorImageId: row?.defaultCoordinatorImageId ?? null,
      });
    } catch (err) {
      if (hasRelationMissingError(err)) {
        throw new HTTPException(503, {
          message: "global_settings migration is missing",
        });
      }
      throw err;
    }
  },
);

export { app as settingsRoutes };
