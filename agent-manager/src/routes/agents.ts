import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { AppEnv } from '../types/context'
import type { AgentStatus } from '../db/enums'
import { log } from '../log'
import { registerRoute } from '../openapi/registry'
import {
  AgentNameConflictError,
  createAgent,
  getAgentById,
  listAgentGroups,
  listAgents,
  listAgentsByIds,
  archiveAgent,
  resumeAgent,
  clearAgentSandbox,
  setAgentCheckpointSnapshot,
  setAgentStatusIfMatches,
  setAgentStatus
} from '../services/agent.service'
import {
  getImageById,
  getImageByIdIncludingArchived,
  resolveImageVariantForUser
} from '../services/image.service'
import { getUserById } from '../services/user.service'
import {
  buildModalSandboxAccessUrls,
  agentIdToAgentSessionId,
  terminateAgentSandbox,
  ensureAgentSandbox,
  getAgentSandbox,
  isAgentSandboxHealthy,
  snapshotAgentSandbox
} from '../services/sandbox.service'
import { withLock } from '../services/lock.service'
import { getSandboxAgentToken } from '../services/sandbox.service'
import { DEFAULT_REGION } from '../utils/region'
import { agents } from '../db/schema'

type DbAgent = typeof agents.$inferSelect // row returned from SELECT / .returning()

const app = new Hono<AppEnv>()
const BASE = '/agents'
const AGENT_SANDBOX_MUTATION_LOCK_WAIT_MS = 5 * 60 * 1000
const AGENT_SANDBOX_MUTATION_LOCK_TTL_MS = 60 * 1000
const SANDBOX_AGENT_TOKEN_TTL_SECONDS = 5 * 60
const AGENT_STATUS_VALUES = [
  'active',
  'snapshotting',
  'completed',
  'archived'
] as const

const createAgentSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .default(() => randomUUID()),
  parentAgentId: z.string().uuid().optional(),
  imageId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  region: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .optional()
})

const booleanQueryParam = z.enum(['true', 'false']).transform(v => v === 'true')

const listAgentsQuery = z.object({
  status: z.enum(AGENT_STATUS_VALUES).optional(),
  imageId: z.string().uuid().optional(),
  noImage: booleanQueryParam.optional(),
  archived: booleanQueryParam.optional(),
  parentAgentId: z.string().uuid().optional(),
  q: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional()
})

const listAgentGroupsQuery = z.object({
  by: z.enum(['imageId', 'createdBy'] as const),
  previewN: z.coerce.number().int().min(5).max(50),
  archived: booleanQueryParam.optional()
})

const agentsHealthSchema = z.object({
  agentIds: z.array(z.string().uuid()).min(1).max(50)
})

const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentAgentId: z.string().uuid().nullable().optional(),
  imageId: z.string().nullable().optional(),
  imageVariantId: z.string().uuid().nullable().optional(),
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
  status: z.enum(AGENT_STATUS_VALUES),
  createdBy: z.string(),
  createdByUser: z.object({
    id: z.string(),
    name: z.string()
  }),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date())
})

const agentWithSubAgentsSchema = agentSchema.extend({
  subAgents: z.array(agentSchema).optional()
})

const agentRuntimeAccessSchema = z.object({
  openVscodeUrl: z.string(),
  noVncUrl: z.string(),
  agentApiUrl: z.string(),
  agentSessionId: z.string(),
  agentAuthToken: z.string(),
  agentAuthExpiresInSeconds: z.number().int().positive()
})

function toPublicAgent<T extends Record<string, unknown>> (
  agent: T
): Omit<T, 'sandboxAccessToken'> {
  const { sandboxAccessToken: _token, ...rest } = agent as T & {
    sandboxAccessToken?: unknown
  }
  return rest
}

async function toHydratedPublicAgent (
  user: { readonly id: string; readonly name: string },
  agent: DbAgent,
  options?: {
    readonly image?: { readonly id: string; readonly name: string } | null
  }
) {
  const publicAgent = toPublicAgent(agent)
  const image =
    options?.image !== undefined
      ? options.image
      : typeof publicAgent.imageId === 'string' &&
        publicAgent.imageId.length > 0
      ? await getImageByIdIncludingArchived(publicAgent.imageId)
      : null
  const createdByUser =
    agent.createdBy === user.id
      ? { id: user.id, name: user.name }
      : await getUserById(agent.createdBy).then(creator =>
          creator
            ? { id: creator.id, name: creator.name }
            : { id: agent.createdBy, name: 'Unknown' }
        )

  return {
    ...publicAgent,
    createdByUser,
    image: image ? { id: image.id, name: image.name } : null
  }
}

