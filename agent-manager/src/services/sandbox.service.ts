import { createHmac } from 'node:crypto'
import { HTTPException } from 'hono/http-exception'
import { sign } from 'hono/jwt'
import { ModalClient, Sandbox } from 'modal'
import { resolveBaseImageRefForRegistry } from '@/clients/ghcr'
import { DEFAULT_REGION } from '@/utils/region'
import {
  createAgentRuntimeInternalSecret,
  clearAgentSandboxIfMatches,
  getAgentAccessToken,
  getAgentById,
  setAgentSandbox
} from './agent.service'
import { env } from '../env'
import {
  canUserAccessImageVariant,
  getImageById,
  getImageByIdIncludingArchived,
  getImageVariantForImage,
  listEnvironmentSecrets,
  resolveImageVariantForUser,
  setImageVariantBaseImageId
} from './image.service'
import { withLock } from './lock.service'
import { getRedisClient } from './redis.service'
import { tryResolveTailscaleFunnelPublicBaseUrl } from '../clients/tailscale'

export type SandboxRegion = string | readonly string[]

export type TerminalAccess = {
  readonly sandboxId: string
  readonly terminalUrl: string
  readonly wsUrl: string
  readonly authToken: string
  readonly authTokenExpiresInSeconds: number
}

export type SandboxTunnelUrls = {
  readonly openVscodeUrl: string
  readonly noVncUrl: string
}

export type SandboxTunnelUrlsWithAgentApi = SandboxTunnelUrls & {
  readonly agentApiUrl: string
}

export type AgentRuntimeAccess = {
  readonly agentId: string
  readonly sandboxId: string
  readonly agentSessionId: string
  readonly agentApiUrl: string
  readonly openVscodeUrl: string
  readonly noVncUrl: string
  readonly agentAuthToken: string
  readonly agentAuthExpiresInSeconds: number
}

export type CreateSetupSandboxResult = {
  readonly sandboxId: string
  readonly variantId: string
  readonly baseImageId: string | null
}

export type SetupSandboxSnapshotResult = {
  readonly baseImageId: string
  readonly variantId: string
}

export type SandboxAgentTokenResult = {
  readonly token: string
  readonly expiresInSeconds: number
}

export type AgentSandboxResult = {
  readonly tunnels: SandboxTunnelUrlsWithAgentApi
  readonly sandboxAccessToken: string
  readonly sandbox: Sandbox
}

type ImageSetupSandboxSession = {
  readonly sandboxId: string
  readonly imageId: string
  readonly variantId: string
  readonly userId: string
  readonly createdAt: number
  readonly updatedAt: number
}

type RawSandboxTunnelsResponse = {
  readonly tunnels?: ReadonlyArray<{
    readonly containerPort: number
    readonly host: string
    readonly port: number
  }>
}

type CachedSandboxTunnels = SandboxTunnelUrlsWithAgentApi & {
  readonly cachedAtMs: number
}

const modalClient = new ModalClient()
const AGENT_ID_TO_SANDBOX = new Map<string, Sandbox>()
const IMAGE_SETUP_SANDBOXES = new Map<string, ImageSetupSandboxSession>()

function envInt (name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return defaultValue
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : defaultValue
}

