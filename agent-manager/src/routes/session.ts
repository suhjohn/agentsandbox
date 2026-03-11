import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm'
import type { AppEnv } from '../types/context'
import { registerRoute } from '../openapi/registry'
import { db } from '../db'
import { getAgentById } from '../services/agent.service'
import { createSessionBootstrap } from '../services/session.service'
import { agents, sessions } from '../db/schema'

const app = new Hono<AppEnv>()
const BASE = '/session'

const createAgentSchema = z.object({
  parentAgentId: z.uuid().or(z.string()).optional(),
  imageId: z.uuid().or(z.string()),
  variantId: z.uuid().or(z.string()).optional(),
  region: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .optional()
}).strict()

const modelReasoningEffortSchema = z.string().min(1)
const SESSION_STATUS_GUIDANCE =
  'Cosmetic session status for human filtering. Suggested values: initial, processing, blocked (agent needs human input to continue with todos), completed (no next todo).'
const sessionStatusSchema = z.string().min(1).describe(SESSION_STATUS_GUIDANCE)

const createSessionBootstrapSchema = createAgentSchema.extend({
  title: z.string().min(1).optional(),
  message: z.string().min(1),
  harness: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  modelReasoningEffort: modelReasoningEffortSchema.optional()
}).strict()

const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentAgentId: z.uuid().or(z.string()).nullish(),
  imageId: z.string().nullable().optional(),
  imageVariantId: z.string().nullable().optional(),
  image: z
    .object({
      id: z.string(),
      name: z.string()
    })
    .nullable()
    .optional(),
  currentSandboxId: z.string().nullable().optional(),
  sandboxName: z.string().nullable().optional(),
  snapshotImageId: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  status: z.enum(['active', 'snapshotting', 'completed', 'archived'] as const),
  createdBy: z.string(),
  createdByUser: z.object({
    id: z.string(),
    name: z.string()
  }),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date())
})

const agentRuntimeAccessSchema = z.object({
  openVscodeUrl: z.string(),
  noVncUrl: z.string(),
  agentApiUrl: z.string(),
  agentSessionId: z.string(),
  agentAuthToken: z.string(),
  agentAuthExpiresInSeconds: z.number().int().positive()
})

const createSessionBootstrapResponseSchema = z.object({
  agent: agentSchema,
  session: z.object({
    id: z.string(),
    streamUrl: z.string(),
    runId: z.string(),
    runStreamUrl: z.string()
  }),
  access: agentRuntimeAccessSchema
})

const sessionIdParamsSchema = z.object({
  id: z.string().min(1)
})

const upsertSessionContentSchema = z.object({
  agentId: z.uuid().or(z.string().min(1)),
  isArchived: z.boolean().optional(),
  status: sessionStatusSchema.optional(),
  harness: z.string().min(1).optional(),
  externalSessionId: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  firstUserMessageBody: z.string().nullable().optional(),
  lastMessageBody: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  modelReasoningEffort: z.string().nullable().optional()
})

const sessionContentSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  imageId: z.string().nullable(),
  createdBy: z.string(),
  status: sessionStatusSchema,
  isArchived: z.boolean(),
  harness: z.string(),
  externalSessionId: z.string().nullable(),
  title: z.string().nullable(),
  firstUserMessageBody: z.string().nullable(),
  lastMessageBody: z.string().nullable(),
  model: z.string().nullable(),
  modelReasoningEffort: z.string().nullable(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date())
})

const sessionTimeRangeSchema = z.enum(['all', '24h', '7d', '30d', '90d'])
const sessionArchivedFilterSchema = z.enum(['all', 'true', 'false'])

const listSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
  agentId: z.uuid().or(z.string().min(1)).optional(),
  imageId: z.uuid().or(z.string().min(1)).optional(),
  createdBy: z.string().min(1).optional(),
  status: sessionStatusSchema.optional(),
  archived: sessionArchivedFilterSchema.default('false'),
  updatedAtRange: sessionTimeRangeSchema.default('all'),
  createdAtRange: sessionTimeRangeSchema.default('all'),
  q: z.string().min(1).optional()
})

