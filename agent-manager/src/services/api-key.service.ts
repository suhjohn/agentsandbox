import { and, eq, isNull } from "drizzle-orm";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "../db";
import { agents, apiKeys, users } from "../db/schema";
import type { AuthUser } from "../types/context";
import { DEFAULT_REGION, parseRegionText } from "../utils/region";
import { parseWorkspaceKeybindings } from "../utils/workspace-keybindings";

const API_KEY_PREFIX = "amk_";
const API_KEY_PREFIX_LENGTH = 20;

export type ApiKeyRecord = typeof apiKeys.$inferSelect;

export type AuthenticatedApiKey = {
  readonly apiKey: ApiKeyRecord;
  readonly user: AuthUser;
};

function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function buildApiKeyPrefix(raw: string): string {
  return raw.slice(0, API_KEY_PREFIX_LENGTH);
}

function generateRawApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
}

function normalizeScopes(scopes: readonly string[]): readonly string[] {
  return Array.from(
    new Set(
      scopes.map((scope) => scope.trim()).filter((scope) => scope.length > 0),
    ),
  ).sort();
}

function toAuthUser(row: typeof users.$inferSelect): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar ?? null,
    defaultRegion: parseRegionText(row.defaultRegion) ?? DEFAULT_REGION,
    workspaceKeybindings: parseWorkspaceKeybindings(row.workspaceKeybindings),
  };
}

async function assertAgentOwnedByUser(input: {
  readonly agentId: string;
  readonly userId: string;
}): Promise<void> {
  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(eq(agents.id, input.agentId), eq(agents.createdBy, input.userId)),
    )
    .limit(1);
  if (!rows[0]) {
    throw new Error("Agent not found");
  }
}

export async function createApiKey(input: {
  readonly userId: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly agentId?: string | null;
  readonly expiresAt?: Date | null;
}): Promise<{
  readonly key: string;
  readonly apiKey: ApiKeyRecord;
}> {
  const name = input.name.trim();
  if (name.length === 0) throw new Error("name is required");
  const scopes = normalizeScopes(input.scopes);
  if (scopes.length === 0) throw new Error("at least one scope is required");
  const userId = input.userId.trim();
  if (userId.length === 0) throw new Error("userId is required");
  const agentId = input.agentId?.trim() || null;
  if (agentId) {
    await assertAgentOwnedByUser({ agentId, userId });
  }

  const key = generateRawApiKey();
  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      name,
      keyPrefix: buildApiKeyPrefix(key),
      keyHash: hashApiKey(key),
      scopes,
      userId,
      agentId,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  if (!apiKey) {
    throw new Error("Failed to create API key");
  }
  return { key, apiKey };
}

export async function listApiKeysByUser(userId: string): Promise<
  readonly ApiKeyRecord[]
> {
  return await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(apiKeys.createdAt);
}

export async function revokeApiKey(input: {
  readonly id: string;
  readonly userId: string;
}): Promise<ApiKeyRecord | null> {
  const [updated] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, input.userId)))
    .returning();
  return updated ?? null;
}

export async function getApiKeyByIdForUser(input: {
  readonly id: string;
  readonly userId: string;
}): Promise<ApiKeyRecord | null> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, input.userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function authenticateApiKey(
  rawKey: string,
): Promise<AuthenticatedApiKey | null> {
  const candidate = rawKey.trim();
  if (!candidate.startsWith(API_KEY_PREFIX)) return null;
  const prefix = buildApiKeyPrefix(candidate);
  const rows = await db
    .select({ apiKey: apiKeys, user: users })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(
      and(
        eq(apiKeys.keyPrefix, prefix),
        isNull(apiKeys.revokedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  if (
    row.apiKey.expiresAt instanceof Date &&
    row.apiKey.expiresAt.getTime() <= Date.now()
  ) {
    return null;
  }

  const suppliedHash = Buffer.from(hashApiKey(candidate), "utf8");
  const storedHash = Buffer.from(row.apiKey.keyHash, "utf8");
  if (
    suppliedHash.length !== storedHash.length ||
    !timingSafeEqual(suppliedHash, storedHash)
  ) {
    return null;
  }

  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(apiKeys.id, row.apiKey.id));

  return {
    apiKey: row.apiKey,
    user: toAuthUser(row.user),
  };
}
