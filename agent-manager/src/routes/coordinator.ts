import { Hono } from 'hono'
import type { Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { stream } from 'hono/streaming'
import type { AppEnv } from '../types/context'
import { registerRoute } from '../openapi/registry'
import { log } from '../log'
import {
  createCoordinatorSession,
  getCoordinatorSessionById,
  getMessagesByCoordinatorSessionId,
  listCoordinatorSessions,
  deleteCoordinatorSession,
  updateCoordinatorSessionTitle,
} from '../services/coordinator-session.service'
import {
  cancelAgentRun,
  getAgentRunInfo,
  startAgentRun,
  submitAgentRunClientToolResult,
  subscribeAgentRunEvents,
} from '../services/agent-run-manager'
import { transcribeAudioToText } from '../services/transcription.service'

const app = new Hono<AppEnv>()
const BASE = '/coordinator'
const SSE_PING_INTERVAL_MS = 15_000

const createCoordinatorSessionSchema = z.object({
  title: z.string().min(1).max(255).optional(),
})

const createCoordinatorRunSchema = z.object({
  message: z.string().min(1),
  browserAvailable: z.boolean().optional(),
})

const listCoordinatorSessionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
})

const updateCoordinatorSessionSchema = z.object({
  title: z.string().min(1).max(255),
})

const runStreamParamsSchema = z.object({
  runId: z.string().uuid(),
})

const runStreamQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
})

const runInfoSchema = z.object({
  runId: z.string().uuid(),
  coordinatorSessionId: z.string(),
  status: z.enum(["running", "completed", "error", "canceled"]),
  errorMessage: z.string().nullable(),
})

const runCancelSchema = z.object({
  reason: z.string().trim().min(1).max(200).optional(),
})

const runToolResultSchema = z.object({
  toolCallId: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
})

const transcriptionResultSchema = z.object({
  text: z.string(),
  model: z.string(),
})

const coordinatorSessionSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
})

const messageSchema = z.object({
  id: z.string(),
  coordinatorSessionId: z.string(),
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string(),
  toolCalls: z.unknown().nullable().optional(),
  toolResults: z.unknown().nullable().optional(),
  createdAt: z.string().or(z.date()),
})

const coordinatorSessionParamsSchema = z.object({
  coordinatorSessionId: z.string().uuid(),
})

function parseAfterEventId(c: Context<AppEnv>): number {
  const queryAfter = c.req.query('after')
  if (typeof queryAfter === 'string' && queryAfter.trim().length > 0) {
    const parsed = Number(queryAfter)
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed)
  }

  const lastEventId = c.req.header('Last-Event-ID')
  if (typeof lastEventId === 'string' && lastEventId.trim().length > 0) {
    const parsed = Number(lastEventId)
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed)
  }

  return 0
}

async function getOwnedCoordinatorSession(input: {
  readonly userId: string
  readonly coordinatorSessionId: string
}) {
  const coordinatorSession = await getCoordinatorSessionById(input.coordinatorSessionId)
  if (!coordinatorSession) return null
  if (coordinatorSession.createdBy !== input.userId) return null
  return coordinatorSession
}

function getBaseUrl(c: Context<AppEnv>): string {
  const protocol = c.req.header('x-forwarded-proto') ?? 'http'
  const host = c.req.header('host') ?? 'localhost:3000'
  return `${protocol}://${host}`
}