// NOTE: We use Modal tunnels (not connect tokens) for manager<->sandbox HTTP calls so the
// sandbox agent API port can be configured independently of Modal's connect-token routing.

async function getAuthorizedImage (imageId: string) {
  const image = await getImageById(imageId)
  return image ?? null
}

type RuntimeAccessPayload = z.infer<typeof agentRuntimeAccessSchema>

async function buildRuntimeAccessPayload (input: {
  readonly userId: string
  readonly agentId: string
  readonly tunnels: {
    readonly openVscodeUrl: string
    readonly noVncUrl: string
    readonly agentApiUrl: string
  }
  readonly sandboxAccessToken: string
}): Promise<RuntimeAccessPayload> {
  const links = buildModalSandboxAccessUrls({
    tunnels: input.tunnels,
    sandboxAccessToken: input.sandboxAccessToken
  })

  const agentSessionId = agentIdToAgentSessionId(input.agentId)
  const cachedAgentAuth = await getSandboxAgentToken({
    userId: input.userId,
    agentId: input.agentId,
    agentSessionId,
    expiresInSeconds: SANDBOX_AGENT_TOKEN_TTL_SECONDS
  })

  return {
    ...links,
    agentApiUrl: input.tunnels.agentApiUrl,
    agentSessionId,
    agentAuthToken: cachedAgentAuth.token,
    agentAuthExpiresInSeconds: cachedAgentAuth.expiresInSeconds
  }
}

// List agents
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}`,
    summary: 'List agents',
    tags: ['agents'],
    security: [{ bearerAuth: [] }],
    request: { query: listAgentsQuery },
    responses: {
      200: z.object({
        data: z.array(agentWithSubAgentsSchema),
        nextCursor: z.string().nullable()
      })
    }
  },
  '/',
  zValidator('query', listAgentsQuery),
  async c => {
    const query = c.req.valid('query' as never) as z.infer<
      typeof listAgentsQuery
    >
    if (query.imageId && query.noImage)
      return c.json(
        { error: 'imageId and noImage are mutually exclusive' },
        400
      )
    const result = await listAgents({
      status: query.status as AgentStatus | undefined,
      imageId: query.imageId,
      noImage: query.noImage,
      archived: query.archived,
      parentAgentId: query.parentAgentId,
      search: query.q?.trim() || undefined,
      limit: query.limit,
      cursor: query.cursor
    })
    return c.json({
      data: result.agents.map(a =>
        toPublicAgent(a as unknown as Record<string, unknown>)
      ),
      nextCursor: result.nextCursor
    })
  }
)

// List agent groups
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/groups`,
    summary: 'List agent groups',
    tags: ['agents'],
    security: [{ bearerAuth: [] }],
    request: { query: listAgentGroupsQuery },
    responses: {
      200: z.object({
        data: z.array(
          z.object({
            key: z.string().nullable(),
            label: z.string(),
            latestUpdatedAt: z.string(),
            preview: z.array(agentSchema),
            nextCursor: z.string().nullable()
          })
        )
      })
    }
  },
  '/groups',
  zValidator('query', listAgentGroupsQuery),
  async c => {
    const query = c.req.valid('query' as never) as z.infer<
      typeof listAgentGroupsQuery
    >
    const result = await listAgentGroups({
      by: query.by,
      previewN: query.previewN,
      archived: query.archived
    })
    return c.json({
      data: result.groups.map(g => ({
        ...g,
        preview: g.preview.map(a =>
          toPublicAgent(a as unknown as Record<string, unknown>)
        )
      }))
    })
  }
)

