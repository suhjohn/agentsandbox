import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { log } from '../log'
import { getRedisClient } from './redis.service'

export type KeyLock = {
  readonly key: string
  readonly token: string
}

type AcquireLockInput = {
  readonly key: string
  readonly ttlMs: number
  readonly waitMs?: number
  readonly retryDelayMs?: number
  readonly renewalMs?: number
  readonly signal?: AbortSignal
}

const RELEASE_IF_MATCH_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`.trim()

const REFRESH_IF_MATCH_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  redis.call("pexpire", KEYS[1], ARGV[2])
  redis.call("pexpire", KEYS[2], ARGV[2])
  return 1
else
  return 0
end
`.trim()

function lockMetaKey(key: string, token: string): string {
  return `locks:meta:${key}:${token}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sleepUntilAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

function jitterMs(baseMs: number): number {
  // +/- 20% jitter
  const spread = Math.max(1, Math.floor(baseMs * 0.2))
  return baseMs + Math.floor(Math.random() * (2 * spread + 1)) - spread
}

export async function acquireLock(input: AcquireLockInput): Promise<KeyLock | null> {
  const key = input.key.trim()
  if (key.length === 0) throw new Error('key is required')
  if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) throw new Error('ttlMs must be > 0')

  const waitMs = Math.max(0, Math.floor(input.waitMs ?? 0))
  const retryDelayMs = Math.max(5, Math.floor(input.retryDelayMs ?? 50))
  const deadline = Date.now() + waitMs
  const startedAt = Date.now()
  let attempts = 0

  const client = await getRedisClient()
  const token = randomUUID()
  const host = hostname()

  // First attempt immediately, then retry until deadline.
  while (true) {
    attempts += 1
    if (input.signal?.aborted) throw new Error('Lock acquire aborted')

    const ok = await client.set(key, token, { NX: true, PX: input.ttlMs })
    if (ok === 'OK') {
      const meta = {
        key,
        token,
        ttlMs: input.ttlMs,
        waitMs,
        retryDelayMs,
        acquiredAtMs: Date.now(),
        pid: process.pid,
        host,
      }
      void client.set(lockMetaKey(key, token), JSON.stringify(meta), { PX: input.ttlMs }).catch((err) => {
        log.warn('lock.meta.set_failed', { key, err })
      })
      log.debug('lock.acquire.ok', {
        key,
        ttlMs: input.ttlMs,
        waitMs,
        retryDelayMs,
        attempts,
        durationMs: Math.max(0, Date.now() - startedAt),
      })
      return { key, token }
    }

    if (Date.now() >= deadline) {
      let currentToken: string | null = null
      try {
        currentToken = await client.get(key)
      } catch {
        // ignore lookup errors
      }
      log.debug('lock.acquire.timeout', {
        key,
        ttlMs: input.ttlMs,
        waitMs,
        retryDelayMs,
        attempts,
        currentToken,
        durationMs: Math.max(0, Date.now() - startedAt),
      })
      return null
    }
    await sleep(jitterMs(retryDelayMs))
  }
}

export async function releaseLock(lock: KeyLock): Promise<boolean> {
  const client = await getRedisClient()
  const result = await client.eval(RELEASE_IF_MATCH_SCRIPT, {
    keys: [lock.key],
    arguments: [lock.token],
  })
  const released = Number(result) === 1
  if (released) {
    void client.del(lockMetaKey(lock.key, lock.token)).catch((err) => {
      log.warn('lock.meta.delete_failed', { key: lock.key, err })
    })
  }
  log.debug('lock.release', { key: lock.key, released })
  return released
}

export async function refreshLock(lock: KeyLock, ttlMs: number): Promise<boolean> {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ttlMs must be > 0')
  const client = await getRedisClient()
  const result = await client.eval(REFRESH_IF_MATCH_SCRIPT, {
    keys: [lock.key, lockMetaKey(lock.key, lock.token)],
    arguments: [lock.token, String(Math.floor(ttlMs))],
  })
  return Number(result) === 1
}

export async function withLock<T>(
  input: AcquireLockInput,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = await acquireLock(input)
  if (!lock) throw new Error(`Failed to acquire lock: ${input.key}`)

  const renewalAbort = new AbortController()
  let renewalStopped = false
  let lockLost = false
  let renewalInFlight = false

  const ttlMs = Math.floor(input.ttlMs)
  const requestedRenewalMs = input.renewalMs == null ? null : Math.floor(input.renewalMs)
  const defaultRenewalMs = Math.max(1, Math.floor(ttlMs / 2))
  const renewalMs = (() => {
    const base = requestedRenewalMs ?? defaultRenewalMs
    if (!Number.isFinite(base) || base <= 0) return defaultRenewalMs
    if (ttlMs <= 1) return 0
    return Math.max(1, Math.min(base, ttlMs - 1))
  })()

  const renewalLoop = (async () => {
    if (renewalMs <= 0) return
    while (!renewalAbort.signal.aborted && !renewalStopped) {
      await sleepUntilAbort(jitterMs(renewalMs), renewalAbort.signal)
      if (renewalAbort.signal.aborted || renewalStopped) return
      if (renewalInFlight) continue
      renewalInFlight = true
      try {
        const ok = await refreshLock(lock, ttlMs)
        if (!ok) {
          lockLost = true
          log.error('lock.renew.lost', { key: lock.key, ttlMs })
          return
        }
        log.debug('lock.renew.ok', { key: lock.key, ttlMs })
      } catch (err) {
        log.warn('lock.renew.failed', { key: lock.key, ttlMs, err })
      } finally {
        renewalInFlight = false
      }
    }
  })()

  try {
    return await fn()
  } finally {
    renewalStopped = true
    renewalAbort.abort()
    try {
      await renewalLoop
    } catch {
      // ignore renewal loop failures
    }

    try {
      await releaseLock(lock)
    } catch {
      // Best-effort; lock will expire via TTL.
    }

    if (lockLost) {
      log.error('lock.lost_during_execution', { key: lock.key })
    }
  }
}
