import { describe, expect, it, mock } from 'bun:test'
import { createCoordinatorApiRequestTool } from './index'

type ExecutableTool = {
  execute: (input: unknown) => Promise<unknown>
}

function createJsonResponse (body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('createCoordinatorApiRequestTool', () => {
  it('accepts absolute runtime URLs and does not auto-attach manager authorization', async () => {
    const fetchMock = mock(
      async (input: unknown, init?: RequestInit): Promise<Response> => {
        const url = String(input)
        expect(url).toBe('https://runtime.example.com/session')

        const headers = new Headers(init?.headers)
        expect(headers.get('X-Agent-Auth')).toBe('Bearer runtime-token')
        expect(headers.get('Authorization')).toBeNull()
        expect(init?.method).toBe('POST')

        return createJsonResponse({ ok: true })
      }
    )

    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch

    try {
      const runtimeTool = createCoordinatorApiRequestTool({
        baseUrl: 'http://localhost:3132',
        userAuthHeader: 'Bearer manager-user-token'
      }) as unknown as ExecutableTool

      await runtimeTool.execute({
        method: 'POST',
        path: 'https://runtime.example.com/session',
        headers: {
          'X-Agent-Auth': 'Bearer runtime-token'
        },
        json: { id: '019cc2615b2c71d5842adcbe906f9a07' }
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('auto-attaches manager authorization for same-origin manager requests', async () => {
    const fetchMock = mock(
      async (_input: unknown, init?: RequestInit): Promise<Response> => {
        const headers = new Headers(init?.headers)
        expect(headers.get('Authorization')).toBe('Bearer manager-user-token')
        expect(headers.get('X-Agent-Auth')).toBeNull()

        return createJsonResponse({ data: [] })
      }
    )

    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch

    try {
      const managerTool = createCoordinatorApiRequestTool({
        baseUrl: 'http://localhost:3132',
        userAuthHeader: 'Bearer manager-user-token'
      }) as unknown as ExecutableTool

      await managerTool.execute({
        method: 'GET',
        path: '/agents',
        query: { limit: 10 }
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
