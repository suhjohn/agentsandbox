import { HTTPException } from 'hono/http-exception'
import { agents } from '../db/schema'
import type { AuthUser } from '../types/context'
import {
  createAgent,
  getAgentById,
  getAgentRuntimeInternalSecret
} from './agent.service'
import {
  agentIdToAgentSessionId,
  buildModalSandboxAccessUrls,
  ensureAgentSandbox,
  getSandboxAgentToken
} from './sandbox.service'
import { getImageById, getImageByIdIncludingArchived, resolveImageVariantForUser } from './image.service'
import { DEFAULT_REGION } from '../utils/region'

type DbAgent = typeof agents.$inferSelect

type RuntimeAccessPayload = {
  readonly openVscodeUrl: string
  readonly noVncUrl: string
  readonly agentApiUrl: string
  readonly agentSessionId: string
  readonly agentAuthToken: string
  readonly agentAuthExpiresInSeconds: number
}

const SANDBOX_AGENT_TOKEN_TTL_SECONDS = 5 * 60

type CreateSessionBootstrapBody = {
  readonly parentAgentId?: string
  readonly imageId: string
  readonly region?: string | readonly string[]
  readonly message: string
  readonly title?: string
  readonly harness?: 'codex' | 'pi'
  readonly model?: string
  readonly modelReasoningEffort?:
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
}

type StartAgentSessionBody = {
  readonly sessionId?: string
  readonly message: string
  readonly title?: string
  readonly harness?: 'codex' | 'pi'
  readonly model?: string
  readonly modelReasoningEffort?:
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
}

