import {
  eq,
  and,
  or,
  lt,
  desc,
  ne,
  isNull,
  isNotNull,
  ilike,
  sql,
  inArray,
} from "drizzle-orm";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { db } from "../db";
import { agents, images, sessions, users } from "../db/schema";
import type { AgentStatus } from "../db/enums";
import type { Region } from "../utils/region";
import { DEFAULT_REGION, serializeRegion } from "../utils/region";
import { env } from "../env";

function generateSandboxAccessToken(): string {
  // 32 hex chars, URL-safe and fine for use in query params.
  return crypto.randomUUID().replace(/-/g, "");
}

export class AgentNameConflictError extends Error {
  constructor(name: string) {
    super(`Agent name already exists: ${name}`);
    this.name = "AgentNameConflictError";
  }
}

function normalizeAgentName(name?: string): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : crypto.randomUUID();
}

function isUniqueAgentNameViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { code?: unknown; constraint?: unknown };
  return (
    candidate.code === "23505" && candidate.constraint === "agents_name_idx"
  );
}

const SANDBOX_ACCESS_TOKEN_PREFIX = "enc:v1:";
const sandboxAccessTokenKey = createHash("sha256")
  .update(env.SANDBOX_TOKEN_ENCRYPTION_SECRET)
  .digest();

function encryptSandboxAccessToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sandboxAccessTokenKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${SANDBOX_ACCESS_TOKEN_PREFIX}${iv.toString("base64")}:${ciphertext.toString("base64")}:${tag.toString("base64")}`;
}

function decryptSandboxAccessToken(stored: string): string {
  if (!stored.startsWith(SANDBOX_ACCESS_TOKEN_PREFIX)) return stored;
  const payload = stored.slice(SANDBOX_ACCESS_TOKEN_PREFIX.length);
  const [ivB64, ciphertextB64, tagB64] = payload.split(":");
  if (!ivB64 || !ciphertextB64 || !tagB64) {
    throw new Error("Invalid encrypted sandbox access token format");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    sandboxAccessTokenKey,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function createAgent(input: {
  name?: string;
  parentAgentId?: string | null;
  imageId: string;
  imageVariantId?: string | null;
  createdBy: string;
  region?: Region;
}) {
  const name = normalizeAgentName(input.name);
  const serializedRegion = serializeRegion(input.region);
  const sandboxAccessToken = generateSandboxAccessToken();
  let agent: typeof agents.$inferSelect | undefined;
  try {
    [agent] = await db
      .insert(agents)
      .values({
        name,
        parentAgentId: input.parentAgentId ?? null,
        imageId: input.imageId,
        imageVariantId: input.imageVariantId ?? null,
        createdBy: input.createdBy,
        sandboxAccessToken: encryptSandboxAccessToken(sandboxAccessToken),
        region: serializedRegion ?? DEFAULT_REGION,
      })
      .returning();
  } catch (err) {
    if (isUniqueAgentNameViolation(err)) {
      throw new AgentNameConflictError(name);
    }
    throw err;
  }

  if (!agent) {
    throw new Error("Failed to create agent");
  }
  return agent;
}

export async function getAgentById(id: string) {
  const result = await db
    .select()
    .from(agents)
    .leftJoin(images, eq(agents.imageId, images.id))
    .where(eq(agents.id, id))
    .limit(1);
  const row = result[0];
  if (!row) return null;
  return {
    ...row.agents,
    image: row.images,
  };
}

export async function listAgents(input: {
  imageId?: string;
  noImage?: boolean;
  status?: AgentStatus;
  archived?: boolean;
  parentAgentId?: string;
  search?: string;
  createdBy?: string;
  limit: number;
  cursor?: string;
}) {
  if (input.imageId && input.noImage) {
    throw new Error("imageId and noImage are mutually exclusive");
  }

  const conditions = [];

  if (input.createdBy && input.createdBy.trim().length > 0) {
    conditions.push(eq(agents.createdBy, input.createdBy.trim()));
  }
  if (input.imageId) conditions.push(eq(agents.imageId, input.imageId));
  if (input.noImage) conditions.push(isNull(agents.imageId));

  if (input.status) {
    conditions.push(eq(agents.status, input.status));
  } else if (input.archived) {
    conditions.push(eq(agents.status, "archived"));
  } else {
    // Default behavior: exclude archived agents unless explicitly requested.
    conditions.push(ne(agents.status, "archived"));
  }

  // Filter by parent: explicit parentAgentId, or root-only by default
  if (input.parentAgentId) {
    conditions.push(eq(agents.parentAgentId, input.parentAgentId));
  } else {
    conditions.push(isNull(agents.parentAgentId));
  }

  if (input.cursor) {
    const parsed = parseUpdatedAtIdCursor(input.cursor);
    if (parsed) {
      conditions.push(
        or(
          lt(agents.updatedAt, parsed.updatedAt),
          and(eq(agents.updatedAt, parsed.updatedAt), lt(agents.id, parsed.id)),
        ),
      );
    } else {
      const fallback = new Date(input.cursor);
      if (Number.isFinite(fallback.getTime())) {
        conditions.push(lt(agents.updatedAt, fallback));
      }
    }
  }

  if (input.search && input.search.trim().length > 0) {
    const query = input.search.trim();
    conditions.push(
      or(
        ilike(agents.name, `%${query}%`),
        sql`${agents.id}::text ILIKE ${query + "%"}`,
      ),
    );
  }

  const result = await db
    .select()
    .from(agents)
    .leftJoin(images, eq(agents.imageId, images.id))
    .innerJoin(users, eq(agents.createdBy, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(agents.updatedAt), desc(agents.id))
    .limit(input.limit + 1);

  const rows = result.map((r) => ({
    ...r.agents,
    createdByUser: { id: r.users.id, name: r.users.name },
    image: r.images ? { id: r.images.id, name: r.images.name } : null,
  }));
  const hasMore = rows.length > input.limit;
  if (hasMore) rows.pop();

  // Eagerly load one level of sub-agents when fetching root agents
  if (!input.parentAgentId && rows.length > 0) {
    const rootIds = rows.map((r) => r.id);
    const childRows = await db
      .select()
      .from(agents)
      .leftJoin(images, eq(agents.imageId, images.id))
      .innerJoin(users, eq(agents.createdBy, users.id))
      .where(inArray(agents.parentAgentId, rootIds))
      .orderBy(desc(agents.updatedAt), desc(agents.id));

    const childrenByParent = new Map<string, typeof rows>();
    for (const r of childRows) {
      const child = {
        ...r.agents,
        createdByUser: { id: r.users.id, name: r.users.name },
        image: r.images ? { id: r.images.id, name: r.images.name } : null,
      };
      const parentId = r.agents.parentAgentId!;
      const list = childrenByParent.get(parentId);
      if (list) {
        list.push(child);
      } else {
        childrenByParent.set(parentId, [child]);
      }
    }

    const agentsWithChildren = rows.map((r) => ({
      ...r,
      subAgents: childrenByParent.get(r.id) ?? [],
    }));

    return {
      agents: agentsWithChildren,
      nextCursor: hasMore
        ? buildUpdatedAtIdCursor(rows[rows.length - 1])
        : null,
    };
  }

  return {
    agents: rows,
    nextCursor: hasMore ? buildUpdatedAtIdCursor(rows[rows.length - 1]) : null,
  };
}

export async function listActiveAgentsWithSandboxes(): Promise<
  ReadonlyArray<{ readonly id: string; readonly currentSandboxId: string }>
> {
  const rows = await db
    .select({ id: agents.id, currentSandboxId: agents.currentSandboxId })
    .from(agents)
    .where(
      and(eq(agents.status, "active"), isNotNull(agents.currentSandboxId)),
    );

  return rows.map((row) => ({
    id: row.id,
    currentSandboxId: row.currentSandboxId as string,
  }));
}

export async function listAgentsByIds(input: {
  readonly createdBy?: string;
  readonly agentIds: readonly string[];
}): Promise<
  ReadonlyArray<{
    readonly id: string;
    readonly status: AgentStatus;
    readonly currentSandboxId: string | null;
  }>
> {
  const ids = Array.from(
    new Set(
      input.agentIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
        .slice(0, 50),
    ),
  );
  if (ids.length === 0) return [];

  const conditions = [inArray(agents.id, ids)];
  if (input.createdBy && input.createdBy.trim().length > 0) {
    conditions.push(eq(agents.createdBy, input.createdBy.trim()));
  }

  const rows = await db
    .select({
      id: agents.id,
      status: agents.status,
      currentSandboxId: agents.currentSandboxId,
    })
    .from(agents)
    .where(and(...conditions));

  return rows.map((row) => ({
    id: row.id,
    status: row.status as AgentStatus,
    currentSandboxId: (row.currentSandboxId as string | null) ?? null,
  }));
}

export type AgentGroupBy = "imageId" | "createdBy";

export type AgentGroup = {
  readonly key: string | null;
  readonly label: string;
  readonly latestUpdatedAt: string;
  readonly preview: readonly (typeof agents.$inferSelect & {
    readonly createdByUser: { readonly id: string; readonly name: string };
    readonly image: { readonly id: string; readonly name: string } | null;
    readonly createdByName: string;
  })[];
  readonly nextCursor: string | null;
};

export async function listAgentGroups(input: {
  readonly createdBy?: string;
  readonly by: AgentGroupBy;
  readonly previewN: number;
  readonly archived?: boolean;
}): Promise<{ readonly groups: readonly AgentGroup[] }> {
  const conditions = [];
  if (input.createdBy && input.createdBy.trim().length > 0) {
    conditions.push(eq(agents.createdBy, input.createdBy.trim()));
  }

  if (input.archived) {
    conditions.push(eq(agents.status, "archived"));
  } else {
    conditions.push(ne(agents.status, "archived"));
  }

  const result = await db
    .select()
    .from(agents)
    .leftJoin(images, eq(agents.imageId, images.id))
    .innerJoin(users, eq(agents.createdBy, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(agents.updatedAt), desc(agents.id));

  type PreviewAgent = typeof agents.$inferSelect & {
    readonly createdByUser: { readonly id: string; readonly name: string };
    readonly image: { readonly id: string; readonly name: string } | null;
    readonly createdByName: string;
  };

  type MutableGroup = {
    readonly key: string | null;
    readonly label: string;
    readonly latestUpdatedAt: string;
    readonly preview: PreviewAgent[];
    hasMore: boolean;
  };

  const groupsInOrder: MutableGroup[] = [];
  const byKey = new Map<string, MutableGroup>();

  for (const row of result) {
    const agent = row.agents;
    const createdByName = row.users.name;
    const previewAgent: PreviewAgent = {
      ...agent,
      createdByName,
      createdByUser: { id: row.users.id, name: row.users.name },
      image: row.images ? { id: row.images.id, name: row.images.name } : null,
    };

    const groupKeyRaw =
      input.by === "createdBy" ? agent.createdBy : agent.imageId;
    const groupKey = groupKeyRaw ?? null;
    const groupKeyStr = groupKey ?? "__null__";

    let group = byKey.get(groupKeyStr);
    if (!group) {
      const label =
        input.by === "createdBy"
          ? createdByName
          : groupKey === null
            ? "No image"
            : (row.images?.name ?? "Unknown image");
      group = {
        key: groupKey,
        label,
        latestUpdatedAt: agent.updatedAt.toISOString(),
        preview: [],
        hasMore: false,
      };
      byKey.set(groupKeyStr, group);
      groupsInOrder.push(group);
    }

    if (group.preview.length < input.previewN) {
      group.preview.push(previewAgent);
    } else {
      group.hasMore = true;
    }
  }

  return {
    groups: groupsInOrder.map((g) => ({
      key: g.key,
      label: g.label,
      latestUpdatedAt: g.latestUpdatedAt,
      preview: g.preview,
      nextCursor: g.hasMore
        ? buildUpdatedAtIdCursor(g.preview[g.preview.length - 1])
        : null,
    })),
  };
}

function parseUpdatedAtIdCursor(
  cursor: string,
): { readonly updatedAt: Date; readonly id: string } | null {
  const idx = cursor.indexOf("::");
  if (idx === -1) return null;
  const updatedAtRaw = cursor.slice(0, idx).trim();
  const id = cursor.slice(idx + 2).trim();
  if (!updatedAtRaw || !id) return null;
  const updatedAt = new Date(updatedAtRaw);
  if (!Number.isFinite(updatedAt.getTime())) return null;
  return { updatedAt, id };
}

function buildUpdatedAtIdCursor(row: {
  readonly updatedAt: Date;
  readonly id: string;
}): string {
  return `${row.updatedAt.toISOString()}::${row.id}`;
}

export async function updateAgent(id: string, input: { name?: string }) {
  const [updated] = await db
    .update(agents)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(agents.id, id))
    .returning();
  return updated ?? null;
}

export async function setAgentSandbox(input: {
  id: string;
  currentSandboxId: string;
}) {
  const [updated] = await db
    .update(agents)
    .set({
      currentSandboxId: input.currentSandboxId,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, input.id))
    .returning();
  return updated ?? null;
}

export async function getAgentAccessToken(id: string): Promise<string> {
  const existing = await getAgentById(id);
  if (!existing) throw new Error("Agent not found");
  if (!existing.sandboxAccessToken)
    throw new Error("Agent has no access token");
  return decryptSandboxAccessToken(existing.sandboxAccessToken).trim();
}

export async function setAgentSnapshot(input: {
  id: string;
  snapshotImageId: string;
}) {
  const [updated] = await db
    .update(agents)
    .set({
      snapshotImageId: input.snapshotImageId,
      currentSandboxId: null,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, input.id))
    .returning();
  return updated ?? null;
}

export async function setAgentCheckpointSnapshot(input: {
  id: string;
  snapshotImageId: string;
}) {
  const [updated] = await db
    .update(agents)
    .set({
      snapshotImageId: input.snapshotImageId,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, input.id))
    .returning();
  return updated ?? null;
}

export async function clearAgentSandbox(id: string) {
  const [updated] = await db
    .update(agents)
    .set({ currentSandboxId: null, updatedAt: new Date() })
    .where(eq(agents.id, id))
    .returning();
  return updated ?? null;
}

export async function clearAgentSandboxIfMatches(input: {
  id: string;
  currentSandboxId: string;
}) {
  const [updated] = await db
    .update(agents)
    .set({ currentSandboxId: null, updatedAt: new Date() })
    .where(and(eq(agents.id, input.id), eq(agents.currentSandboxId, input.currentSandboxId)))
    .returning();
  return updated ?? null;
}

export async function deleteAgent(id: string) {
  const result = await db.delete(agents).where(eq(agents.id, id)).returning();
  return result.length > 0;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function setAgentStatus(id: string, status: AgentStatus) {
  const [updated] = await db
    .update(agents)
    .set({ status, updatedAt: new Date() })
    .where(eq(agents.id, id))
    .returning();
  return updated ?? null;
}

export async function setAgentStatusIfMatches(input: {
  id: string;
  nextStatus: AgentStatus;
  expectedStatus: AgentStatus;
}) {
  const [updated] = await db
    .update(agents)
    .set({ status: input.nextStatus, updatedAt: new Date() })
    .where(and(eq(agents.id, input.id), eq(agents.status, input.expectedStatus)))
    .returning();
  return updated ?? null;
}

export async function archiveAgent(id: string) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(agents)
      .set({ status: "archived", updatedAt: now })
      .where(eq(agents.id, id))
      .returning();
    if (!updated) return null;

    await tx
      .update(sessions)
      .set({ isArchived: true, updatedAt: now })
      .where(eq(sessions.agentId, id));

    return updated;
  });
}

export async function resumeAgent(id: string) {
  return setAgentStatus(id, "active");
}

export async function completeAgent(id: string) {
  return setAgentStatus(id, "completed");
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function getActiveAgentsByImage(imageId: string) {
  return db
    .select()
    .from(agents)
    .where(and(eq(agents.imageId, imageId), eq(agents.status, "active")));
}