// Batch liveness (best-effort; does not create sandboxes).
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/health`,
    summary: 'Get sandbox liveness for agents',
    tags: ['agents'],
    security: [{ bearerAuth: [] }],
    request: { json: agentsHealthSchema },
    responses: {
      200: z.object({
        aliveByAgentId: z.record(z.string(), z.boolean())
      })
    }
  },
  '/health',
  zValidator('json', agentsHealthSchema),
  async c => {
    const body = c.req.valid('json' as never) as z.infer<
      typeof agentsHealthSchema
    >

    const rows = await listAgentsByIds({
      agentIds: body.agentIds
    })

    const aliveByAgentId: Record<string, boolean> = {}
    const queue = rows.slice()
    const concurrency = Math.min(8, queue.length)

    await Promise.all(
      Array.from({ length: concurrency }).map(async () => {
        while (queue.length > 0) {
          const next = queue.pop()
          if (!next) return

          if (!next.currentSandboxId) {
            aliveByAgentId[next.id] = false
            continue
          }

          aliveByAgentId[next.id] = await isAgentSandboxHealthy({
            sandboxId: next.currentSandboxId
          })
        }
      })
    )

    return c.json({ aliveByAgentId })
  }
)

// Create agent
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}`,
    summary: 'Create agent',
    tags: ['agents'],
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    request: { json: createAgentSchema },
    responses: {
      201: agentSchema,
      409: z.object({ error: z.string() })
    }
  },
  '/',
  zValidator('json', createAgentSchema),
  async c => {
    const user = c.get('user')
    const body = c.req.valid('json' as never) as z.infer<
      typeof createAgentSchema
    >

    const image = await getAuthorizedImage(body.imageId)
    if (!image) return c.json({ error: 'Image not found' }, 404)
    const variant = await resolveImageVariantForUser({
      imageId: body.imageId,
      userId: user.id,
      variantId: body.variantId
    })
    if (!variant) {
      return c.json({ error: 'Image variant not found' }, 404)
    }
    if (!variant.headImageId) {
      return c.json({ error: 'Image is not built yet' }, 409)
    }

    let parentAgentId: string | null = null
    if (body.parentAgentId) {
      const parent = await getAgentById(body.parentAgentId)
      if (!parent) {
        return c.json({ error: 'Parent agent not found' }, 404)
      }
      parentAgentId = parent.id
    }

    const region = body.region ?? user.defaultRegion ?? DEFAULT_REGION
    let agent: DbAgent
    try {
      agent = await createAgent({
        name: body.name,
        parentAgentId,
        imageId: body.imageId,
        imageVariantId: variant.id,
        createdBy: user.id,
        region
      })
    } catch (err) {
      if (err instanceof AgentNameConflictError) {
        return c.json({ error: err.message }, 409)
      }
      throw err
    }
    await ensureAgentSandbox({
      agentId: agent.id,
      imageId: variant.headImageId,
      region
    })
    const updatedAgent = await getAgentById(agent.id)
    if (!updatedAgent) {
      throw new Error('Agent not found - should not happen')
    }
    const hydrated = await toHydratedPublicAgent(
      { id: user.id, name: user.name },
      updatedAgent,
      { image: { id: image.id, name: image.name } }
    )
    return c.json(hydrated, 201)
  }
)

