import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../types/context'
import { env } from '../env'
import { verifyJwt, loadUser } from './auth'

function readApiKeyHeader (c: {
  readonly req: { readonly header: (name: string) => string | undefined }
}): string | null {
  const value = (c.req.header('x-agent-manager-api-key') ?? '').trim()
  return value.length > 0 ? value : null
}

function isApiKeySessionPutRoute (method: string, path: string): boolean {
  if (method.toUpperCase() !== 'PUT') return false
  return /^\/session\/[^/]+$/.test(path)
}

export const sessionAuth = createMiddleware<AppEnv>(async (c, next) => {
  const suppliedApiKey = readApiKeyHeader(c)
  if (suppliedApiKey !== null) {
    const configuredApiKey = (env.AGENT_MANAGER_API_KEY ?? '').trim()
    if (!configuredApiKey) {
      throw new HTTPException(401, { message: 'API key auth is not configured' })
    }
    if (suppliedApiKey !== configuredApiKey) {
      throw new HTTPException(401, { message: 'Invalid API key' })
    }
    if (!isApiKeySessionPutRoute(c.req.method, c.req.path)) {
      throw new HTTPException(401, {
        message: 'API key auth is only supported for PUT /session/:id'
      })
    }

    c.set('authMode', 'api-key')
    c.set('user', {
      id: 'api-key',
      email: 'api-key@local',
      name: 'API Key',
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
