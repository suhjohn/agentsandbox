import '../setup.test'
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { app } from '../../src/app'
import {
  addMessage,
  deleteCoordinatorSession,
  getCoordinatorSessionById,
} from '../../src/services/coordinator-session.service'

type ServerInfo = {
  readonly baseUrl: string
  readonly stop: () => void
}

async function startServer(): Promise<ServerInfo> {
  const server = Bun.serve({
    port: 0,
    fetch: app.fetch,
  })

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  }
}

async function jsonFetch(
  baseUrl: string,
  path: string,
  options: RequestInit & { readonly token?: string } = {},
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
    headers,
  })
}

async function registerUser(baseUrl: string, input: {
  readonly name: string
  readonly email: string
  readonly password: string
}): Promise<{ readonly userId: string; readonly accessToken: string }> {
  const res = await jsonFetch(baseUrl, '/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as {
    user: { id: string }
    accessToken: string
  }
  return { userId: body.user.id, accessToken: body.accessToken }
}

describe('Agent routes (integration)', () => {
  let server: ServerInfo
  const createdCoordinatorSessionIds: string[] = []

  beforeAll(async () => {
    server = await startServer()
  })

  afterAll(async () => {
    for (const id of createdCoordinatorSessionIds) {
      await deleteCoordinatorSession(id)
    }
    server.stop()
  })

  it('lists, reads, updates, and deletes coordinator sessions for the authenticated user', async () => {
    const runId = crypto.randomUUID()
    const { accessToken } = await registerUser(server.baseUrl, {
      name: 'User',
      email: `agent-integ-${runId}@company.com`,
      password: 'password123',
    })

    const createRes = await jsonFetch(server.baseUrl, '/coordinator/session', {
      method: 'POST',
      token: accessToken,
      body: JSON.stringify({ title: 'hello' }),
    })
    expect(createRes.status).toBe(201)
    const coordinatorSession = (await createRes.json()) as {
      id: string
      title: string | null
    }
    createdCoordinatorSessionIds.push(coordinatorSession.id)
    await addMessage({
      coordinatorSessionId: coordinatorSession.id,
      role: 'user',
      content: 'first',
    })
    await addMessage({
      coordinatorSessionId: coordinatorSession.id,
      role: 'assistant',
      content: 'second',
    })

    const listRes = await jsonFetch(server.baseUrl, '/coordinator/session?limit=20', {
      method: 'GET',
      token: accessToken,
    })
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as {
      data: Array<{ id: string; title: string | null }>
      nextCursor: string | null
    }
    expect(listBody.data.some((item) => item.id === coordinatorSession.id)).toBe(true)

    const getRes = await jsonFetch(
      server.baseUrl,
      `/coordinator/session/${coordinatorSession.id}`,
      {
        method: 'GET',
        token: accessToken,
      },
    )
    expect(getRes.status).toBe(200)
    const getBody = (await getRes.json()) as { id: string; title: string | null }
    expect(getBody.id).toBe(coordinatorSession.id)

    const messagesRes = await jsonFetch(
      server.baseUrl,
      `/coordinator/session/${coordinatorSession.id}/messages`,
      { method: 'GET', token: accessToken },
    )
    expect(messagesRes.status).toBe(200)
    const messagesBody = (await messagesRes.json()) as {
      data: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }>
    }
    expect(messagesBody.data.map((message) => message.content)).toEqual(['first', 'second'])

    const patchRes = await jsonFetch(
      server.baseUrl,
      `/coordinator/session/${coordinatorSession.id}`,
      {
        method: 'PATCH',
        token: accessToken,
        body: JSON.stringify({ title: 'renamed' }),
      },
    )
    expect(patchRes.status).toBe(200)
    const patchBody = (await patchRes.json()) as { id: string; title: string | null }
    expect(patchBody.title).toBe('renamed')

    const deleteRes = await jsonFetch(
      server.baseUrl,
      `/coordinator/session/${coordinatorSession.id}`,
      {
        method: 'DELETE',
        token: accessToken,
      },
    )
    expect(deleteRes.status).toBe(200)
    const deleteBody = (await deleteRes.json()) as { ok: boolean }
    expect(deleteBody.ok).toBe(true)

    const existing = await getCoordinatorSessionById(coordinatorSession.id)
    expect(existing).toBeNull()
  })

  it('does not allow a different user to read another user coordinator session', async () => {
    const runId = crypto.randomUUID()
    const owner = await registerUser(server.baseUrl, {
      name: 'Owner',
      email: `agent-owner-${runId}@company.com`,
      password: 'password123',
    })
    const other = await registerUser(server.baseUrl, {
      name: 'Other',
      email: `agent-other-${runId}@company.com`,
      password: 'password123',
    })

    const createRes = await jsonFetch(server.baseUrl, '/coordinator/session', {
      method: 'POST',
      token: owner.accessToken,
      body: JSON.stringify({ title: 'private' }),
    })
    expect(createRes.status).toBe(201)
    const coordinatorSession = (await createRes.json()) as { id: string }
    createdCoordinatorSessionIds.push(coordinatorSession.id)

    const res = await jsonFetch(
      server.baseUrl,
      `/coordinator/session/${coordinatorSession.id}`,
      {
        method: 'GET',
        token: other.accessToken,
      },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Coordinator session not found')
  })

  it('requires auth for coordinator transcription endpoint', async () => {
    const form = new FormData()
    form.set('file', new File(['audio'], 'clip.webm', { type: 'audio/webm' }))

    const res = await fetch(`${server.baseUrl}/coordinator/transcription`, {
      method: 'POST',
      body: form,
    })

    expect(res.status).toBe(401)
  })

  it('returns 400 when transcription upload does not include a file', async () => {
    const runId = crypto.randomUUID()
    const { accessToken } = await registerUser(server.baseUrl, {
      name: 'Transcriber',
      email: `agent-transcription-${runId}@company.com`,
      password: 'password123',
    })

    const form = new FormData()
    const res = await fetch(`${server.baseUrl}/coordinator/transcription`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Audio file is required')
  })
})
