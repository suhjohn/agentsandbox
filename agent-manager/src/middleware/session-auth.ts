import { timingSafeEqual } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../types/context'
import { getAgentRuntimeInternalSecret } from '../services/agent.service'
import { verifyJwt, loadUser } from './auth'

function readRuntimeInternalAuthHeader (c: {
  readonly req: { readonly header: (name: string) => string | undefined }
}): string | null {
  const value = (c.req.header('x-agent-internal-auth') ?? '').trim()
  return value.length > 0 ? value : null
}

function readRuntimeAgentIdHeader (c: {
  readonly req: { readonly header: (name: string) => string | undefined }
}): string | null {
  const value = (c.req.header('x-agent-id') ?? '').trim()
  return value.length > 0 ? value : null
}

function isRuntimeInternalSessionPutRoute (method: string, path: string): boolean {
  if (method.toUpperCase() !== 'PUT') return false
  return /^\/session\/[^/]+$/.test(path)
}

function isRuntimeInternalAgentSnapshotRoute (
  method: string,
  path: string
): boolean {
  if (method.toUpperCase() !== 'POST') return false
  return /^\/agents\/[^/]+\/snapshot$/.test(path)
}

function isRuntimeInternalRoute (method: string, path: string): boolean {
  return (
    isRuntimeInternalSessionPutRoute(method, path) ||
    isRuntimeInternalAgentSnapshotRoute(method, path)
  )
}

function runtimeInternalSnapshotAgentIdFromPath (path: string): string | null {
  const match = path.match(/^\/agents\/([^/]+)\/snapshot$/)
  return match?.[1]?.trim() || null
}

function constantTimeEquals (left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const sessionAuth = createMiddleware<AppEnv>(async (c, next) => {
  const suppliedRuntimeSecret = readRuntimeInternalAuthHeader(c)
  if (suppliedRuntimeSecret !== null) {
    if (!isRuntimeInternalRoute(c.req.method, c.req.path)) {
      throw new HTTPException(401, {
        message:
          'Runtime internal auth is only supported for PUT /session/:id and POST /agents/:agentId/snapshot'
      })
    }

    const runtimeAgentId = readRuntimeAgentIdHeader(c)
    if (runtimeAgentId === null) {
      throw new HTTPException(401, { message: 'Missing X-Agent-Id header' })
    }

    if (isRuntimeInternalAgentSnapshotRoute(c.req.method, c.req.path)) {
      const pathAgentId = runtimeInternalSnapshotAgentIdFromPath(c.req.path)
      if (pathAgentId === null || pathAgentId !== runtimeAgentId) {
        throw new HTTPException(401, {
          message: 'Runtime internal auth agent mismatch'
        })
      }
    }

    const configuredSecret = await getAgentRuntimeInternalSecret(runtimeAgentId)
      .catch(() => null)
    if (
      configuredSecret === null ||
      !constantTimeEquals(suppliedRuntimeSecret, configuredSecret)
    ) {
      throw new HTTPException(401, { message: 'Invalid runtime internal auth' })
    }

    c.set('authMode', 'runtime-internal')
    c.set('runtimeAgentId', runtimeAgentId)
    c.set('user', {
      id: 'runtime-internal',
      email: 'runtime-internal@local',
      name: 'Runtime Internal',
      avatar: null,
      defaultRegion: 'us-west-2',
      workspaceKeybindings: null
    })
    await next()
    return
  }

  await verifyJwt(c, async () => {
    c.set('authMode', 'jwt')
    await loadUser(c, next)
  })
})