// Create coordinator session
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/session`,
    summary: 'Create a coordinator session',
    tags: ['agent'],
    security: [{ bearerAuth: [] }],
    request: { json: createCoordinatorSessionSchema },
    responses: {
      201: coordinatorSessionSchema,
    },
  },
  '/session',
  zValidator('json', createCoordinatorSessionSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json' as never) as z.infer<typeof createCoordinatorSessionSchema>
    const coordinatorSession = await createCoordinatorSession({
      createdBy: user.id,
      title: body.title,
    })
    return c.json(coordinatorSession, 201)
  },
)

// Start coordinator run for an existing coordinator session
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/session/:coordinatorSessionId/runs`,
    summary: 'Start a coordinator run for an existing session',
    tags: ['agent'],
    security: [{ bearerAuth: [] }],
    request: {
      params: coordinatorSessionParamsSchema,
      json: createCoordinatorRunSchema,
    },
    responses: {
      200: z.object({
        runId: z.string().uuid(),
        coordinatorSessionId: z.string().uuid(),
        streamUrl: z.string(),
      }),
      404: z.object({ error: z.string() }),
    },
  },
  '/session/:coordinatorSessionId/runs',
  zValidator('param', coordinatorSessionParamsSchema),
  zValidator('json', createCoordinatorRunSchema),
  async (c) => {
    const user = c.get('user')
    const params = c.req.valid('param' as never) as z.infer<typeof coordinatorSessionParamsSchema>
    const body = c.req.valid('json' as never) as z.infer<typeof createCoordinatorRunSchema>
    const coordinatorSession = await getOwnedCoordinatorSession({
      userId: user.id,
      coordinatorSessionId: params.coordinatorSessionId,
    })
    if (!coordinatorSession) {
      return c.json({ error: 'Coordinator session not found' }, 404)
    }

    const userAuthHeader = c.req.header('Authorization') ?? ''
    log.info('coordinator.run.create.request', {
      userId: user.id,
      coordinatorSessionId: coordinatorSession.id,
      messageChars: body.message.length
    })

    if (coordinatorSession.title === null) {
      const candidateTitle = body.message.trim().slice(0, 100)
      if (candidateTitle.length > 0) {
        await updateCoordinatorSessionTitle(coordinatorSession.id, candidateTitle)
      }
    }

    const { runId } = startAgentRun({
      coordinatorSessionId: coordinatorSession.id,
      userId: user.id,
      userMessage: body.message,
      baseUrl: getBaseUrl(c),
      userAuthHeader,
      browserAvailable: body.browserAvailable === true,
    })
    log.info('coordinator.run.create.started', {
      userId: user.id,
      coordinatorSessionId: coordinatorSession.id,
      runId
    })

    return c.json({
      runId,
      coordinatorSessionId: coordinatorSession.id,
      streamUrl: `${getBaseUrl(c)}${BASE}/runs/${runId}/stream`,
    })
  },
)

registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/runs/:runId/cancel`,
    summary: 'Cancel an existing agent run',
    tags: ['agent'],
    security: [{ bearerAuth: [] }],
    request: {
      params: runStreamParamsSchema,
      json: runCancelSchema,
    },
    responses: {
      200: z.object({
        ok: z.literal(true),
        status: z.enum(['canceled', 'already_canceled', 'already_finished']),
      }),
      404: z.object({ error: z.string() }),
    },
  },
  '/runs/:runId/cancel',
  zValidator('param', runStreamParamsSchema),
  zValidator('json', runCancelSchema),
  async (c) => {
    const user = c.get('user')
    const runId = c.req.param('runId')
    const body = c.req.valid('json' as never) as z.infer<typeof runCancelSchema>
    log.debug('coordinator.run.cancel.request', {
      userId: user.id,
      runId,
    })

    const canceled = cancelAgentRun({
      runId,
      userId: user.id,
      reason: body.reason,
    })
    if (!canceled.accepted) {
      log.warn('coordinator.run.cancel.not_found', { userId: user.id, runId })
      return c.json({ error: canceled.reason }, 404)
    }

    return c.json({ ok: true as const, status: canceled.status })
  },
)

// Subscribe to an existing run stream (resumable)
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/runs/:runId/stream`,
    summary: 'Stream events for an existing agent run',
    tags: ['agent'],
    security: [{ bearerAuth: [] }],
    request: { params: runStreamParamsSchema, query: runStreamQuerySchema },
    responses: { 200: z.object({ stream: z.string() }), 404: z.object({ error: z.string() }) },
  },
  '/runs/:runId/stream',
  zValidator('param', runStreamParamsSchema),
  zValidator('query', runStreamQuerySchema),
  async (c) => {
    const user = c.get('user')
    const runId = c.req.param('runId')
    log.debug('coordinator.run.stream.request', { userId: user.id, runId })

    const info = getAgentRunInfo(runId)
    if (!info || info.createdBy !== user.id) {
      log.warn('coordinator.run.stream.not_found', { userId: user.id, runId })
      return c.json({ error: 'Run not found' }, 404)
    }

    c.header('Content-Type', 'text/event-stream')
    c.header('Cache-Control', 'no-cache')
    c.header('Connection', 'keep-alive')

    return stream(c, async (streamWriter) => {
      const afterEventId = parseAfterEventId(c)
      let emittedEvents = 0
      const pingTimer = setInterval(() => {
        void streamWriter.write(`: ping\n\n`)
      }, SSE_PING_INTERVAL_MS)
      try {
        for await (const event of subscribeAgentRunEvents({
          runId,
          userId: user.id,
          afterEventId,
        })) {
          emittedEvents += 1
          await streamWriter.write(
            `id: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`,
          )
        }
      } catch (err) {
        log.warn('coordinator.run.stream.error', {
          userId: user.id,
          runId,
          emittedEvents,
          error: err
        })
        // Client disconnected.
      } finally {
        clearInterval(pingTimer)
        log.debug('coordinator.run.stream.closed', {
          userId: user.id,
          runId,
          emittedEvents
        })
      }
    })
  },
)