const listSessionsResponseSchema = z.object({
  data: z.array(sessionContentSchema),
  nextCursor: z.string().nullable()
})

const listSessionGroupsQuerySchema = z.object({
  by: z.enum(['imageId', 'createdBy', 'status']).default('imageId'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  agentId: z.uuid().or(z.string().min(1)).optional(),
  imageId: z.uuid().or(z.string().min(1)).optional(),
  createdBy: z.string().min(1).optional(),
  status: sessionStatusSchema.optional(),
  archived: sessionArchivedFilterSchema.default('false'),
  updatedAtRange: sessionTimeRangeSchema.default('all'),
  createdAtRange: sessionTimeRangeSchema.default('all'),
  q: z.string().min(1).optional()
})

const listSessionGroupsResponseSchema = z.object({
  data: z.array(
    z.object({
      key: z.string().nullable(),
      label: z.string(),
      latestUpdatedAt: z.string(),
      sessions: z.array(sessionContentSchema)
    })
  )
})

const sessionCursorSchema = z.object({
  updatedAt: z.string().min(1),
  id: z.string().min(1)
})

function buildReadableSessionCondition (userId: string) {
  const trimmedUserId = userId.trim()
  return or(
    eq(agents.visibility, 'shared'),
    eq(agents.createdBy, trimmedUserId)
  )
}

function base64UrlEncode (text: string): string {
  return Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlDecode (text: string): string {
  const padded = text + '='.repeat((4 - (text.length % 4)) % 4)
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf8')
}

function encodeCursor (cursor: z.infer<typeof sessionCursorSchema>): string {
  return base64UrlEncode(JSON.stringify(cursor))
}

function decodeCursor (cursor: string): z.infer<typeof sessionCursorSchema> {
  try {
    const json = base64UrlDecode(cursor)
    const parsed = JSON.parse(json) as unknown
    return sessionCursorSchema.parse(parsed)
  } catch {
    throw new HTTPException(400, { message: 'Invalid cursor' })
  }
}

function parseCommaSeparated (value: string | undefined): string[] {
  if (!value) return []
  return value.split(',').map(v => v.trim()).filter(v => v.length > 0)
}

function getRangeStart (range: z.infer<typeof sessionTimeRangeSchema>): Date | null {
  const nowMs = Date.now()
  switch (range) {
    case '24h':
      return new Date(nowMs - 24 * 60 * 60 * 1000)
    case '7d':
      return new Date(nowMs - 7 * 24 * 60 * 60 * 1000)
    case '30d':
      return new Date(nowMs - 30 * 24 * 60 * 60 * 1000)
    case '90d':
      return new Date(nowMs - 90 * 24 * 60 * 60 * 1000)
    case 'all':
    default:
      return null
  }
}

registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}`,
    summary: 'List sessions',
    tags: ['session'],
    security: [{ bearerAuth: [] }],
    request: { query: listSessionsQuerySchema },
    responses: {
      200: listSessionsResponseSchema,
      400: z.object({ error: z.string() })
    }
  },
  '/',
  zValidator('query', listSessionsQuerySchema),
  async c => {
    const user = c.get('user')
    const query = c.req.valid('query' as never) as z.infer<
      typeof listSessionsQuerySchema
    >

    const decodedCursor = query.cursor ? decodeCursor(query.cursor) : null
    const conditions = [buildReadableSessionCondition(user.id)]

    const agentIds = parseCommaSeparated(query.agentId)
    if (agentIds.length === 1) {
      conditions.push(eq(sessions.agentId, agentIds[0]!))
    } else if (agentIds.length > 1) {
      conditions.push(inArray(sessions.agentId, agentIds))
    }

    const imageIds = parseCommaSeparated(query.imageId)
    if (imageIds.length === 1) {
      conditions.push(eq(agents.imageId, imageIds[0]!))
    } else if (imageIds.length > 1) {
      conditions.push(inArray(agents.imageId, imageIds))
    }

    const createdByValues = parseCommaSeparated(query.createdBy)
    if (createdByValues.length === 1) {
      conditions.push(eq(sessions.createdBy, createdByValues[0]!))
    } else if (createdByValues.length > 1) {
      conditions.push(inArray(sessions.createdBy, createdByValues))
    }

    const statuses = parseCommaSeparated(query.status)
    if (statuses.length === 1) {
      conditions.push(eq(sessions.status, statuses[0]!))
    } else if (statuses.length > 1) {
      conditions.push(inArray(sessions.status, statuses))
    }

    if (query.archived === 'true') {
      conditions.push(eq(sessions.isArchived, true))
    } else if (query.archived === 'false') {
      conditions.push(eq(sessions.isArchived, false))
    }

    const updatedAtStart = getRangeStart(query.updatedAtRange)
    if (updatedAtStart) {
      conditions.push(gte(sessions.updatedAt, updatedAtStart))
    }

    const createdAtStart = getRangeStart(query.createdAtRange)
    if (createdAtStart) {
      conditions.push(gte(sessions.createdAt, createdAtStart))
    }

    if (query.q && query.q.trim().length > 0) {
      const raw = query.q.trim()
      conditions.push(
        or(
          sql`${sessions.agentId}::text ILIKE ${`${raw}%`}`,
          ilike(sessions.id, `${raw}%`),
          ilike(sessions.externalSessionId, `%${raw}%`),
          ilike(sessions.title, `%${raw}%`)
        )!
      )
    }

    if (decodedCursor) {
      const cursorUpdatedAt = new Date(decodedCursor.updatedAt)
      if (!Number.isFinite(cursorUpdatedAt.getTime())) {
        throw new HTTPException(400, { message: 'Invalid cursor' })
      }
      conditions.push(
        or(
          lt(sessions.updatedAt, cursorUpdatedAt),
          and(
            eq(sessions.updatedAt, cursorUpdatedAt),
            lt(sessions.id, decodedCursor.id)
          )
        )!
      )
    }

    const rows = await db
      .select()
      .from(sessions)
      .innerJoin(agents, eq(sessions.agentId, agents.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(sessions.updatedAt), desc(sessions.id))
      .limit(query.limit + 1)

    const sessionRows = rows.map(row => ({
      ...row.sessions,
      imageId: row.agents.imageId ?? null
    }))
    const hasMore = sessionRows.length > query.limit
    if (hasMore) sessionRows.pop()

    const last = sessionRows[sessionRows.length - 1]
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            updatedAt: last.updatedAt.toISOString(),
            id: last.id
          })
        : null

    return c.json({
      data: sessionRows,
      nextCursor
    })
  }
)

registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/groups`,
    summary: 'List session groups',
    tags: ['session'],
    security: [{ bearerAuth: [] }],
    request: { query: listSessionGroupsQuerySchema },
    responses: {
      200: listSessionGroupsResponseSchema,
      400: z.object({ error: z.string() })
    }
  },
  '/groups',
  zValidator('query', listSessionGroupsQuerySchema),
  async c => {
    const user = c.get('user')
    const query = c.req.valid('query' as never) as z.infer<
      typeof listSessionGroupsQuerySchema
    >
    const conditions = [buildReadableSessionCondition(user.id)]

    const gAgentIds = parseCommaSeparated(query.agentId)
    if (gAgentIds.length === 1) {
      conditions.push(eq(sessions.agentId, gAgentIds[0]!))
    } else if (gAgentIds.length > 1) {
      conditions.push(inArray(sessions.agentId, gAgentIds))
    }
    const gImageIds = parseCommaSeparated(query.imageId)
    if (gImageIds.length === 1) {
      conditions.push(eq(agents.imageId, gImageIds[0]!))
    } else if (gImageIds.length > 1) {
      conditions.push(inArray(agents.imageId, gImageIds))
    }
    const gCreatedByValues = parseCommaSeparated(query.createdBy)
    if (gCreatedByValues.length === 1) {
      conditions.push(eq(sessions.createdBy, gCreatedByValues[0]!))
    } else if (gCreatedByValues.length > 1) {
      conditions.push(inArray(sessions.createdBy, gCreatedByValues))
    }
    const gStatuses = parseCommaSeparated(query.status)
    if (gStatuses.length === 1) {
      conditions.push(eq(sessions.status, gStatuses[0]!))
    } else if (gStatuses.length > 1) {
      conditions.push(inArray(sessions.status, gStatuses))
    }
    if (query.archived === 'true') {
      conditions.push(eq(sessions.isArchived, true))
    } else if (query.archived === 'false') {
      conditions.push(eq(sessions.isArchived, false))
    }

    const updatedAtStart = getRangeStart(query.updatedAtRange)
    if (updatedAtStart) {
      conditions.push(gte(sessions.updatedAt, updatedAtStart))
    }

    const createdAtStart = getRangeStart(query.createdAtRange)
    if (createdAtStart) {
      conditions.push(gte(sessions.createdAt, createdAtStart))
    }

    if (query.q && query.q.trim().length > 0) {
      const raw = query.q.trim()
      conditions.push(
        or(
          sql`${sessions.agentId}::text ILIKE ${`${raw}%`}`,
          ilike(sessions.id, `${raw}%`),
          ilike(sessions.externalSessionId, `%${raw}%`),
          ilike(sessions.title, `%${raw}%`)
        )!
      )
    }

    const rows = await db
      .select()
      .from(sessions)
      .innerJoin(agents, eq(sessions.agentId, agents.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(sessions.updatedAt), desc(sessions.id))
      .limit(query.limit)

    const sessionRows = rows.map(row => ({
      ...row.sessions,
      imageId: row.agents.imageId ?? null
    }))

    const groupsByKey = new Map<
      string,
      {
        key: string | null
        label: string
        latestUpdatedAt: string
        sessions: Array<(typeof sessionRows)[number]>
      }
    >()
    const orderedKeys: string[] = []

    for (const session of sessionRows) {
      let key: string | null
      let label: string
      switch (query.by) {
        case 'createdBy':
          key = session.createdBy || null
          label = session.createdBy || 'Unknown'
          break
        case 'status':
          key = session.status || null
          label = session.status || 'Unknown'
          break
        case 'imageId':
        default:
          key = session.imageId ?? null
          label = session.imageId ?? 'No image'
          break
      }

      const bucketKey = key ?? '__null__'
      const existing = groupsByKey.get(bucketKey)
      if (existing) {
        existing.sessions.push(session)
      } else {
        groupsByKey.set(bucketKey, {
          key,
          label,
          latestUpdatedAt: session.updatedAt.toISOString(),
          sessions: [session]
        })
        orderedKeys.push(bucketKey)
      }
    }

    return c.json({
      data: orderedKeys
        .map(key => groupsByKey.get(key))
        .filter((group): group is NonNullable<typeof group> => group !== undefined)
    })
  }
)