function toPublicAgent<T extends Record<string, unknown>> (
  agent: T
): Omit<T, 'sandboxAccessToken' | 'runtimeInternalSecret'> {
  const {
    sandboxAccessToken: _token,
    runtimeInternalSecret: _runtimeInternalSecret,
    ...rest
  } = agent as T & {
    sandboxAccessToken?: unknown
    runtimeInternalSecret?: unknown
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

  return {
    ...publicAgent,
    createdByUser: { id: user.id, name: user.name },
    image: image ? { id: image.id, name: image.name } : null
  }
}

async function getAuthorizedImage (_userId: string, imageId: string) {
  const image = await getImageById(imageId)
  return image ?? null
}

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

function buildAgentApiUrl (agentApiUrl: string, path: string): string {
  const url = new URL(agentApiUrl)
  const basePath = url.pathname.endsWith('/')
    ? url.pathname.slice(0, -1)
    : url.pathname
  const suffix = path.startsWith('/') ? path : `/${path}`
  url.pathname = `${basePath}${suffix}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function getErrorMessageFromBody (body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null

  const candidate = body as {
    readonly error?: unknown
    readonly message?: unknown
  }
  if (
    typeof candidate.error === 'string' &&
    candidate.error.trim().length > 0
  ) {
    return candidate.error.trim()
  }
  if (
    typeof candidate.message === 'string' &&
    candidate.message.trim().length > 0
  ) {
    return candidate.message.trim()
  }
  return null
}

async function callAgentApi (input: {
  readonly agentApiUrl: string
  readonly runtimeInternalSecret: string
  readonly userId: string
  readonly path: string
  readonly method: 'POST'
  readonly body: unknown
}): Promise<unknown> {
  const url = buildAgentApiUrl(input.agentApiUrl, input.path)

  let response: Response
  try {
    response = await fetch(url, {
      method: input.method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Agent-Internal-Auth': input.runtimeInternalSecret,
        'X-Actor-User-Id': input.userId
      },
      body: JSON.stringify(input.body)
    })
  } catch (err) {
    throw new HTTPException(502, {
      message: `Failed to call agent runtime: ${
        err instanceof Error ? err.message : String(err)
      }`
    })
  }

  const body = (await response.json().catch(() => null)) as unknown
  if (!response.ok) {
    const message =
      getErrorMessageFromBody(body) ??
      `Agent runtime request failed (${response.status} ${response.statusText})`
    throw new HTTPException(502, { message })
  }

  return body
}

function buildSessionResult (input: {
  readonly agentApiUrl: string
  readonly sessionId: string
  readonly runId: string
}) {
  return {
    id: input.sessionId,
    streamUrl: buildAgentApiUrl(
      input.agentApiUrl,
      `/session/${input.sessionId}/stream`
    ),
    runId: input.runId,
    runStreamUrl: buildAgentApiUrl(
      input.agentApiUrl,
      `/session/${input.sessionId}/message/${input.runId}/stream`
    )
  }
}

function parseRunId (responseBody: unknown): string {
  if (typeof responseBody !== 'object' || responseBody === null) {
    throw new HTTPException(502, { message: 'Invalid runtime run response' })
  }
  const runId = (responseBody as { readonly runId?: unknown }).runId
  if (typeof runId !== 'string' || runId.trim().length === 0) {
    throw new HTTPException(502, { message: 'Runtime runId was missing' })
  }
  return runId
}

export async function createSessionBootstrap (input: {
  readonly user: AuthUser
  readonly body: CreateSessionBootstrapBody
}) {
  const { user, body } = input

  const image = await getAuthorizedImage(user.id, body.imageId)
  if (!image) {
    throw new HTTPException(404, { message: 'Image not found' })
  }
  const variant = await resolveImageVariantForUser({
    imageId: body.imageId,
    userId: user.id
  })
  if (!variant) {
    throw new HTTPException(404, { message: 'Image variant not found' })
  }
  const effectiveCurrentImageId = variant.headImageId?.trim() || ''
  if (!effectiveCurrentImageId) {
    throw new HTTPException(409, { message: 'Image is not built yet' })
  }

  let parentAgentId: string | null = null
  if (body.parentAgentId) {
    const parent = await getAgentById(body.parentAgentId)
    if (!parent || parent.createdBy !== user.id) {
      throw new HTTPException(404, { message: 'Parent agent not found' })
    }
    parentAgentId = parent.id
  }

  const region = body.region ?? user.defaultRegion ?? DEFAULT_REGION
  const agent = await createAgent({
    parentAgentId,
    imageId: body.imageId,
    imageVariantId: variant.id,
    createdBy: user.id,
    region
  })

  const sandbox = await ensureAgentSandbox({
    agentId: agent.id,
    imageId: effectiveCurrentImageId,
    region
  })

  const access = await buildRuntimeAccessPayload({
    userId: user.id,
    agentId: agent.id,
    tunnels: sandbox.tunnels,
    sandboxAccessToken: sandbox.sandboxAccessToken
  })

  const sessionId = agentIdToAgentSessionId(agent.id)
  const createSessionBody: Record<string, unknown> = {
    id: sessionId
  }
  if (typeof body.title === 'string' && body.title.trim().length > 0) {
    createSessionBody.title = body.title.trim()
  }
  if (body.harness) createSessionBody.harness = body.harness
  if (body.model) createSessionBody.model = body.model
  if (body.modelReasoningEffort) {
    createSessionBody.modelReasoningEffort = body.modelReasoningEffort
  }

  const runtimeInternalSecret = await getAgentRuntimeInternalSecret(agent.id)
  await callAgentApi({
    agentApiUrl: access.agentApiUrl,
    runtimeInternalSecret,
    userId: user.id,
    path: '/session',
    method: 'POST',
    body: createSessionBody
  })

  const runBody: Record<string, unknown> = {
    input: [{ type: 'text', text: body.message }]
  }
  if (body.model) runBody.model = body.model
  if (body.modelReasoningEffort) {
    runBody.modelReasoningEffort = body.modelReasoningEffort
  }

  const runResponse = await callAgentApi({
    agentApiUrl: access.agentApiUrl,
    runtimeInternalSecret,
    userId: user.id,
    path: `/session/${sessionId}/message`,
    method: 'POST',
    body: runBody
  })
  const runId = parseRunId(runResponse)

  const updatedAgent = await getAgentById(agent.id)
  if (!updatedAgent) {
    throw new Error('Agent not found - should not happen')
  }
  const hydrated = await toHydratedPublicAgent(
    { id: user.id, name: user.name },
    updatedAgent,
    { image: { id: image.id, name: image.name } }
  )

  return {
    agent: hydrated,
    session: buildSessionResult({
      agentApiUrl: access.agentApiUrl,
      sessionId,
      runId
    }),
    access
  }
}

export async function startAgentSession (input: {
  readonly user: AuthUser
  readonly agentId: string
  readonly body: StartAgentSessionBody
}) {
  const { user, body } = input
  const agentId = input.agentId.trim()
  if (agentId.length === 0) {
    throw new HTTPException(400, { message: 'Agent ID is required' })
  }

  const agent = await getAgentById(agentId)
  if (!agent) {
    throw new HTTPException(404, { message: 'Agent not found' })
  }

  const sandbox = await ensureAgentSandbox({ agentId })
  const runtimeInternalSecret = await getAgentRuntimeInternalSecret(agentId)
  const sessionId =
    body.sessionId?.trim() || crypto.randomUUID().replace(/-/g, '')

  const createSessionBody: Record<string, unknown> = {
    id: sessionId
  }
  if (typeof body.title === 'string' && body.title.trim().length > 0) {
    createSessionBody.title = body.title.trim()
  }
  if (body.harness) createSessionBody.harness = body.harness
  if (body.model) createSessionBody.model = body.model
  if (body.modelReasoningEffort) {
    createSessionBody.modelReasoningEffort = body.modelReasoningEffort
  }

  await callAgentApi({
    agentApiUrl: sandbox.tunnels.agentApiUrl,
    runtimeInternalSecret,
    userId: user.id,
    path: '/session',
    method: 'POST',
    body: createSessionBody
  })

  const runBody: Record<string, unknown> = {
    input: [{ type: 'text', text: body.message }]
  }
  if (body.model) runBody.model = body.model
  if (body.modelReasoningEffort) {
    runBody.modelReasoningEffort = body.modelReasoningEffort
  }

  const runResponse = await callAgentApi({
    agentApiUrl: sandbox.tunnels.agentApiUrl,
    runtimeInternalSecret,
    userId: user.id,
    path: `/session/${sessionId}/message`,
    method: 'POST',
    body: runBody
  })
  const runId = parseRunId(runResponse)

  const updatedAgent = await getAgentById(agentId)
  if (!updatedAgent) {
    throw new Error('Agent not found - should not happen')
  }

  return {
    agent: await toHydratedPublicAgent(
      { id: user.id, name: user.name },
      updatedAgent
    ),
    session: buildSessionResult({
      agentApiUrl: sandbox.tunnels.agentApiUrl,
      sessionId,
      runId
    })
  }
}