// Get run info (status/polling)
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/runs/:runId`,
    summary: 'Get status for an existing agent run',
    tags: ['agent'],
    security: [{ bearerAuth: [] }],
    request: { params: runStreamParamsSchema },
    responses: { 200: runInfoSchema, 404: z.object({ error: z.string() }) },
  },
  '/runs/:runId',
  zValidator('param', runStreamParamsSchema),
  async (c) => {
    const user = c.get('user')
    const runId = c.req.param('runId')
    log.debug('coordinator.run.info.request', { userId: user.id, runId })

    const info = getAgentRunInfo(runId)
    if (!info || info.createdBy !== user.id) {
      log.warn('coordinator.run.info.not_found', { userId: user.id, runId })
      return c.json({ error: 'Run not found' }, 404)
    }

    return c.json({
      runId: info.runId,
      coordinatorSessionId: info.coordinatorSessionId,
      status: info.status,
      errorMessage: info.errorMessage,
    })
  },
)

registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/runs/:runId/tool-result`,
    summary: 'Submit a client tool result for a pending run tool call',
    tags: ['agent'],
    security: [{ bearerAuth: [] }],
    request: {
      params: runStreamParamsSchema,
      json: runToolResultSchema,
    },
    responses: {
      200: z.object({
        ok: z.literal(true),
        status: z.enum(['accepted', 'already_resolved']),
      }),
      404: z.object({ error: z.string() }),
      409: z.object({ error: z.string() }),
    },
  },
  '/runs/:runId/tool-result',
  zValidator('param', runStreamParamsSchema),
  zValidator('json', runToolResultSchema),
  async (c) => {
    const user = c.get('user')
    const runId = c.req.param('runId')
    const body = c.req.valid('json' as never) as z.infer<typeof runToolResultSchema>
    log.debug('coordinator.run.tool_result.request', {
      userId: user.id,
      runId,
      toolCallId: body.toolCallId,
      ok: body.ok,
    })

    const submitted = submitAgentRunClientToolResult({
      runId,
      userId: user.id,
      toolCallId: body.toolCallId,
      ok: body.ok,
      result: body.result,
      error: body.error,
    })
    if (submitted.accepted) {
      return c.json({ ok: true as const, status: submitted.status })
    }

    if (submitted.reason === 'Run not found') {
      return c.json({ error: submitted.reason }, 404)
    }

    return c.json({ error: submitted.reason }, 409)
  },
)

registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/transcription`,
    summary: 'Transcribe uploaded audio for coordinator composer input',
    tags: ['agent'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: transcriptionResultSchema,
      400: z.object({ error: z.string() }),
    },
  },
  '/transcription',
  async (c) => {
    const body = await c.req.parseBody()
    const maybeFile = body.file
    const file =
      maybeFile instanceof File
        ? maybeFile
        : Array.isArray(maybeFile) && maybeFile[0] instanceof File
          ? maybeFile[0]
          : null

    if (!(file instanceof File)) {
      return c.json({ error: 'Audio file is required' }, 400)
    }

    const maybeModel = body.model
    const model =
      typeof maybeModel === 'string'
        ? maybeModel
        : Array.isArray(maybeModel) && typeof maybeModel[0] === 'string'
          ? maybeModel[0]
          : undefined

    try {
      const result = await transcribeAudioToText({
        audioFile: file,
        model,
      })
      return c.json(result)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Transcription failed'
      return c.json({ error: message }, 400)
    }
  },
)

// List coordinator sessions
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/session`,
    summary: 'List coordinator sessions for the current user',
    tags: ['agent'],
    security: [{ bearerAuth: [] }],
    request: { query: listCoordinatorSessionsQuery },
    responses: {
      200: z.object({
        data: z.array(coordinatorSessionSchema),
        nextCursor: z.string().nullable(),
      }),
    },
  },
  '/session',
  zValidator('query', listCoordinatorSessionsQuery),
  async (c) => {
    const user = c.get('user')
    const query = c.req.valid('query' as never) as z.infer<typeof listCoordinatorSessionsQuery>
    const result = await listCoordinatorSessions({
      userId: user.id,
      limit: query.limit,
      cursor: query.cursor,
    })
    return c.json({ data: result.coordinatorSessions, nextCursor: result.nextCursor })
  },
)