registerRoute(
  app,
  {
    method: 'put',
    path: `${BASE}/{id}`,
    summary: 'Upsert session content',
    tags: ['session'],
    security: [{ bearerAuth: [] }],
    request: {
      params: sessionIdParamsSchema,
      json: upsertSessionContentSchema
    },
    responses: {
      200: z.object({ session: sessionContentSchema }),
      404: z.object({ error: z.string() }),
      409: z.object({ error: z.string() })
    }
  },
  '/:id',
  zValidator('param', sessionIdParamsSchema),
  zValidator('json', upsertSessionContentSchema),
  async c => {
    const user = c.get('user')
    const authMode = (c.get('authMode') ?? 'jwt') as
      | 'jwt'
      | 'runtime-internal'
    const runtimeAgentId = c.get('runtimeAgentId') ?? null
    const { id } = c.req.valid('param' as never) as z.infer<
      typeof sessionIdParamsSchema
    >
    const body = c.req.valid('json' as never) as z.infer<
      typeof upsertSessionContentSchema
    >

    if (
      authMode === 'runtime-internal' &&
      runtimeAgentId !== null &&
      body.agentId !== runtimeAgentId
    ) {
      return c.json(
        { error: 'Runtime internal auth agent mismatch' },
        401
      )
    }

    const targetAgent = await getAgentById(body.agentId)
    if (!targetAgent) {
      return c.json({ error: 'Agent not found' }, 404)
    }
    if (
      authMode === 'jwt' &&
      targetAgent.visibility !== 'shared' &&
      targetAgent.createdBy !== user.id
    ) {
      return c.json({ error: 'Agent not found' }, 404)
    }
    const existing = await db
      .select({
        id: sessions.id,
        agentId: sessions.agentId,
        createdBy: sessions.createdBy
      })
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1)
    const existingRow = existing[0] ?? null

    if (existingRow && authMode === 'jwt') {
      const existingAgent = await getAgentById(existingRow.agentId)
      if (!existingAgent) return c.json({ error: 'Session not found' }, 404)
      if (
        existingAgent.visibility !== 'shared' &&
        existingAgent.createdBy !== user.id
      ) {
        return c.json({ error: 'Session not found' }, 404)
      }
    }
    if (existingRow && existingRow.agentId !== body.agentId) {
      return c.json(
        { error: 'Session ID already belongs to a different agent' },
        409
      )
    }

    const nextCreatedBy = existingRow?.createdBy ?? user.id

    const updateSet: Partial<typeof sessions.$inferInsert> = {
      agentId: body.agentId,
      status: body.status ?? 'initial',
      harness: body.harness ?? 'codex',
      updatedAt: new Date()
    }
    if ('isArchived' in body) {
      updateSet.isArchived = body.isArchived ?? false
    }
    if ('externalSessionId' in body) {
      updateSet.externalSessionId = body.externalSessionId ?? null
    }
    if ('title' in body) {
      updateSet.title = body.title ?? null
    }
    if ('firstUserMessageBody' in body) {
      updateSet.firstUserMessageBody = body.firstUserMessageBody ?? null
    }
    if ('lastMessageBody' in body) {
      updateSet.lastMessageBody = body.lastMessageBody ?? null
    }
    if ('model' in body) {
      updateSet.model = body.model ?? null
    }
    if ('modelReasoningEffort' in body) {
      updateSet.modelReasoningEffort = body.modelReasoningEffort ?? null
    }

    const [upserted] = await db
      .insert(sessions)
      .values({
        id,
        agentId: body.agentId,
        createdBy: nextCreatedBy,
        isArchived: body.isArchived ?? false,
        status: body.status ?? 'initial',
        harness: body.harness ?? 'codex',
        externalSessionId: body.externalSessionId ?? null,
        title: body.title ?? null,
        firstUserMessageBody: body.firstUserMessageBody ?? null,
        lastMessageBody: body.lastMessageBody ?? null,
        model: body.model ?? null,
        modelReasoningEffort: body.modelReasoningEffort ?? null
      })
      .onConflictDoUpdate({
        target: sessions.id,
        set: updateSet
      })
      .returning()

    if (!upserted) {
      throw new HTTPException(500, { message: 'Failed to upsert session' })
    }

    return c.json({ session: upserted })
  }
)

registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}`,
    summary:
      'Create an agent, create/fetch its deterministic session, and start the first message run',
    tags: ['session'],
    security: [{ bearerAuth: [] }],
    request: { json: createSessionBootstrapSchema },
    responses: {
      201: createSessionBootstrapResponseSchema,
      404: z.object({ error: z.string() }),
      409: z.object({ error: z.string() }),
      502: z.object({ error: z.string() })
    }
  },
  '/',
  zValidator('json', createSessionBootstrapSchema),
  async c => {
    const user = c.get('user')
    const body = c.req.valid('json' as never) as z.infer<
      typeof createSessionBootstrapSchema
    >
    try {
      const result = await createSessionBootstrap({ user, body })
      return c.json(result, 201)
    } catch (err) {
      if (
        err instanceof HTTPException &&
        (err.status === 404 || err.status === 409)
      ) {
        return c.json({ error: err.message }, err.status)
      }
      throw err
    }
  }
)

export { app as sessionRoutes }
