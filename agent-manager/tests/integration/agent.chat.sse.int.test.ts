import '../setup.test'
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { app } from '../../src/app'
import {
  deleteCoordinatorSession,
  getMessagesByCoordinatorSessionId
} from '../../src/services/coordinator-session.service'

type ServerInfo = {
  readonly baseUrl: string
  readonly stop: () => void
}

async function startServer (): Promise<ServerInfo> {
  const server = Bun.serve({
    port: 0,
    fetch: app.fetch
  })

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true)
  }
}

async function jsonFetch (
  baseUrl: string,
  path: string,
  options: RequestInit & { readonly token?: string } = {}
): Promise<Response> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`)
  }
  if (options.headers) {
    const incoming = new Headers(options.headers)
    for (const [key, value] of incoming) {
      headers.set(key, value)
    }
  }

  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers
  })
}

async function registerUser (
  baseUrl: string,
  input: {
    readonly name: string
    readonly email: string
    readonly password: string
  }
): Promise<{ readonly userId: string; readonly accessToken: string }> {
  console.log('[registerUser] registering', input.email)
  const res = await jsonFetch(baseUrl, '/auth/register', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  console.log('[registerUser] status', res.status)
  expect(res.status).toBe(201)
  const body = (await res.json()) as {
    user: { id: string }
    accessToken: string
  }
  console.log('[registerUser] userId', body.user.id)
  return { userId: body.user.id, accessToken: body.accessToken }
}

async function createCoordinatorSessionViaApi (
  baseUrl: string,
  accessToken: string
): Promise<string> {
  const res = await jsonFetch(baseUrl, '/coordinator/session', {
    method: 'POST',
    token: accessToken,
    body: JSON.stringify({})
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { id: string }
  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new Error('Missing coordinator session id')
  }
  return body.id
}

async function startCoordinatorRunViaApi (input: {
  readonly baseUrl: string
  readonly accessToken: string
  readonly coordinatorSessionId: string
  readonly message: string
}): Promise<{ readonly runId: string; readonly streamPath: string }> {
  const res = await jsonFetch(
    input.baseUrl,
    `/coordinator/session/${input.coordinatorSessionId}/runs`,
    {
      method: 'POST',
      token: input.accessToken,
      body: JSON.stringify({
        message: input.message,
        browserAvailable: true
      })
    }
  )
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    runId: string
    streamUrl: string
  }
  if (typeof body.runId !== 'string' || body.runId.length === 0) {
    throw new Error('Missing runId')
  }
  if (typeof body.streamUrl !== 'string' || body.streamUrl.length === 0) {
    throw new Error('Missing streamUrl')
  }
  const streamPath = new URL(body.streamUrl).pathname
  return { runId: body.runId, streamPath }
}

type SseEvent =
  | { readonly text: string }
  | { readonly error: string }
  | { readonly done: true; readonly coordinatorSessionId: string }

function parseSseEvent (payload: string): SseEvent | null {
  const lines = payload
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.length > 0)
  const dataLines = lines
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).trimStart())
  if (dataLines.length === 0) return null
  const jsonText = dataLines.join('\n').trim()
  console.log('[parseSseEvent] raw JSON:', jsonText)
  const parsed = JSON.parse(jsonText) as unknown
  if (!parsed || typeof parsed !== 'object') return null

  if ('done' in parsed) {
    const done = (parsed as { done?: unknown }).done
    const coordinatorSessionId = (parsed as { coordinatorSessionId?: unknown })
      .coordinatorSessionId
    if (done === true && typeof coordinatorSessionId === 'string') {
      return { done: true, coordinatorSessionId }
    }
  }

  const text = (parsed as { text?: unknown }).text
  if (typeof text === 'string') {
    return { text }
  }

  const error = (parsed as { error?: unknown }).error
  if (typeof error === 'string') {
    return { error }
  }

  return null
}

async function readSse (res: Response): Promise<{
  readonly text: string
  readonly doneConversationId: string
}> {
  const body = res.body
  if (!body) {
    throw new Error('Missing response body')
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let doneConversationId: string | null = null
  let errorMessage: string | null = null

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      console.log('[readSse] stream ended')
      break
    }
    const chunk = decoder.decode(value, { stream: true })
    console.log('[readSse] chunk:', JSON.stringify(chunk))
    buffer += chunk

    while (true) {
      const idx = buffer.indexOf('\n\n')
      if (idx === -1) break
      const rawEvent = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const event = parseSseEvent(rawEvent)
      if (!event) {
        console.log('[readSse] unparseable event:', rawEvent)
        continue
      }
      if ('text' in event) {
        console.log('[readSse] text event:', event.text)
        text += event.text
      } else if ('error' in event) {
        console.log('[readSse] error event:', event.error)
        errorMessage = event.error
      } else {
        console.log(
          '[readSse] done event, coordinatorSessionId:',
          event.coordinatorSessionId
        )
        doneConversationId = event.coordinatorSessionId
      }
    }

    if (errorMessage) {
      break
    }
    if (doneConversationId) {
      break
    }
  }

  if (errorMessage) {
    throw new Error(`SSE error: ${errorMessage}`)
  }
  if (!doneConversationId) {
    throw new Error('Did not receive done event')
  }

  return { text, doneConversationId }
}

function extractJsonObject (text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const withoutFences = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()

  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  try {
    const parsed = JSON.parse(withoutFences.slice(start, end + 1)) as unknown
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

async function waitForPersistedRun (coordinatorSessionId: string): Promise<{
  readonly assistantContent: string
  readonly toolCalls: unknown | null
  readonly toolResults: unknown | null
}> {
  const maxAttempts = 15
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    console.log(`[waitForPersistedRun] attempt ${attempt + 1}/${maxAttempts}`)
    const messages = await getMessagesByCoordinatorSessionId(
      coordinatorSessionId
    )
    console.log(
      `[waitForPersistedRun] messages count: ${
        messages.length
      }, roles: [${messages.map(m => m.role).join(', ')}]`
    )
    const assistantWithContent = messages.find(
      m => m.role === 'assistant' && m.content.trim().length > 0
    )
    const assistantWithToolCalls = messages.find(
      m =>
        m.role === 'assistant' &&
        m.toolCalls !== null &&
        typeof m.toolCalls !== 'undefined'
    )
    const toolMessage = messages.find(
      m =>
        m.role === 'tool' &&
        m.toolResults !== null &&
        typeof m.toolResults !== 'undefined'
    )

    console.log(
      `[waitForPersistedRun] found: content=${!!assistantWithContent}, toolCalls=${!!assistantWithToolCalls}, toolMsg=${!!toolMessage}`
    )
    if (assistantWithContent && assistantWithToolCalls && toolMessage) {
      console.log('[waitForPersistedRun] all persisted, returning')
      return {
        assistantContent: assistantWithContent.content,
        toolCalls: assistantWithToolCalls.toolCalls ?? null,
        toolResults: toolMessage.toolResults ?? null
      }
    }
    await Bun.sleep(200)
  }
  throw new Error('Timed out waiting for assistant message to persist')
}

describe('Agent chat (integration, SSE)', () => {
  let server: ServerInfo
  const createdCoordinatorSessionIds: string[] = []

  beforeAll(async () => {
    process.env.COORDINATOR_AGENT_MODEL ??= 'gpt-5-nano'
    server = await startServer()
  })

  afterAll(async () => {
    for (const id of createdCoordinatorSessionIds) {
      await deleteCoordinatorSession(id)
    }
    server.stop()
  })

  it('streams SSE and can call GET /users/me from the prompt', async () => {
    console.log('\n=== TEST: streams SSE and can call GET /users/me ===')
    const runId = crypto.randomUUID()
    const email = `agent-chat-${runId}@company.com`
    const { userId, accessToken } = await registerUser(server.baseUrl, {
      name: 'Chat User',
      email,
      password: 'password123'
    })

    const coordinatorSessionId = await createCoordinatorSessionViaApi(
      server.baseUrl,
      accessToken
    )
    createdCoordinatorSessionIds.push(coordinatorSessionId)

    console.log('[test1] sending POST /coordinator/session/:id/runs')
    const started = await startCoordinatorRunViaApi({
      baseUrl: server.baseUrl,
      accessToken,
      coordinatorSessionId,
      message:
        'Call the API tool for GET /users/me. Then reply with only JSON containing exactly the tool output: {"id":"...","email":"...","name":"..."}'
    })

    console.log('[test1] opening stream:', started.streamPath)
    const res = await jsonFetch(server.baseUrl, started.streamPath, {
      method: 'GET',
      token: accessToken
    })

    console.log('[test1] response status:', res.status)
    console.log('[test1] content-type:', res.headers.get('content-type'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')?.includes('text/event-stream')).toBe(
      true
    )

    const { text, doneConversationId } = await readSse(res)

    console.log('text', text)
    expect(doneConversationId).toBe(coordinatorSessionId)
    console.log('[test1] waiting for persisted run...')
    const persisted = await waitForPersistedRun(doneConversationId)
    console.log(
      '[test1] persisted assistantContent:',
      persisted.assistantContent
    )
    console.log(
      '[test1] persisted toolCalls:',
      JSON.stringify(persisted.toolCalls)
    )
    console.log(
      '[test1] persisted toolResults:',
      JSON.stringify(persisted.toolResults)
    )

    const candidateText =
      text.trim().length > 0 ? text : persisted.assistantContent

    console.log('[test1] candidateText:', candidateText)
    expect(candidateText.trim().length).toBeGreaterThan(0)
    expect(candidateText).toContain(email)
    expect(candidateText).toContain(userId)

    expect(Array.isArray(persisted.toolCalls)).toBe(true)
    expect(Array.isArray(persisted.toolResults)).toBe(true)

    const json = extractJsonObject(candidateText)
    console.log('[test1] extracted JSON:', JSON.stringify(json))
    expect(json?.id).toBe(userId)
    expect(json?.email).toBe(email)
    expect(typeof json?.name).toBe('string')
    console.log('=== TEST 1 PASSED ===')
  }, 20_000)

  it('keeps running after disconnect and can resume via /coordinator/runs/:runId/stream', async () => {
    console.log('\n=== TEST: keeps running after disconnect ===')
    const runId = crypto.randomUUID()
    const email = `agent-chat-resume-${runId}@company.com`
    const { userId, accessToken } = await registerUser(server.baseUrl, {
      name: 'Chat User',
      email,
      password: 'password123'
    })

    const coordinatorSessionId = await createCoordinatorSessionViaApi(
      server.baseUrl,
      accessToken
    )
    createdCoordinatorSessionIds.push(coordinatorSessionId)
    const started = await startCoordinatorRunViaApi({
      baseUrl: server.baseUrl,
      accessToken,
      coordinatorSessionId,
      message:
        'Call the API tool for GET /users/me. Then reply with only JSON containing exactly the tool output: {"id":"...","email":"...","name":"..."}'
    })
    const agentRunId = started.runId
    console.log(
      '[test2] coordinatorSessionId:',
      coordinatorSessionId,
      'agentRunId:',
      agentRunId
    )

    // Simulate a refresh/disconnect: cancel the SSE read early.
    console.log('[test2] cancelling SSE stream (simulating disconnect)')
    const res = await jsonFetch(server.baseUrl, started.streamPath, {
      method: 'GET',
      token: accessToken
    })
    await res.body?.cancel()

    console.log(
      '[test2] resuming via GET /coordinator/runs/' + agentRunId + '/stream'
    )
    const resumeRes = await jsonFetch(
      server.baseUrl,
      `/coordinator/runs/${agentRunId}/stream`,
      { method: 'GET', token: accessToken }
    )
    console.log('[test2] resume status:', resumeRes.status)
    console.log(
      '[test2] resume content-type:',
      resumeRes.headers.get('content-type')
    )
    expect(resumeRes.status).toBe(200)
    expect(
      resumeRes.headers.get('content-type')?.includes('text/event-stream')
    ).toBe(true)

    const { text, doneConversationId } = await readSse(resumeRes)
    console.log('[test2] resumed text:', text)
    expect(doneConversationId).toBe(coordinatorSessionId)

    console.log('[test2] waiting for persisted run...')
    const persisted = await waitForPersistedRun(doneConversationId)
    const candidateText =
      text.trim().length > 0 ? text : persisted.assistantContent
    console.log('[test2] candidateText:', candidateText)

    expect(candidateText).toContain(email)
    expect(candidateText).toContain(userId)
    console.log('=== TEST 2 PASSED ===')
  }, 20_000)
})
