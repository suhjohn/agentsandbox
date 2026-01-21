import { createClient } from 'redis'
import { env } from '../env'
import { log } from '../log'

type RedisClient = ReturnType<typeof createClient>

let client: RedisClient | null = null
let connectPromise: Promise<RedisClient> | null = null
let lastRedisErrorLogMs = 0
const REDIS_ERROR_LOG_THROTTLE_MS = 30_000

function redactUrlForLog(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`
  } catch {
    return rawUrl
  }
}

export async function getRedisClient(): Promise<RedisClient> {
  if (client) return client

  if (!connectPromise) {
    connectPromise = (async () => {
      const next = createClient({ url: env.REDIS_URL })
      next.on('error', (err) => {
        const now = Date.now()
        if (now - lastRedisErrorLogMs >= REDIS_ERROR_LOG_THROTTLE_MS) {
          lastRedisErrorLogMs = now
          log.error('redis.error', { err })
        }
      })

      await next.connect()
      log.info('redis.connected', { url: redactUrlForLog(env.REDIS_URL) })

      client = next
      return next
    })().catch((err) => {
      connectPromise = null
      throw err
    })
  }

  if (!connectPromise) {
    throw new Error('Redis connect promise not initialized')
  }
  return connectPromise
}

export async function closeRedis(): Promise<void> {
  const existing = client
  client = null
  connectPromise = null
  if (!existing) return

  try {
    await existing.quit()
  } catch {
    existing.disconnect()
  }
}
