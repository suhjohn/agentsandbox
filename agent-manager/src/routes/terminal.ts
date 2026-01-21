import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context'
import { registerRoute } from '../openapi/registry'
import { getAgentById } from '../services/agent.service'
import {
  getImageSetupSandboxSession,
  getAgentTerminalAccess,
  getSetupSandboxTerminalAccess
} from '../services/sandbox.service'

const app = new Hono<AppEnv>()
const BASE = '/terminal'
const SANDBOX_AUTH_TOKEN_TTL_SECONDS = 15 * 60

const connectRequestSchema = z.discriminatedUnion('targetType', [
  z.object({
    targetType: z.literal('setupSandbox'),
    targetId: z.string().min(1)
  }),
  z.object({
    targetType: z.literal('agentSandbox'),
    targetId: z.string().uuid()
  })
])

const connectResponseSchema = z.object({
  targetType: z.enum(['setupSandbox', 'agentSandbox'] as const),
  targetId: z.string(),
  sandboxId: z.string(),
  terminalUrl: z.string(),
  authToken: z.string(),
  authTokenExpiresInSeconds: z.number().int().positive(),
  wsUrl: z.string()
})

function toErrorMessage (err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim().length > 0) return err.message
  return fallback
}

registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/connect`,
    summary: 'Create direct terminal connect credentials',
    tags: ['terminal'],
    security: [{ bearerAuth: [] }],
    request: { json: connectRequestSchema },
    responses: {
      200: connectResponseSchema,
      400: z.object({ error: z.string() }),
      404: z.object({ error: z.string() }),
      409: z.object({ error: z.string() }),
      502: z.object({ error: z.string() })
    }
  },
  '/connect',
  zValidator('json', connectRequestSchema),
  async c => {
    const user = c.get('user')
    const body = c.req.valid('json' as never) as z.infer<
      typeof connectRequestSchema
    >

    if (body.targetType === 'setupSandbox') {
      const session = getImageSetupSandboxSession({ sandboxId: body.targetId })
      if (!session) {
        return c.json({ error: 'Setup sandbox not found' }, 404)
      }
      if (session.userId !== user.id) {
        return c.json({ error: 'Setup sandbox not found' }, 404)
      }

      try {
        const access = await getSetupSandboxTerminalAccess({
          userId: user.id,
          sandboxId: session.sandboxId,
          authTtlSeconds: SANDBOX_AUTH_TOKEN_TTL_SECONDS
        })

        return c.json({
          targetType: body.targetType,
          targetId: body.targetId,
          sandboxId: access.sandboxId,
          terminalUrl: access.terminalUrl,
          authToken: access.authToken,
          authTokenExpiresInSeconds: access.authTokenExpiresInSeconds,
          wsUrl: access.wsUrl
        })
      } catch (err) {
        const message = toErrorMessage(err, 'Failed to create terminal URL')
        const status = message.toLowerCase().includes('not found') ? 404 : 400
        return c.json({ error: message }, status)
      }
    }

    const agent = await getAgentById(body.targetId)
    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    try {
      const access = await getAgentTerminalAccess({
        userId: user.id,
        agentId: agent.id,
        authTtlSeconds: SANDBOX_AUTH_TOKEN_TTL_SECONDS
      })

      return c.json({
        targetType: body.targetType,
        targetId: body.targetId,
        sandboxId: access.sandboxId,
        terminalUrl: access.terminalUrl,
        authToken: access.authToken,
        authTokenExpiresInSeconds: access.authTokenExpiresInSeconds,
        wsUrl: access.wsUrl
      })
    } catch (err) {
      if (err instanceof HTTPException) {
        return c.json({ error: err.message }, err.status)
      }
      const message = toErrorMessage(err, 'Failed to create terminal URL')
      return c.json({ error: message }, 502)
    }
  }
)

export const terminalRoutes = app