const MODAL_TERMINATE_RPC_TIMEOUT_MS = envInt(
  'MODAL_TERMINATE_RPC_TIMEOUT_MS',
  10_000
)
const MODAL_SANDBOX_CREATE_STEP_TIMEOUT_MS = envInt(
  'MODAL_SANDBOX_CREATE_STEP_TIMEOUT_MS',
  30_000
)
const MODAL_SANDBOX_CREATE_CALL_TIMEOUT_MS = envInt(
  'MODAL_SANDBOX_CREATE_CALL_TIMEOUT_MS',
  2 * 60_000
)
const SESSION_SANDBOX_IDLE_TIMEOUT_MS = envInt(
  process.env.AGENT_SANDBOX_IDLE_TIMEOUT_MS != null
    ? 'AGENT_SANDBOX_IDLE_TIMEOUT_MS'
    : 'SESSION_SANDBOX_IDLE_TIMEOUT_MS',
  10 * 60 * 1000
)
const SESSION_SANDBOX_AGENT_API_PORT = envInt(
  process.env.AGENT_SANDBOX_AGENT_API_PORT != null
    ? 'AGENT_SANDBOX_AGENT_API_PORT'
    : 'SESSION_SANDBOX_AGENT_API_PORT',
  48213
)
const SESSION_SANDBOX_OPENVSCODE_PORT = 39393
const SESSION_SANDBOX_NOVNC_PORT = 6080
const SESSION_SANDBOX_TUNNELS_CACHE_TTL_MS = envInt(
  process.env.AGENT_SANDBOX_TUNNELS_CACHE_TTL_MS != null
    ? 'AGENT_SANDBOX_TUNNELS_CACHE_TTL_MS'
    : 'SESSION_SANDBOX_TUNNELS_CACHE_TTL_MS',
  24 * 60 * 60 * 1000
)
const SESSION_SANDBOX_TUNNELS_RPC_WAIT_SECONDS = envInt(
  process.env.AGENT_SANDBOX_TUNNELS_RPC_WAIT_SECONDS != null
    ? 'AGENT_SANDBOX_TUNNELS_RPC_WAIT_SECONDS'
    : 'SESSION_SANDBOX_TUNNELS_RPC_WAIT_SECONDS',
  3
)
const SESSION_SANDBOX_TUNNELS_READY_TIMEOUT_MS = envInt(
  process.env.AGENT_SANDBOX_TUNNELS_READY_TIMEOUT_MS != null
    ? 'AGENT_SANDBOX_TUNNELS_READY_TIMEOUT_MS'
    : 'SESSION_SANDBOX_TUNNELS_READY_TIMEOUT_MS',
  20_000
)
const SESSION_SANDBOX_TUNNELS_RETRY_INTERVAL_MS = envInt(
  process.env.AGENT_SANDBOX_TUNNELS_RETRY_INTERVAL_MS != null
    ? 'AGENT_SANDBOX_TUNNELS_RETRY_INTERVAL_MS'
    : 'SESSION_SANDBOX_TUNNELS_RETRY_INTERVAL_MS',
  400
)
const SESSION_SANDBOX_CREATE_LOCK_WAIT_MS = envInt(
  'SESSION_SANDBOX_CREATE_LOCK_WAIT_MS',
  5 * 60 * 1000
)
const SESSION_SANDBOX_CREATE_LOCK_TTL_MS = envInt(
  'SESSION_SANDBOX_CREATE_LOCK_TTL_MS',
  60 * 1000
)
const SESSION_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS = envInt(
  process.env.AGENT_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS != null
    ? 'AGENT_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS'
    : 'SESSION_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS',
  5 * 60 * 1000
)
const SESSION_SANDBOX_POST_CREATE_HEALTH_RETRY_MS = envInt(
  process.env.AGENT_SANDBOX_POST_CREATE_HEALTH_RETRY_MS != null
    ? 'AGENT_SANDBOX_POST_CREATE_HEALTH_RETRY_MS'
    : 'SESSION_SANDBOX_POST_CREATE_HEALTH_RETRY_MS',
  1000
)
const SETUP_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS = envInt(
  process.env.AGENT_SETUP_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS != null
    ? 'AGENT_SETUP_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS'
    : 'SETUP_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS',
  5 * 60 * 1000
)
const SETUP_SANDBOX_POST_CREATE_HEALTH_RETRY_MS = envInt(
  process.env.AGENT_SETUP_SANDBOX_POST_CREATE_HEALTH_RETRY_MS != null
    ? 'AGENT_SETUP_SANDBOX_POST_CREATE_HEALTH_RETRY_MS'
    : 'SETUP_SANDBOX_POST_CREATE_HEALTH_RETRY_MS',
  1000
)
function parseSandboxStartCommand (): readonly string[] {
  const name = 'AGENT_SANDBOX_COMMAND_JSON'
  const raw = process.env[name]?.trim()
  if (!raw) return ['agent-server', 'serve']

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('must be a non-empty JSON array of strings')
    }
    for (const part of parsed) {
      if (typeof part !== 'string' || part.trim().length === 0) {
        throw new Error('must be a non-empty JSON array of strings')
      }
    }
    return parsed.map(part => part.trim())
  } catch (err) {
    throw new Error(
      `${name} must be a JSON array of command arguments: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }
}

const SANDBOX_START_COMMAND = parseSandboxStartCommand()

const DEFAULT_SANDBOX_AGENT_TOKEN_TTL_SECONDS = 5 * 60

const SETUP_APP_NAME = 'image-builder'
const SETUP_SERVER_COMMAND = ['agent-server', 'serve'] as const
const SETUP_TERMINAL_PORT = 8080
const SETUP_TIMEOUT_MS = 60 * 60 * 1000
const SETUP_IDLE_TIMEOUT_MS = 60 * 60 * 1000
const SETUP_SNAPSHOT_TIMEOUT_MS = 10 * 60 * 1000
const SETUP_TUNNELS_RPC_TIMEOUT_SECONDS = 3
const SETUP_TUNNELS_READY_TIMEOUT_MS = 20_000
const SETUP_TUNNELS_RETRY_INTERVAL_MS = 400
const SETUP_SECRET_NAME = 'openinspect-build-secret'
const SANDBOX_RUN_SCRIPT_PATH = '/tmp/agent-run.sh'

function splitCommaList (raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(v => v.trim())
    .filter(v => v.length > 0)
}

function normalizeSecretNames (rawNames: readonly string[]): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const rawName of rawNames) {
    const name = rawName.trim()
    if (name.length === 0) continue
    if (seen.has(name)) continue
    seen.add(name)
    normalized.push(name)
  }
  return normalized
}

function normalizeNullableText (value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function shellQuote (value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function buildSandboxStartCommand (runScript: string | null | undefined): readonly string[] {
  const normalizedRunScript = normalizeNullableText(runScript)
  if (!normalizedRunScript) return [...SANDBOX_START_COMMAND]

  const heredocTerminator = '__AGENT_MANAGER_RUN_SCRIPT__'
  const serverCommand = SANDBOX_START_COMMAND.map(part => shellQuote(part)).join(' ')

  return [
    'bash',
    '-lc',
    [
      'set -euo pipefail',
      `cat > ${shellQuote(SANDBOX_RUN_SCRIPT_PATH)} <<'${heredocTerminator}'`,
      normalizedRunScript,
      heredocTerminator,
      `chmod 700 ${shellQuote(SANDBOX_RUN_SCRIPT_PATH)}`,
      'echo "[sandbox-run] running image run script..." >&2',
      `bash ${shellQuote(SANDBOX_RUN_SCRIPT_PATH)}`,
      'echo "[sandbox-run] image run script complete." >&2',
      `exec ${serverCommand}`
    ].join('\n')
  ]
}

function buildAllowedOrigins (agentManagerBaseUrl: string): string {
  const rawUrls = [
    agentManagerBaseUrl,
    env.FRONTEND_URL ?? '',
    ...splitCommaList(env.AGENT_ALLOWED_ORIGINS),
    ...splitCommaList(env.VSCODE_PROXY_FRAME_ANCESTORS)
  ]

  const origins = new Set<string>()
  for (const url of rawUrls) {
    const trimmed = url.trim()
    if (trimmed.length === 0) continue
    try {
      origins.add(new URL(trimmed).origin)
    } catch {
      /* ignore invalid URLs */
    }
  }
  return [...origins].sort().join(',')
}

export function agentIdToSandboxName (agentId: string): string {
  return `agent-sandbox-${agentId.replace(/-/g, '')}`
}

export function agentIdToAgentSessionId (agentId: string): string {
  return agentId.replace(/-/g, '')
}

function setupSandboxAgentId (imageId: string): string {
  return `setup-${imageId}`
}

function isTransientSandboxLookupError (err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  const normalized = message.toLowerCase()
  return (
    normalized.includes('loading sandbox') ||
    normalized.includes('file does not exist') ||
    normalized.includes('sandbox not found')
  )
}

async function sleepMs (ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function withTimeout<T> (
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function resolveAgentManagerBaseUrl (): Promise<string> {
  const normalize = (value: string): string | null => {
    const trimmed = value.trim()
    if (trimmed.length === 0) return null
    try {
      const url = new URL(trimmed)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
      const normalized = `${url.origin}${url.pathname.replace(/\/+$/, '')}`
      return normalized.length > 0 ? normalized : url.origin
    } catch {
      return null
    }
  }

  let baseUrl = normalize(process.env.SERVER_PUBLIC_URL ?? '')
  if (!baseUrl) {
    const funnel = await tryResolveTailscaleFunnelPublicBaseUrl()
    if (funnel) {
      process.env.SERVER_PUBLIC_URL = funnel
      baseUrl = normalize(funnel)
    }
  }

  if (!baseUrl) throw new Error('AGENT_MANAGER_BASE_URL is required')
  return baseUrl
}

async function fetchSandboxTunnels (
  sandboxId: string,
  timeoutSeconds: number
): Promise<RawSandboxTunnelsResponse> {
  const startedAt = Date.now()
  const deadline = startedAt + SESSION_SANDBOX_TUNNELS_READY_TIMEOUT_MS
  let lastErr: unknown = null
  while (Date.now() <= deadline) {
    try {
      return (await modalClient.cpClient.sandboxGetTunnels({
        sandboxId,
        timeout: timeoutSeconds
      })) as unknown as RawSandboxTunnelsResponse
    } catch (err) {
      lastErr = err
      if (!isTransientSandboxLookupError(err)) throw err
      if (Date.now() >= deadline) break
      await sleepMs(SESSION_SANDBOX_TUNNELS_RETRY_INTERVAL_MS)
    }
  }
  throw new Error(
    `Sandbox tunnels unavailable after ${Date.now() - startedAt}ms: ${
      lastErr instanceof Error
        ? lastErr.message
        : String(lastErr ?? 'unknown error')
    }`
  )
}

async function getCachedSandboxTunnels (
  sandboxId: string
): Promise<SandboxTunnelUrlsWithAgentApi | null> {
  if (SESSION_SANDBOX_TUNNELS_CACHE_TTL_MS <= 0) return null
  const client = await getRedisClient()
  const raw = await client.get(`cache:sandbox-tunnels:${sandboxId}`)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<CachedSandboxTunnels>
    if (
      typeof parsed?.openVscodeUrl === 'string' &&
      typeof parsed?.noVncUrl === 'string' &&
      typeof parsed?.agentApiUrl === 'string'
    ) {
      return {
        openVscodeUrl: parsed.openVscodeUrl,
        noVncUrl: parsed.noVncUrl,
        agentApiUrl: parsed.agentApiUrl
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

async function setCachedSandboxTunnels (
  sandboxId: string,
  tunnels: SandboxTunnelUrlsWithAgentApi
): Promise<void> {
  if (SESSION_SANDBOX_TUNNELS_CACHE_TTL_MS <= 0) return
  const client = await getRedisClient()
  const payload: CachedSandboxTunnels = { ...tunnels, cachedAtMs: Date.now() }
  await client.set(
    `cache:sandbox-tunnels:${sandboxId}`,
    JSON.stringify(payload),
    { PX: SESSION_SANDBOX_TUNNELS_CACHE_TTL_MS }
  )
}

export async function getSandboxAgentToken (input: {
  readonly userId: string
  readonly agentId: string
  readonly agentSessionId: string
  readonly expiresInSeconds?: number
}): Promise<SandboxAgentTokenResult> {
  if (input.agentId.trim().length === 0) throw new Error('agentId is required')
  if (input.agentSessionId.trim().length === 0)
    throw new Error('agentSessionId is required')

  const now = Math.floor(Date.now() / 1000)
  const desiredExpiresInSeconds = Math.max(
    30,
    Math.floor(input.expiresInSeconds ?? DEFAULT_SANDBOX_AGENT_TOKEN_TTL_SECONDS)
  )

  const exp = now + desiredExpiresInSeconds
  const secret = createHmac('sha256', env.SANDBOX_SIGNING_SECRET)
    .update(`sandbox-agent:${input.agentSessionId}`)
    .digest('hex')
  const token = await sign(
    {
      sub: input.userId,
      agentId: input.agentId,
      iat: now,
      exp,
      typ: 'sandbox-agent',
      sid: input.agentSessionId,
      jti: crypto.randomUUID()
    },
    secret,
    'HS256'
  )
  return { token, expiresInSeconds: Math.max(1, exp - now) }
}

async function isSandboxAlive (sb: Sandbox): Promise<boolean> {
  const TIMEOUT_MS = 2000
  try {
    const proc = await sb.exec(['echo', 'hello'], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeoutMs: TIMEOUT_MS
    })
    const exitCode = await proc.wait()
    if (exitCode === 0) return true
    const stderr = (await proc.stderr.readText()).trim()
    if (stderr.length > 0)
      console.error(
        '[session-sandbox] isSandboxAlive detail',
        { sandboxId: sb.sandboxId },
        stderr
      )
    return false
  } catch (err) {
    console.error(
      '[session-sandbox] isSandboxAlive failed',
      { sandboxId: sb.sandboxId },
      err
    )
    return false
  }
}

async function fetchAgentHealthOk (agentApiUrl: string): Promise<boolean> {
  const TIMEOUT_MS = 2_000

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const healthUrl = new URL(agentApiUrl)
    if (!healthUrl.pathname.endsWith('/')) {
      healthUrl.pathname = `${healthUrl.pathname}/`
    }
    healthUrl.pathname = `${healthUrl.pathname}health`
    healthUrl.search = ''
    healthUrl.hash = ''

    let response: Response
    try {
      response = await fetch(healthUrl.toString(), {
        method: 'GET',
        headers: { 'Cache-Control': 'no-store' },
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) return false
    const bodyText = await response.text()
    try {
      const data = JSON.parse(bodyText) as unknown
      if (
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        'status' in data
      )
        return data.status === 'ok'
      return true
    } catch {
      return true
    }
  } catch (err) {
    console.error(
      '[session-sandbox] fetchAgentHealthOk failed',
      { agentApiUrl },
      err
    )
    return false
  }
}

async function waitForSandboxTunnelsWithAgentApi (
  sandboxId: string
): Promise<SandboxTunnelUrlsWithAgentApi> {
  const resp = await fetchSandboxTunnels(
    sandboxId,
    SESSION_SANDBOX_TUNNELS_RPC_WAIT_SECONDS
  )

  const byPort = new Map<
    number,
    { readonly host: string; readonly port: number }
  >()
  for (const t of resp.tunnels ?? [])
    byPort.set(t.containerPort, { host: t.host, port: t.port })

  const agentApi = byPort.get(SESSION_SANDBOX_AGENT_API_PORT)
  if (!agentApi)
    throw new Error(
      `Expected tunnel for port ${SESSION_SANDBOX_AGENT_API_PORT}`
    )

  const openVscode = byPort.get(SESSION_SANDBOX_OPENVSCODE_PORT)
  if (!openVscode)
    throw new Error(
      `Expected tunnel for port ${SESSION_SANDBOX_OPENVSCODE_PORT}`
    )

  const noVnc = byPort.get(SESSION_SANDBOX_NOVNC_PORT)
  if (!noVnc)
    throw new Error(`Expected tunnel for port ${SESSION_SANDBOX_NOVNC_PORT}`)

  const agentApiUrl =
    agentApi.port !== 443
      ? `https://${agentApi.host}:${agentApi.port}`
      : `https://${agentApi.host}`
  const openVscodeUrl =
    openVscode.port !== 443
      ? `https://${openVscode.host}:${openVscode.port}`
      : `https://${openVscode.host}`
  const noVncBaseUrl =
    noVnc.port !== 443
      ? `https://${noVnc.host}:${noVnc.port}`
      : `https://${noVnc.host}`

  const tunnels: SandboxTunnelUrlsWithAgentApi = {
    agentApiUrl,
    openVscodeUrl,
    noVncUrl: `${noVncBaseUrl}/vnc.html`
  }

  await setCachedSandboxTunnels(sandboxId, tunnels)
  return tunnels
}

export async function getModalSessionSandboxTunnelUrls (input: {
  readonly sandboxId: string
}): Promise<SandboxTunnelUrls> {
  const sandboxId = input.sandboxId.trim()
  if (sandboxId.length === 0) throw new Error('sandboxId is required')
  const resp = await fetchSandboxTunnels(
    sandboxId,
    SESSION_SANDBOX_TUNNELS_RPC_WAIT_SECONDS
  )

  const byPort = new Map<
    number,
    { readonly host: string; readonly port: number }
  >()
  for (const t of resp.tunnels ?? [])
    byPort.set(t.containerPort, { host: t.host, port: t.port })

  const openVscode = byPort.get(SESSION_SANDBOX_OPENVSCODE_PORT)
  if (!openVscode)
    throw new Error(
      `Expected tunnel for port ${SESSION_SANDBOX_OPENVSCODE_PORT}`
    )

  const noVnc = byPort.get(SESSION_SANDBOX_NOVNC_PORT)
  if (!noVnc)
    throw new Error(`Expected tunnel for port ${SESSION_SANDBOX_NOVNC_PORT}`)

  const openVscodeUrl =
    openVscode.port !== 443
      ? `https://${openVscode.host}:${openVscode.port}`
      : `https://${openVscode.host}`
  const noVncBaseUrl =
    noVnc.port !== 443
      ? `https://${noVnc.host}:${noVnc.port}`
      : `https://${noVnc.host}`

  return {
    openVscodeUrl,
    noVncUrl: `${noVncBaseUrl}/vnc.html`
  }
}

export function buildModalSandboxAccessUrls (input: {
  readonly tunnels: SandboxTunnelUrls
  readonly sandboxAccessToken: string
}): SandboxTunnelUrls {
  const token = input.sandboxAccessToken.trim()
  if (token.length === 0) throw new Error('sandboxAccessToken is required')

  const openVscode = new URL(input.tunnels.openVscodeUrl)
  if (!openVscode.pathname.endsWith('/'))
    openVscode.pathname = `${openVscode.pathname}/`
  openVscode.searchParams.set('tkn', token)

  const noVnc = new URL(input.tunnels.noVncUrl)
  noVnc.searchParams.set('password', token)

  return { openVscodeUrl: openVscode.toString(), noVncUrl: noVnc.toString() }
}

async function createAgentSandboxModal (input: {
  readonly agentId: string
  readonly dbImageId: string
  readonly imageId: string
  readonly sandboxAccessToken: string
  readonly runtimeInternalSecret: string
  readonly region?: SandboxRegion
}): Promise<Sandbox> {
  const agentManagerBaseUrl = await resolveAgentManagerBaseUrl()
  const secretName = 'openinspect-build-secret'

  const allowedOrigins = buildAllowedOrigins(agentManagerBaseUrl)

  const sandboxEnv: Record<string, string> = {
    PORT: String(SESSION_SANDBOX_AGENT_API_PORT),
    DOCKERD_ENABLED: '1',
    PROFILE_CHECKPOINT_ENABLED: '1',
    PROFILE_CHECKPOINT_INTERVAL_SEC: '15',
    PROFILE_CHECKPOINT_KEEP: '40',
    AGENT_HOME: '/home/agent',
    WORKSPACES_DIR: '/home/agent/workspaces',
    DEFAULT_WORKING_DIR: '/home/agent/workspaces',
    IMAGE_ID: input.dbImageId,
    DOCKERD_BRIDGE: 'none',
    AGENT_DOCKER_FORCE_HOST_NETWORK: '1',
    ...((process.env.PI_DIR ?? '').trim().length > 0
      ? { PI_DIR: (process.env.PI_DIR ?? '').trim() }
      : {}),
    OPENVSCODE_CONNECTION_TOKEN: input.sandboxAccessToken,
    VNC_PASSWORD: input.sandboxAccessToken,
    SECRET_SEED: env.SANDBOX_SIGNING_SECRET,
    AGENT_RUNTIME_MODE: 'all',
    AGENT_ID: input.agentId,
    AGENT_INTERNAL_AUTH_SECRET: input.runtimeInternalSecret,
    AGENT_MANAGER_BASE_URL: agentManagerBaseUrl,
    AGENT_ALLOWED_ORIGINS: allowedOrigins
  }

  console.log(
    `[modal] creating sandbox agentId=${input.agentId} imageId=${input.imageId}`
  )

  const regions =
    typeof input.region === 'string'
      ? [input.region]
      : input.region
      ? [...input.region]
      : undefined

  try {
    const app = await withTimeout(
      modalClient.apps.fromName('agent-sandboxes', { createIfMissing: true }),
      MODAL_SANDBOX_CREATE_STEP_TIMEOUT_MS,
      'app lookup (agent-sandboxes)'
    )
    const image = await withTimeout(
      modalClient.images.fromId(input.imageId),
      MODAL_SANDBOX_CREATE_STEP_TIMEOUT_MS,
      `image lookup (${input.imageId})`
    )
    const imageRecord = await getImageByIdIncludingArchived(input.dbImageId)
    if (!imageRecord) {
      throw new HTTPException(404, { message: 'Image not found' })
    }
    const sandboxStartCommand = buildSandboxStartCommand(imageRecord.runScript)

    const apiKeys = {
      OPENAI_API_KEY: (process.env.OPENAI_API_KEY ?? '').trim(),
      ANTHROPIC_API_KEY: (process.env.ANTHROPIC_API_KEY ?? '').trim(),
      GOOGLE_GENERATIVE_AI_API_KEY: (
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? ''
      ).trim()
    }

    const filteredKeys = Object.fromEntries(
      Object.entries(apiKeys).filter(([, value]) => value.length > 0)
    )
    const apiKeySecret =
      Object.keys(filteredKeys).length > 0
        ? await modalClient.secrets.fromObject(filteredKeys)
        : null

    let namedSecret: Awaited<
      ReturnType<typeof modalClient.secrets.fromName>
    > | null = null
    try {
      namedSecret = await withTimeout(
        modalClient.secrets.fromName(secretName),
        MODAL_SANDBOX_CREATE_STEP_TIMEOUT_MS,
        `secret lookup (${secretName})`
      )
    } catch (err) {
      console.error(
        `[modal] secret not found: ${secretName}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
      namedSecret = null
    }

    let environmentSecretNames: readonly string[] = []
    try {
      const bindings = await listEnvironmentSecrets(input.dbImageId)
      environmentSecretNames = normalizeSecretNames(
        bindings.map(binding => binding.modalSecretName)
      ).filter(name => name !== secretName)
    } catch (err) {
      console.error(
        '[modal] failed to list environment secrets for sandbox',
        {
          agentId: input.agentId,
          imageId: input.dbImageId
        },
        err
      )
      environmentSecretNames = []
    }

    const environmentSecretRefs: Array<
      Awaited<ReturnType<typeof modalClient.secrets.fromName>>
    > = []
    for (const environmentSecretName of environmentSecretNames) {
      try {
        const resolved = await withTimeout(
          modalClient.secrets.fromName(environmentSecretName),
          MODAL_SANDBOX_CREATE_STEP_TIMEOUT_MS,
          `secret lookup (${environmentSecretName})`
        )
        environmentSecretRefs.push(resolved)
      } catch (err) {
        console.error(
          `[modal] environment secret not found: ${environmentSecretName}: ${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }
    }

    const secrets = [
      namedSecret,
      apiKeySecret,
      ...environmentSecretRefs
    ].filter(v => v != null)

    const sandbox = await withTimeout(
      modalClient.sandboxes.create(app, image, {
        command: [...sandboxStartCommand],
        experimentalOptions: { enable_docker: true },
        env: sandboxEnv,
        secrets,
        encryptedPorts: [
          SESSION_SANDBOX_AGENT_API_PORT,
          SESSION_SANDBOX_OPENVSCODE_PORT,
          SESSION_SANDBOX_NOVNC_PORT
        ],
        timeoutMs: 60 * 60 * 1000,
        idleTimeoutMs: SESSION_SANDBOX_IDLE_TIMEOUT_MS,
        ...(regions ? { regions } : {})
      }),
      MODAL_SANDBOX_CREATE_CALL_TIMEOUT_MS,
      'sandbox create'
    )

    console.log(
      `[session-sandbox] modal sandbox created agentId=${input.agentId} sandboxId=${sandbox.sandboxId}`
    )
    return sandbox
  } catch (err) {
    console.error('[session-sandbox] create failed', err)
    throw new HTTPException(502, {
      message: `Modal sandbox create failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    })
  }
}

export async function getAgentSandbox (input: {
  readonly agentId: string
}): Promise<AgentSandboxResult> {
  const agentId = input.agentId.trim()
  if (agentId.length === 0) throw new Error('agentId is required')
  const agent = await getAgentById(agentId)
  if (!agent) throw new Error('Agent not found')
  if (!agent.currentSandboxId) throw new Error('Agent has no current sandbox')

  const cached = AGENT_ID_TO_SANDBOX.get(agent.id)
  const sandbox =
    cached && cached.sandboxId === agent.currentSandboxId
      ? cached
      : await modalClient.sandboxes.fromId(agent.currentSandboxId)

  if (cached && cached !== sandbox) AGENT_ID_TO_SANDBOX.delete(agent.id)
  AGENT_ID_TO_SANDBOX.set(agent.id, sandbox)

  if (!(await isSandboxAlive(sandbox)))
    throw new Error('Modal sandbox tunnels unreachable')

  const tunnels =
    (await getCachedSandboxTunnels(sandbox.sandboxId)) ??
    (await waitForSandboxTunnelsWithAgentApi(sandbox.sandboxId))
  const sandboxAccessToken = await getAgentAccessToken(agent.id)
  return { tunnels, sandboxAccessToken, sandbox }
}

async function createAgentSandbox (input: {
  readonly agentId: string
  readonly imageId: string
  readonly region?: SandboxRegion
}): Promise<AgentSandboxResult> {
  const agent = await getAgentById(input.agentId)
  if (!agent) throw new Error('Agent not found')

  if (agent.currentSandboxId !== null) {
    try {
      return await getAgentSandbox({ agentId: input.agentId })
    } catch {
      await clearAgentSandboxIfMatches({
        id: input.agentId,
        currentSandboxId: agent.currentSandboxId
      }).catch(() => {})
    }
  }

  const sandboxAccessToken = await getAgentAccessToken(input.agentId)
  const runtimeInternalSecret = await createAgentRuntimeInternalSecret(
    input.agentId
  )

  const sandbox = await createAgentSandboxModal({
    agentId: input.agentId,
    dbImageId: agent.imageId!,
    imageId: input.imageId,
    sandboxAccessToken,
    runtimeInternalSecret,
    region: input.region
  })

  const tunnels = await waitForSandboxTunnelsWithAgentApi(sandbox.sandboxId)

  const startedAt = Date.now()
  let healthy = false
  while (
    Date.now() - startedAt <
    SESSION_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS
  ) {
    if (await fetchAgentHealthOk(tunnels.agentApiUrl)) {
      healthy = true
      break
    }
    await sleepMs(SESSION_SANDBOX_POST_CREATE_HEALTH_RETRY_MS)
  }

  if (!healthy) {
    await modalClient.cpClient
      .sandboxTerminate(
        { sandboxId: sandbox.sandboxId },
        { timeoutMs: MODAL_TERMINATE_RPC_TIMEOUT_MS }
      )
      .catch(() => {})
    throw new Error(
      `Sandbox health check did not pass within ${SESSION_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS}ms`
    )
  }

  await Promise.all([
    setCachedSandboxTunnels(sandbox.sandboxId, tunnels),
    setAgentSandbox({
      id: input.agentId,
      currentSandboxId: sandbox.sandboxId,
      runtimeInternalSecret
    })
  ])
  AGENT_ID_TO_SANDBOX.delete(input.agentId)
  AGENT_ID_TO_SANDBOX.set(input.agentId, sandbox)

  return { tunnels, sandboxAccessToken, sandbox }
}

export async function ensureAgentSandbox (input: {
  readonly agentId: string
  readonly imageId?: string
  readonly region?: SandboxRegion
}): Promise<AgentSandboxResult> {
  const agentId = input.agentId.trim()
  if (agentId.length === 0) throw new Error('agentId is required')

  return await withLock(
    {
      key: `locks:agent-sandbox:create:${agentId}`,
      ttlMs: SESSION_SANDBOX_CREATE_LOCK_TTL_MS,
      waitMs: SESSION_SANDBOX_CREATE_LOCK_WAIT_MS,
      retryDelayMs: 250
    },
    async () => {
      const agent = await getAgentById(agentId)
      if (!agent) throw new HTTPException(404, { message: 'Agent not found' })

      try {
        return await getAgentSandbox({ agentId })
      } catch {
        // Sandbox doesn't exist or is unhealthy - will create below
      }

      let candidateImageIds: string[]
      if (input.imageId) {
        candidateImageIds = [input.imageId]
      } else {
        if (typeof agent.createdBy !== 'string' || agent.createdBy.length === 0) {
          throw new HTTPException(409, { message: 'Agent owner is missing' })
        }
        const baseVariant =
          typeof agent.imageId === 'string' && agent.imageId.length > 0
            ? await resolveImageVariantForUser({
                imageId: agent.imageId,
                userId: agent.createdBy,
                variantId: agent.imageVariantId
              })
            : null
        const baseImageId = baseVariant?.headImageId?.trim() || ''
        if (baseImageId.length === 0)
          throw new HTTPException(409, { message: 'Agent image is missing' })

        const snapshotImageId = agent.snapshotImageId?.trim() ?? ''
        candidateImageIds = [snapshotImageId, baseImageId].filter(
          v => v.length > 0
        )
      }

      const region = input.region ?? agent.region ?? DEFAULT_REGION
      let lastErr: unknown = null
      for (const imageId of candidateImageIds) {
        try {
          return await createAgentSandbox({
            agentId,
            imageId,
            region
          })
        } catch (err) {
          lastErr = err
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
    }
  )
}

export async function getAgentRuntimeAccess (input: {
  readonly userId: string
  readonly agentId: string
  readonly authTtlSeconds?: number
}): Promise<AgentRuntimeAccess> {
  const { tunnels, sandboxAccessToken, sandbox } = await ensureAgentSandbox({
    agentId: input.agentId
  })
  const links = buildModalSandboxAccessUrls({
    tunnels: {
      openVscodeUrl: tunnels.openVscodeUrl,
      noVncUrl: tunnels.noVncUrl
    },
    sandboxAccessToken
  })
  const agentId = input.agentId.trim()
  const agentSessionId = agentIdToAgentSessionId(agentId)
  const auth = await getSandboxAgentToken({
    userId: input.userId,
    agentId,
    agentSessionId,
    expiresInSeconds:
      input.authTtlSeconds ?? DEFAULT_SANDBOX_AGENT_TOKEN_TTL_SECONDS
  })

  return {
    agentId,
    sandboxId: sandbox.sandboxId,
    agentSessionId,
    agentApiUrl: tunnels.agentApiUrl,
    openVscodeUrl: links.openVscodeUrl,
    noVncUrl: links.noVncUrl,
    agentAuthToken: auth.token,
    agentAuthExpiresInSeconds: auth.expiresInSeconds
  }
}

export async function getAgentTerminalAccess (input: {
  readonly userId: string
  readonly agentId: string
  readonly authTtlSeconds?: number
}): Promise<TerminalAccess> {
  const { tunnels, sandbox } = await ensureAgentSandbox({
    agentId: input.agentId
  })
  const terminalUrl = new URL(tunnels.agentApiUrl)
  const basePath = terminalUrl.pathname.endsWith('/')
    ? terminalUrl.pathname.slice(0, -1)
    : terminalUrl.pathname
  terminalUrl.pathname = `${basePath}/terminal`
  terminalUrl.search = ''
  terminalUrl.hash = ''

  const agentId = input.agentId.trim()
  const agentSessionId = agentIdToAgentSessionId(agentId)
  const auth = await getSandboxAgentToken({
    userId: input.userId,
    agentId,
    agentSessionId,
    expiresInSeconds:
      input.authTtlSeconds ?? DEFAULT_SANDBOX_AGENT_TOKEN_TTL_SECONDS
  })

  const wsUrl = new URL(terminalUrl.toString())
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'

  return {
    sandboxId: sandbox.sandboxId,
    terminalUrl: terminalUrl.toString(),
    wsUrl: wsUrl.toString(),
    authToken: auth.token,
    authTokenExpiresInSeconds: auth.expiresInSeconds
  }
}

export async function snapshotAgentSandbox (input: {
  readonly sandboxId: string
}): Promise<string> {
  const sandboxId = input.sandboxId.trim()
  if (sandboxId.length === 0) throw new Error('sandboxId is required')

  let cachedSandbox: Sandbox | null = null
  for (const sb of AGENT_ID_TO_SANDBOX.values()) {
    if (sb.sandboxId === sandboxId) {
      cachedSandbox = sb
      break
    }
  }
  const sandbox =
    cachedSandbox ?? (await modalClient.sandboxes.fromId(sandboxId))

  try {
    const image = await sandbox.snapshotFilesystem(10 * 60 * 1000)
    const imageId = image.imageId?.trim()
    if (!imageId) throw new Error('Sandbox snapshot response missing `imageId`')
    return imageId
  } catch (err) {
    console.error(
      '[session-sandbox] snapshot failed',
      { sandboxId: sandbox.sandboxId },
      err
    )
    throw new HTTPException(502, {
      message: `Modal sandbox snapshot failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    })
  }
}

export async function terminateAgentSandbox (input: {
  readonly sandboxId: string
}): Promise<void> {
  const sandboxId = input.sandboxId.trim()
  if (sandboxId.length === 0) throw new Error('sandboxId is required')

  try {
    await modalClient.cpClient.sandboxTerminate(
      { sandboxId },
      { timeoutMs: MODAL_TERMINATE_RPC_TIMEOUT_MS }
    )
  } catch (err) {
    console.error('[session-sandbox] terminate failed', { sandboxId }, err)
    throw new HTTPException(502, {
      message: `Modal sandbox terminate failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    })
  }
}

export async function isAgentSandboxHealthy (input: {
  readonly sandboxId: string
}): Promise<boolean> {
  const sandboxId = input.sandboxId.trim()
  if (sandboxId.length === 0) return false

  const cached = await getCachedSandboxTunnels(sandboxId)
  if (cached?.agentApiUrl) return await fetchAgentHealthOk(cached.agentApiUrl)

  try {
    const tunnels = await waitForSandboxTunnelsWithAgentApi(sandboxId)
    return await fetchAgentHealthOk(tunnels.agentApiUrl)
  } catch {
    return false
  }
}

export function getImageSetupSandboxSession (input: {
  readonly sandboxId: string
}): ImageSetupSandboxSession | null {
  const sandboxId = input.sandboxId.trim()
  if (sandboxId.length === 0) return null
  return IMAGE_SETUP_SANDBOXES.get(sandboxId) ?? null
}

export async function createSetupSandbox (input: {
  readonly imageId: string
  readonly variantId: string
  readonly userId: string
  readonly region?: SandboxRegion
}): Promise<CreateSetupSandboxResult> {
  const image = await getImageById(input.imageId)
  if (!image) throw new Error('Image not found')

  const variant = await getImageVariantForImage({
    imageId: input.imageId,
    variantId: input.variantId
  })
  if (!variant || !canUserAccessImageVariant({ userId: input.userId, variant }))
    throw new Error('Image variant not found')

  const explicitBaseImageSource =
    typeof variant.baseImageId === 'string' ? variant.baseImageId.trim() : ''
  const normalizedBaseImageSource =
    explicitBaseImageSource.length > 0 ? explicitBaseImageSource : null

  const app = await modalClient.apps.fromName(SETUP_APP_NAME, {
    createIfMissing: true
  })

  const looksLikeModalImageId = normalizedBaseImageSource
    ? /^im-[a-z0-9]+$/i.test(normalizedBaseImageSource)
    : false
  const explicitBaseImageId =
    normalizedBaseImageSource && looksLikeModalImageId
      ? normalizedBaseImageSource
      : null
  const explicitBaseImageRef =
    normalizedBaseImageSource && !looksLikeModalImageId
      ? await resolveBaseImageRefForRegistry(normalizedBaseImageSource)
      : null

  const defaultBaseImageRef =
    (process.env.AGENT_BASE_IMAGE_REF ?? '').trim() ||
    'ghcr.io/suhjohn/agent:latest'
  const baseImageRef = explicitBaseImageRef
    ? explicitBaseImageRef
    : explicitBaseImageId
    ? null
    : await resolveBaseImageRefForRegistry(defaultBaseImageRef)
  const modalImage = explicitBaseImageId
    ? await modalClient.images.fromId(explicitBaseImageId)
    : modalClient.images.fromRegistry(baseImageRef!)

  let namedSecret: Awaited<
    ReturnType<typeof modalClient.secrets.fromName>
  > | null = null
  try {
    namedSecret = await modalClient.secrets.fromName(SETUP_SECRET_NAME)
  } catch {
    namedSecret = null
  }

  const regions =
    typeof input.region === 'string'
      ? [input.region]
      : input.region
      ? [...input.region]
      : undefined
  const agentManagerBaseUrl = await resolveAgentManagerBaseUrl()
  const setupStartupWaitSeconds = Math.max(
    1,
    Math.ceil(SETUP_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS / 1000)
  )
  const setupStartupRetrySeconds = Math.max(
    1,
    Math.ceil(SETUP_SANDBOX_POST_CREATE_HEALTH_RETRY_MS / 1000)
  )

  const sandbox = await modalClient.sandboxes.create(app, modalImage, {
    command: [...SETUP_SERVER_COMMAND],
    env: {
      AGENT_HOME: '/home/agent',
      WORKSPACES_DIR: '/home/agent/workspaces',
      HOME: '/home/agent',
      AGENT_RUNTIME_MODE: 'server',
      AGENT_ID: setupSandboxAgentId(input.imageId),
      PORT: String(SETUP_TERMINAL_PORT),
      SECRET_SEED: env.SANDBOX_SIGNING_SECRET,
      AGENT_MANAGER_BASE_URL: agentManagerBaseUrl,
      AGENT_MANAGER_API_KEY: env.AGENT_MANAGER_API_KEY,
      AGENT_ALLOWED_ORIGINS: buildAllowedOrigins(agentManagerBaseUrl),
      TERM: 'xterm-256color'
    },
    ...(namedSecret ? { secrets: [namedSecret] } : {}),
    encryptedPorts: [SETUP_TERMINAL_PORT],
    timeoutMs: SETUP_TIMEOUT_MS,
    idleTimeoutMs: SETUP_IDLE_TIMEOUT_MS,
    ...(regions ? { regions } : {})
  })

  try {
    const probe = await sandbox.exec(
      [
        'bash',
        '-lc',
        [
          `deadline=$((SECONDS + ${setupStartupWaitSeconds}))`,
          `while [ "$SECONDS" -lt "$deadline" ]; do`,
          `  curl -fsS "http://127.0.0.1:${SETUP_TERMINAL_PORT}/health" >/dev/null 2>&1 && exit 0;`,
          `  sleep ${setupStartupRetrySeconds};`,
          `done;`,
          `exit 1;`
        ].join('\n')
      ],
      { timeoutMs: SETUP_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS + 10_000 }
    )
    const exitCode = await probe.wait()
    if (exitCode !== 0) throw new Error(`startup probe exited ${exitCode}`)
  } catch (err) {
    const source = normalizedBaseImageSource
      ? `baseImage=${normalizedBaseImageSource}`
      : `baseImageRef=${baseImageRef ?? 'unknown'}`
    throw new Error(
      `Setup sandbox failed to start from ${source}: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }

  IMAGE_SETUP_SANDBOXES.set(sandbox.sandboxId, {
    sandboxId: sandbox.sandboxId,
    imageId: input.imageId,
    variantId: input.variantId,
    userId: input.userId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  })

  return {
    sandboxId: sandbox.sandboxId,
    variantId: input.variantId,
    baseImageId: normalizedBaseImageSource
  }
}

export async function getSetupSandboxTerminalAccess (input: {
  readonly userId: string
  readonly sandboxId: string
  readonly authTtlSeconds?: number
}): Promise<TerminalAccess> {
  const sandboxId = input.sandboxId.trim()
  if (sandboxId.length === 0) throw new Error('sandboxId is required')
  const session = IMAGE_SETUP_SANDBOXES.get(sandboxId)
  if (!session)
    throw new HTTPException(404, { message: 'Setup sandbox not found' })
  IMAGE_SETUP_SANDBOXES.set(sandboxId, { ...session, updatedAt: Date.now() })

  const startedAt = Date.now()
  const deadline = startedAt + SETUP_TUNNELS_READY_TIMEOUT_MS
  let lastErr: unknown = null
  let tunnelBaseUrl: string | null = null

  while (Date.now() <= deadline) {
    try {
      const response = (await modalClient.cpClient.sandboxGetTunnels({
        sandboxId: session.sandboxId,
        timeout: SETUP_TUNNELS_RPC_TIMEOUT_SECONDS
      })) as unknown as RawSandboxTunnelsResponse
      const tunnel = (response.tunnels ?? []).find(
        value => value.containerPort === SETUP_TERMINAL_PORT
      )
      if (!tunnel)
        throw new Error(`Expected tunnel for port ${SETUP_TERMINAL_PORT}`)
      tunnelBaseUrl = `https://${tunnel.host}:${tunnel.port}`
      break
    } catch (err) {
      lastErr = err
      if (!isTransientSandboxLookupError(err)) throw err
      if (Date.now() >= deadline) break
      await sleepMs(SETUP_TUNNELS_RETRY_INTERVAL_MS)
    }
  }

  if (!tunnelBaseUrl) {
    throw new Error(
      `Setup sandbox tunnels unavailable after ${Date.now() - startedAt}ms: ${
        lastErr instanceof Error
          ? lastErr.message
          : String(lastErr ?? 'unknown error')
      }`
    )
  }

  const terminalUrl = new URL(tunnelBaseUrl)
  const basePath = terminalUrl.pathname.endsWith('/')
    ? terminalUrl.pathname.slice(0, -1)
    : terminalUrl.pathname
  terminalUrl.pathname = `${basePath}/terminal`
  terminalUrl.search = ''
  terminalUrl.hash = ''

  const auth = await getSandboxAgentToken({
    userId: input.userId,
    agentId: setupSandboxAgentId(session.imageId),
    agentSessionId: `setup-${session.sandboxId}`,
    expiresInSeconds:
      input.authTtlSeconds ?? DEFAULT_SANDBOX_AGENT_TOKEN_TTL_SECONDS
  })

  const wsUrl = new URL(terminalUrl.toString())
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'

  return {
    sandboxId: session.sandboxId,
    terminalUrl: terminalUrl.toString(),
    wsUrl: wsUrl.toString(),
    authToken: auth.token,
    authTokenExpiresInSeconds: auth.expiresInSeconds
  }
}

export async function snapshotSetupSandbox (input: {
  readonly userId: string
  readonly sandboxId: string
}): Promise<SetupSandboxSnapshotResult> {
  const sandboxId = input.sandboxId.trim()
  if (sandboxId.length === 0) throw new Error('sandboxId is required')
  const session = IMAGE_SETUP_SANDBOXES.get(sandboxId)
  if (!session)
    throw new HTTPException(404, { message: 'Setup sandbox not found' })
  IMAGE_SETUP_SANDBOXES.set(sandboxId, { ...session, updatedAt: Date.now() })

  const sandbox = await modalClient.sandboxes.fromId(session.sandboxId)
  const snapshot = await sandbox.snapshotFilesystem(SETUP_SNAPSHOT_TIMEOUT_MS)
  const snapshotImageId =
    typeof snapshot.imageId === 'string' ? snapshot.imageId.trim() : ''
  if (snapshotImageId.length === 0)
    throw new Error('Snapshot did not return an image id.')

  const updatedVariant = await setImageVariantBaseImageId({
    variantId: session.variantId,
    baseImageId: snapshotImageId
  })
  if (!updatedVariant)
    throw new Error('Image variant not found for setup sandbox session')

  return { baseImageId: snapshotImageId, variantId: session.variantId }
}

export async function terminateSetupSandbox (input: {
  readonly userId: string
  readonly sandboxId: string
}): Promise<void> {
  const sandboxId = input.sandboxId.trim()
  if (sandboxId.length === 0) throw new Error('sandboxId is required')
  const session = IMAGE_SETUP_SANDBOXES.get(sandboxId)
  if (!session)
    throw new HTTPException(404, { message: 'Setup sandbox not found' })

  const sandbox = await modalClient.sandboxes.fromId(session.sandboxId)
  await sandbox.terminate()
  IMAGE_SETUP_SANDBOXES.delete(session.sandboxId)
}