// Get coordinator session by ID
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/session/:coordinatorSessionId`,
    summary: 'Get a coordinator session by ID',
    tags: ['agent'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: coordinatorSessionSchema,
      404: z.object({ error: z.string() }),
    },
  },
  '/session/:coordinatorSessionId',
  zValidator('param', coordinatorSessionParamsSchema),
  async (c) => {
    const user = c.get('user')
    const params = c.req.valid('param' as never) as z.infer<typeof coordinatorSessionParamsSchema>
    const coordinatorSession = await getOwnedCoordinatorSession({
      userId: user.id,
      coordinatorSessionId: params.coordinatorSessionId,
    })
    if (!coordinatorSession) {
      return c.json({ error: 'Coordinator session not found' }, 404)
    }
    return c.json(coordinatorSession)
  },
)

// Get messages for a coordinator session
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/session/:coordinatorSessionId/messages`,
    summary: 'Get messages for a coordinator session',
    tags: ['agent'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: z.object({ data: z.array(messageSchema) }),
      404: z.object({ error: z.string() }),
    },
  },
  '/session/:coordinatorSessionId/messages',
  zValidator('param', coordinatorSessionParamsSchema),
  async (c) => {
    const user = c.get('user')
    const params = c.req.valid('param' as never) as z.infer<typeof coordinatorSessionParamsSchema>
    const coordinatorSession = await getOwnedCoordinatorSession({
      userId: user.id,
      coordinatorSessionId: params.coordinatorSessionId,
    })
    if (!coordinatorSession) {
      return c.json({ error: 'Coordinator session not found' }, 404)
    }
    const messages = await getMessagesByCoordinatorSessionId(params.coordinatorSessionId)
    return c.json({ data: messages })
  },
)

// Update coordinator session title
registerRoute(
  app,
  {
    method: 'patch',
    path: `${BASE}/session/:coordinatorSessionId`,
    summary: 'Update coordinator session title',
    tags: ['agent'],
    security: [{ bearerAuth: [] }],
    request: { json: updateCoordinatorSessionSchema },
    responses: {
      200: coordinatorSessionSchema,
      404: z.object({ error: z.string() }),
    },
  },
  '/session/:coordinatorSessionId',
  zValidator('param', coordinatorSessionParamsSchema),
  zValidator('json', updateCoordinatorSessionSchema),
  async (c) => {
    const user = c.get('user')
    const params = c.req.valid('param' as never) as z.infer<typeof coordinatorSessionParamsSchema>
    const body = c.req.valid('json' as never) as z.infer<typeof updateCoordinatorSessionSchema>

    const coordinatorSession = await getOwnedCoordinatorSession({
      userId: user.id,
      coordinatorSessionId: params.coordinatorSessionId,
    })
    if (!coordinatorSession) {
      return c.json({ error: 'Coordinator session not found' }, 404)
    }
    const updated = await updateCoordinatorSessionTitle(params.coordinatorSessionId, body.title)
    if (!updated) {
      return c.json({ error: 'Coordinator session not found' }, 404)
    }

    return c.json(updated)
  },
)

// Delete coordinator session
registerRoute(
  app,
  {
    method: 'delete',
    path: `${BASE}/session/:coordinatorSessionId`,
    summary: 'Delete a coordinator session',
    tags: ['agent'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: z.object({ ok: z.boolean() }),
      404: z.object({ error: z.string() }),
    },
  },
  '/session/:coordinatorSessionId',
  zValidator('param', coordinatorSessionParamsSchema),
  async (c) => {
    const user = c.get('user')
    const params = c.req.valid('param' as never) as z.infer<typeof coordinatorSessionParamsSchema>
    const coordinatorSession = await getOwnedCoordinatorSession({
      userId: user.id,
      coordinatorSessionId: params.coordinatorSessionId,
    })
    if (!coordinatorSession) {
      return c.json({ error: 'Coordinator session not found' }, 404)
    }
    await deleteCoordinatorSession(params.coordinatorSessionId)
    return c.json({ ok: true })
  },
)

export { app as agentRoutes }