// Get editor/browser links (OpenVSCode + noVNC) for the agent sandbox
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/:agentId/access`,
    summary: 'Get editor/browser access for an agent sandbox',
    tags: ['agents'],
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    responses: {
      200: agentRuntimeAccessSchema,
      404: z.object({ error: z.string() }),
      409: z.object({ error: z.string() })
    }
  },
  '/:agentId/access',
  async c => {
    const user = c.get('user')
    const agentId = c.req.param('agentId')
    const existing = await getAgentById(agentId)
    if (!existing) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    try {
      const sandbox = await ensureAgentSandbox({ agentId })
      return c.json(
        await buildRuntimeAccessPayload({
          userId: user.id,
          agentId,
          tunnels: sandbox.tunnels,
          sandboxAccessToken: sandbox.sandboxAccessToken
        })
      )
    } catch (err) {
      const lockKey = `locks:agent-sandbox:create:${agentId}`
      if (
        err instanceof Error &&
        err.message === `Failed to acquire lock: ${lockKey}`
      ) {
        return c.json(
          {
            error:
              'Agent sandbox is busy (access/create in progress). Try again shortly.'
          },
          409
        )
      }
      log.error('agents.access.failed', {
        agentId,
        userId: user.id,
        error: err
      })
      throw new HTTPException(502, {
        message: `Failed to fetch sandbox access URLs: ${
          err instanceof Error ? err.message : String(err)
        }`
      })
    }
  }
)

registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/:agentId/snapshot`,
    summary: 'Snapshot an agent sandbox filesystem',
    tags: ['agents'],
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    responses: {
      200: z.object({
        snapshotImageId: z.string(),
        agent: agentSchema
      }),
      404: z.object({ error: z.string() }),
      409: z.object({ error: z.string() })
    }
  },
  '/:agentId/snapshot',
  async c => {
    const user = c.get('user')
    const agentId = c.req.param('agentId')
    const existing = await getAgentById(agentId)
    if (!existing) {
      return c.json({ error: 'Agent not found' }, 404)
    }
    if (!existing.currentSandboxId) {
      return c.json({ error: 'Agent has no active sandbox to snapshot' }, 409)
    }

    const lockKey = `locks:agent-sandbox:create:${agentId}`
    try {
      return await withLock(
        {
          key: lockKey,
          ttlMs: AGENT_SANDBOX_MUTATION_LOCK_TTL_MS,
          waitMs: AGENT_SANDBOX_MUTATION_LOCK_WAIT_MS,
          retryDelayMs: 250
        },
        async () => {
          const lockedAgent = await getAgentById(agentId)
          if (!lockedAgent) {
            return c.json({ error: 'Agent not found' }, 404)
          }
          if (!lockedAgent.currentSandboxId) {
            return c.json(
              { error: 'Agent has no active sandbox to snapshot' },
              409
            )
          }

          const previousStatus = lockedAgent.status
          await setAgentStatus(agentId, 'snapshotting')

          let snapshotImageId = ''
          try {
            const { sandbox } = await getAgentSandbox({ agentId })
            snapshotImageId = await snapshotAgentSandbox({
              sandboxId: sandbox.sandboxId
            })
            await setAgentCheckpointSnapshot({
              id: agentId,
              snapshotImageId
            })
          } catch (err) {
            log.error('agents.snapshot.failed', {
              agentId,
              userId: user.id,
              error: err
            })
            throw new HTTPException(502, {
              message: `Failed to snapshot sandbox: ${
                err instanceof Error ? err.message : String(err)
              }`
            })
          } finally {
            await setAgentStatusIfMatches({
              id: agentId,
              nextStatus: previousStatus,
              expectedStatus: 'snapshotting'
            }).catch(err => {
              log.warn('agents.snapshot.restore_status_failed', {
                agentId,
                previousStatus,
                error: err
              })
            })
          }

          const updated = await getAgentById(agentId)
          if (!updated) {
            throw new Error('Agent not found - should not happen')
          }

          const hydrated = await toHydratedPublicAgent(
            { id: user.id, name: user.name },
            updated
          )
          return c.json({ snapshotImageId, agent: hydrated })
        }
      )
    } catch (err) {
      if (
        err instanceof Error &&
        err.message === `Failed to acquire lock: ${lockKey}`
      ) {
        return c.json(
          {
            error:
              'Agent sandbox is busy (create/snapshot in progress). Try again shortly.'
          },
          409
        )
      }
      log.error('agents.snapshot.lock_failed', {
        agentId,
        userId: user.id,
        error: err
      })
      throw err
    }
  }
)

// Get agent
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/:agentId`,
    summary: 'Get agent',
    tags: ['agents'],
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    responses: {
      200: agentSchema,
      404: z.object({ error: z.string() })
    }
  },
  '/:agentId',
  async c => {
    const user = c.get('user')
    const agentId = c.req.param('agentId')
    const agent = await getAgentById(agentId)
    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404)
    }
    const hydrated = await toHydratedPublicAgent(
      { id: user.id, name: user.name },
      agent
    )
    return c.json(hydrated)
  }
)

// Archive agent
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/:agentId/archive`,
    summary: 'Archive agent',
    tags: ['agents'],
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    responses: {
      200: agentSchema,
      404: z.object({ error: z.string() })
    }
  },
  '/:agentId/archive',
  async c => {
    const user = c.get('user')
    const agentId = c.req.param('agentId')
    const existing = await getAgentById(agentId)
    if (!existing)
      return c.json({ error: 'Agent not found' }, 404)

    if (existing.currentSandboxId) {
      try {
        await terminateAgentSandbox({ sandboxId: existing.currentSandboxId })
      } catch {
        // best-effort
      }
      try {
        await clearAgentSandbox(agentId)
      } catch {
        // best-effort
      }
    }

    const agent = await archiveAgent(agentId)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    const hydrated = await toHydratedPublicAgent(
      { id: user.id, name: user.name },
      agent
    )
    return c.json(hydrated)
  }
)

// Resume agent (un-archive)
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/:agentId/resume`,
    summary: 'Resume agent',
    tags: ['agents'],
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    responses: {
      200: agentSchema,
      404: z.object({ error: z.string() })
    }
  },
  '/:agentId/resume',
  async c => {
    const user = c.get('user')
    const agentId = c.req.param('agentId')
    const existing = await getAgentById(agentId)
    if (!existing) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const agent = await resumeAgent(agentId)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    const hydrated = await toHydratedPublicAgent(
      { id: user.id, name: user.name },
      agent
    )
    return c.json(hydrated)
  }
)

export { app as agentsRoutes }
