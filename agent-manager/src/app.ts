import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from './types/context'
import { env } from './env'
import { verifyJwt } from './middleware/auth'
import { loadUser } from './middleware/auth'
import { managerAuth, requireApiKeyRouteScope } from './middleware/manager-auth'
import { authRoutes } from './routes/auth'
import { apiKeysRoutes } from './routes/api-keys'
import { userRoutes } from './routes/users'
import { imageRoutes } from './routes/images'
import { agentsRoutes } from './routes/agents'
import { sessionRoutes } from './routes/session'
import { terminalRoutes } from './routes/terminal'
import { settingsRoutes } from './routes/settings'
import { generateOpenApiSpec } from './openapi/registry'
import { setInternalApiFetch } from './internal-api'
import { log } from './log'

const app = new Hono<AppEnv>()

function normalizeOrigin (value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  try {
    return new URL(trimmed).origin
  } catch {
    return null
  }
}

function pathWithQueryForLog (rawUrl: string, fallbackPath: string): string {
  try {
    const url = new URL(rawUrl)
    return `${url.pathname}${url.search}`
  } catch {
    return fallbackPath
  }
}

function buildAllowedCorsOrigins (): readonly string[] {
  const origins = new Set<string>()
  const candidates = [env.FRONTEND_URL ?? '', env.BACKEND_URL ?? '']
  for (const candidate of candidates) {
    const normalized = normalizeOrigin(candidate)
    if (normalized) origins.add(normalized)
  }
  if (origins.size === 0) {
    origins.add('http://localhost:5173')
    origins.add('http://localhost:5174')
  }
  return [...origins].sort()
}

const allowedCorsOrigins = buildAllowedCorsOrigins()

app.use('*', async (c, next) => {
  const startMs = performance.now()
  const method = c.req.method
  const path = pathWithQueryForLog(c.req.url, c.req.path)

  if (env.LOG_LEVEL === 'debug') {
    log.debug('http.start', { method, path })
  }

  await next()

  const status = c.res.status
  const durationMs = Math.max(0, performance.now() - startMs)
  if (env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'info') {
    log.info('http.end', {
      method,
      path,
      status,
      durationMs: Math.round(durationMs)
    })
  }
})
app.use(
  '*',
  cors({
    origin: requestOrigin => {
      const normalized = normalizeOrigin(requestOrigin ?? '')
      if (!normalized) return undefined
      return allowedCorsOrigins.includes(normalized) ? normalized : undefined
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Authorization',
      'Content-Type',
      'X-API-Key',
      'X-Refresh-Csrf'
    ]
  })
)

// Health check
app.get('/health', c =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() })
)

app.get('/openapi.json', c => {
  return c.json(
    generateOpenApiSpec({ title: 'agent-manager', version: '0.0.1' })
  )
})

// Public routes
app.route('/auth', authRoutes)

// Protected routes
app.use('/api-keys', verifyJwt, loadUser)
app.use('/api-keys/*', verifyJwt, loadUser)
app.use('/users', managerAuth, requireApiKeyRouteScope)
app.use('/users/*', managerAuth, requireApiKeyRouteScope)
app.use('/images', managerAuth, requireApiKeyRouteScope)
app.use('/images/*', managerAuth, requireApiKeyRouteScope)
app.use('/settings', managerAuth, requireApiKeyRouteScope)
app.use('/settings/*', managerAuth, requireApiKeyRouteScope)
app.use('/agents', managerAuth, requireApiKeyRouteScope)
app.use('/agents/*', managerAuth, requireApiKeyRouteScope)
app.use('/session', managerAuth, requireApiKeyRouteScope)
app.use('/session/*', managerAuth, requireApiKeyRouteScope)
app.use('/terminal', managerAuth, requireApiKeyRouteScope)
app.use('/terminal/*', managerAuth, requireApiKeyRouteScope)
app.route('/users', userRoutes)
app.route('/api-keys', apiKeysRoutes)
app.route('/images', imageRoutes)
app.route('/settings', settingsRoutes)
app.route('/agents', agentsRoutes)
app.route('/session', sessionRoutes)
app.route('/terminal', terminalRoutes)

// Error handler
app.onError((err, c) => {
  const method = c.req.method
  const path = pathWithQueryForLog(c.req.url, c.req.path)
  if (err instanceof HTTPException) {
    return c.json({ error: err.message, status: err.status }, err.status)
  }
  log.error('Unhandled error', { method, path, error: err })
  return c.json({ error: 'Internal Server Error', status: 500 }, 500)
})

app.notFound(c => c.json({ error: 'Not Found', status: 404 }, 404))

setInternalApiFetch(app.fetch.bind(app))

export { app }
