import { closeDb } from './db'
import { env } from './env'
import { log } from './log'
import { startBaseImageWarmer } from './base-image-warmer'
import { startServer } from './server'
import { closeRedis } from './services/redis.service'
import { ensureTailscaleFunnelPublicBaseUrl, stopTailscaleFunnel } from './clients/tailscale'

const server = startServer()
const stopBaseImageWarmer = startBaseImageWarmer()
const port = server.port ?? env.PORT
log.info('server.start', { url: `http://localhost:${port}` })

const already = (process.env.SERVER_PUBLIC_URL ?? '').trim()
if (already.length === 0 && process.env.NODE_ENV === 'development') {
  void ensureTailscaleFunnelPublicBaseUrl({ port }).then((url) => {
    if (url) {
      process.env.SERVER_PUBLIC_URL = url
    } else {
      log.warn('agent_manager.public_base_url.unavailable', {
        reason: 'tailscale_funnel_not_available',
        port,
      })
    }
  })
}

process.on('SIGINT', async () => {
  stopBaseImageWarmer()
  await stopTailscaleFunnel()
  await closeRedis()
  await closeDb()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  stopBaseImageWarmer()
  await stopTailscaleFunnel()
  await closeRedis()
  await closeDb()
  process.exit(0)
})
