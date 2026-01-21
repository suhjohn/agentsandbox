import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient
} from '@tanstack/react-query'
import { Textarea } from '@/components/ui/textarea'
import { Loader, SandboxLoader } from '@/components/loader'
import { toast } from 'sonner'
import {
  useGetAgentsAgentId,
  useGetAgentsAgentIdAccess,
  putSessionId,
  type GetAgentsAgentIdAccess200
} from '@/api/generated/agent-manager'
import {
  getSessionId,
  postSession,
  postSessionIdMessage,
  postSessionIdStop,
  type GetSessionId200,
  type GetSessionId200MessagesItem,
  type PostSession201
} from '@/api/generated/agent'
import {
  CodexMessages,
  isCodexMessageBody
} from '@/components/messages/codex-message'
import {
  PiMessages,
  isPiMessageBody,
  parsePiStreamEvent
} from '@/components/messages/pi-message'
import type { PanelProps } from './types'
import { parseBody as parseBodyUtil } from './session-message-utils'

export interface AgentSessionPanelConfig {
  readonly agentId: string
  readonly agentName?: string
  readonly sessionId: string
  readonly sessionTitle?: string
}

type StreamPhase = 'idle' | 'connecting' | 'connected'

type StreamState = {
  readonly phase: StreamPhase
  readonly messages: readonly GetSessionId200MessagesItem[]
  readonly isRunning: boolean | null
  readonly error: string | null
}

const INITIAL_STREAM_STATE: StreamState = {
  phase: 'idle',
  messages: [],
  isRunning: null,
  error: null
}

const SESSION_STREAM_IDLE_CLOSE_MS = 60_000
const WORKSPACE_DIFF_REFRESH_DEBOUNCE_MS = 350
const OPTIMISTIC_ECHO_CLOCK_SKEW_MS = 30_000
const STICKY_SCROLL_BOTTOM_THRESHOLD_PX = 120
const SESSION_STATUS_PROCESSING = 'processing'
const SESSION_STATUS_INITIAL = 'initial'

type SessionStreamConfig = {
  readonly agentId: string
  readonly sessionId: string
  readonly agentApiUrl: string
  readonly agentAuthToken: string
}

type SessionStreamConnection = {
  readonly key: string
  config: SessionStreamConfig
  listeners: Set<(state: StreamState) => void>
  state: StreamState
  refCount: number
  closeTimer: number | null
  controller: AbortController | null
  running: Promise<void> | null
  streamCounter: number
}

const sessionStreamConnections = new Map<string, SessionStreamConnection>()

export function getSessionMessages (
  agentId: string,
  sessionId: string,
  agentApiUrl: string
): readonly GetSessionId200MessagesItem[] {
  const key = `${agentApiUrl}|${agentId}|${sessionId}`
  const connection = sessionStreamConnections.get(key)
  return connection?.state.messages ?? []
}

function makeSessionStreamKey (config: SessionStreamConfig): string {
  // Token rotation should not create a brand-new stream identity.
  return `${config.agentApiUrl}|${config.agentId}|${config.sessionId}`
}

function parseSseChunk (
  raw: string
): { readonly eventType: string; readonly data: string } | null {
  let eventType = 'message'
  const dataLines: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      eventType = line.slice('event:'.length).trim() || 'message'
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }
  if (dataLines.length === 0) return null
  return { eventType, data: dataLines.join('\n') }
}

function isCodexFileChangePayload (payload: unknown): boolean {
  if (!isRecord(payload)) return false
  const event = isRecord(payload.body) ? payload.body : payload
  if (!isRecord(event)) return false
  const item = event.item
  if (!isRecord(item)) return false
  return item.type === 'file_change'
}

function emitSessionState (connection: SessionStreamConnection): void {
  for (const listener of connection.listeners) {
    listener(connection.state)
  }
}

function setSessionState (
  connection: SessionStreamConnection,
  updater: (prev: StreamState) => StreamState
): void {
  const next = updater(connection.state)
  if (next === connection.state) return
  connection.state = next
  emitSessionState(connection)
}

function ensureSessionStreamRunning (connection: SessionStreamConnection): void {
  if (connection.running) return

  connection.running = (async () => {
    const retryDelaysMs = [500, 1000, 2000]
    let diffRefreshTimer: number | null = null
    const scheduleWorkspaceDiffRefresh = () => {
      if (diffRefreshTimer !== null) {
        window.clearTimeout(diffRefreshTimer)
      }
      diffRefreshTimer = window.setTimeout(() => {
        diffRefreshTimer = null
        window.dispatchEvent(new Event('workspace-diff:refresh'))
      }, WORKSPACE_DIFF_REFRESH_DEBOUNCE_MS)
    }

    setSessionState(connection, prev => ({
      ...prev,
      phase: 'connecting',
      error: null
    }))

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController()
      connection.controller = controller

      try {
        const response = await fetch(
          `${connection.config.agentApiUrl}/session/${connection.config.sessionId}/stream`,
          {
            method: 'GET',
            headers: {
              Accept: 'text/event-stream',
              'X-Agent-Auth': `Bearer ${connection.config.agentAuthToken}`
            },
            signal: controller.signal
          }
        )

        if (!response.ok || !response.body) {
          throw new Error(
            `Stream failed (${response.status} ${response.statusText})`
          )
        }

        setSessionState(connection, prev => ({ ...prev, phase: 'connected' }))

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (controller.signal.aborted) return

          buffer += decoder.decode(value, { stream: true })
          let idx = buffer.indexOf('\n\n')
          while (idx !== -1) {
            const raw = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            const chunk = parseSseChunk(raw)
            if (chunk) {
              const payload = parseBodyUtil(chunk.data)
              if (
                chunk.eventType === 'ping' ||
                chunk.eventType === 'connected'
              ) {
                idx = buffer.indexOf('\n\n')
                continue
              }
              if (chunk.eventType === 'status') {
                if (
                  typeof payload === 'object' &&
                  payload !== null &&
                  'isRunning' in payload
                ) {
                  const next = (payload as { isRunning?: unknown }).isRunning
                  if (typeof next === 'boolean') {
                    setSessionState(connection, prev => ({
                      ...prev,
                      isRunning: next
                    }))
                  }
                }
                idx = buffer.indexOf('\n\n')
                continue
              }
              if (chunk.eventType === 'stopped') {
                setSessionState(connection, prev => ({
                  ...prev,
                  isRunning: false
                }))
                idx = buffer.indexOf('\n\n')
                continue
              }

              if (isSessionMessage(payload)) {
                if (isCodexFileChangePayload(payload.body)) {
                  scheduleWorkspaceDiffRefresh()
                }
                setSessionState(connection, prev => {
                  const existingIdx = prev.messages.findIndex(
                    m => m.id === payload.id
                  )
                  if (existingIdx < 0) {
                    return { ...prev, messages: [...prev.messages, payload] }
                  }
                  const nextMessages = [...prev.messages]
                  nextMessages[existingIdx] = payload
                  return { ...prev, messages: nextMessages }
                })
                idx = buffer.indexOf('\n\n')
                continue
              }

              connection.streamCounter += 1
              if (isCodexFileChangePayload(payload)) {
                scheduleWorkspaceDiffRefresh()
              }
              const streamMessage: GetSessionId200MessagesItem = {
                id: `sse:${connection.config.sessionId}:${connection.streamCounter}`,
                agentId: connection.config.agentId,
                sessionId: connection.config.sessionId,
                turnId: null,
                createdBy: null,
                embeddings: null,
                createdAt: new Date().toISOString(),
                body: payload
              }
              setSessionState(connection, prev => ({
                ...prev,
                messages: [...prev.messages, streamMessage]
              }))
            }
            idx = buffer.indexOf('\n\n')
          }
        }

        if (controller.signal.aborted) return
        throw new Error('Stream disconnected.')
      } catch (err) {
        if (controller.signal.aborted) return
        const isLastAttempt = attempt === 2
        if (isLastAttempt) {
          setSessionState(connection, prev => ({
            ...prev,
            phase: 'idle',
            isRunning: null,
            error: toErrorMessage(err)
          }))
          return
        }
        setSessionState(connection, prev => ({
          ...prev,
          phase: 'connecting',
          error: null
        }))
        await new Promise(resolve =>
          setTimeout(resolve, retryDelaysMs[attempt] ?? 1000)
        )
      }
    }
    if (diffRefreshTimer !== null) {
      window.clearTimeout(diffRefreshTimer)
      window.dispatchEvent(new Event('workspace-diff:refresh'))
    }
  })().finally(() => {
    connection.controller = null
    connection.running = null
  })
}

function retainSessionStreamConnection (
  config: SessionStreamConfig
): SessionStreamConnection {
  const key = makeSessionStreamKey(config)
  let connection = sessionStreamConnections.get(key) ?? null
  if (!connection) {
    connection = {
      key,
      config,
      listeners: new Set(),
      state: INITIAL_STREAM_STATE,
      refCount: 0,
      closeTimer: null,
      controller: null,
      running: null,
      streamCounter: 0
    }
    sessionStreamConnections.set(key, connection)
  } else {
    connection.config = config
  }

  connection.refCount += 1
  if (connection.closeTimer !== null) {
    window.clearTimeout(connection.closeTimer)
    connection.closeTimer = null
  }
  ensureSessionStreamRunning(connection)
  return connection
}

function releaseSessionStreamConnection (
  connection: SessionStreamConnection
): void {
  connection.refCount = Math.max(0, connection.refCount - 1)
  if (connection.refCount > 0) return
  if (connection.closeTimer !== null) return

  connection.closeTimer = window.setTimeout(() => {
    connection.closeTimer = null
    if (connection.refCount > 0) return
    connection.controller?.abort()
    connection.listeners.clear()
    sessionStreamConnections.delete(connection.key)
  }, SESSION_STREAM_IDLE_CLOSE_MS)
}

function subscribeSessionStream (
  connection: SessionStreamConnection,
  listener: (state: StreamState) => void
): () => void {
  connection.listeners.add(listener)
  listener(connection.state)
  return () => {
    connection.listeners.delete(listener)
  }
}

function unwrapAccess (value: unknown): GetAgentsAgentIdAccess200 | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.data === 'object' && v.data !== null) {
    const d = v.data as Record<string, unknown>
    if (
      typeof d.agentApiUrl === 'string' &&
      typeof d.agentAuthToken === 'string'
    ) {
      return d as GetAgentsAgentIdAccess200
    }
  }
  if (
    typeof v.agentApiUrl === 'string' &&
    typeof v.agentAuthToken === 'string'
  ) {
    return v as GetAgentsAgentIdAccess200
  }
  return null
}

function unwrapCreatedSession (value: unknown): PostSession201 | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.data === 'object' && v.data !== null) {
    const d = v.data as Record<string, unknown>
    if (typeof d.id === 'string' && typeof d.agentId === 'string')
      return d as PostSession201
  }
  if (typeof v.id === 'string' && typeof v.agentId === 'string')
    return v as PostSession201
  return null
}

function unwrapSession (value: unknown): GetSessionId200 | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.data === 'object' && v.data !== null) {
    const d = v.data as Record<string, unknown>
    if (
      typeof d.id === 'string' &&
      typeof d.agentId === 'string' &&
      Array.isArray(d.messages)
    ) {
      return d as GetSessionId200
    }
  }
  if (
    typeof v.id === 'string' &&
    typeof v.agentId === 'string' &&
    Array.isArray((v as { messages?: unknown }).messages)
  ) {
    return v as GetSessionId200
  }
  return null
}

function toErrorMessage (value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'object' && value !== null && 'error' in value) {
    const err = (value as { error?: unknown }).error
    if (typeof err === 'string' && err.trim().length > 0) return err
  }
  if (typeof value === 'string' && value.trim().length > 0) return value
  return 'Something went wrong.'
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSessionMessage (
  value: unknown
): value is GetSessionId200MessagesItem {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.agentId === 'string' &&
    typeof record.sessionId === 'string' &&
    'createdAt' in record
  )
}

function parseBody (raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  const trimmed = raw.trim()
  if (trimmed.length === 0) return raw
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return raw
  }
}

// Keep side-panel previews aligned with agent DB `last_message_body` semantics.
function isLastMessageBodyCandidate (body: unknown): boolean {
  const parsed = parseBody(body)
  if (!isRecord(parsed)) return false
  const type = parsed.type

  if (
    type === 'user_input' ||
    type === 'assistant_action' ||
    type === 'assistant_response' ||
    type === 'assistant_output'
  ) {
    return true
  }

  if (type === 'item.completed') {
    const item = parsed.item
    if (!isRecord(item)) return false
    return item.type === 'agent_message'
  }

  if (type === 'message_end') {
    const message = parsed.message
    if (!isRecord(message)) return false
    return message.role === 'user' || message.role === 'assistant'
  }

  return false
}

function findLatestLastMessageBodyCandidate (
  messages: readonly GetSessionId200MessagesItem[]
): GetSessionId200MessagesItem | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message) continue
    if (!isLastMessageBodyCandidate(message.body)) continue
    return message
  }
  return null
}

function extractSessionTitleText (body: unknown): string | null {
  const parsed = parseBody(body)
  if (!isRecord(parsed) || parsed.type !== 'user_input') return null

  const content = parsed.content
  if (typeof content === 'string' && content.trim().length > 0) {
    return content.trim()
  }

  const input = parsed.input
  if (!Array.isArray(input)) return null

  const parts: string[] = []
  for (const entry of input) {
    if (!isRecord(entry)) continue
    if (entry.type !== 'text') continue
    const text = entry.text
    if (typeof text === 'string' && text.trim().length > 0) {
      parts.push(text.trim())
    }
  }

  const combined = parts.join('\n').trim()
  return combined.length > 0 ? combined : null
}

function deriveSessionTitleFromText (text: string): string | null {
  const line = text
    .split(/\r?\n/g)
    .map(l => l.trim())
    .find(l => l.length > 0)
  if (!line) return null

  const words = line.replace(/\s+/g, ' ').trim().split(' ')
  const title = words.slice(0, 6).join(' ').trim()
  if (title.length === 0) return null
  return title.length > 80 ? `${title.slice(0, 77)}…` : title
}

function normalizeMessageText (value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function extractPiUserMessageText (message: unknown): string | null {
  if (!isRecord(message)) return null
  if (message.role !== 'user') return null

  const content = message.content
  if (typeof content === 'string' && content.trim().length > 0) {
    return content.trim()
  }
  if (!Array.isArray(content)) return null

  const parts: string[] = []
  for (const item of content) {
    if (!isRecord(item)) continue
    if (item.type !== 'text') continue
    const text = item.text
    if (typeof text === 'string' && text.trim().length > 0) {
      parts.push(text.trim())
    }
  }

  const combined = parts.join('\n').trim()
  return combined.length > 0 ? combined : null
}

function extractUserMessageText (body: unknown): string | null {
  const parsed = parseBody(body)
  if (typeof parsed === 'string' && parsed.trim().length > 0) {
    return parsed.trim()
  }
  if (!isRecord(parsed)) return null

  if (parsed.type === 'user_input') {
    return extractSessionTitleText(parsed)
  }

  if (parsed.type === 'message_end') {
    return extractPiUserMessageText(parsed.message)
  }

  return null
}

function createOptimisticUserMessage (args: {
  readonly agentId: string
  readonly sessionId: string
  readonly text: string
  readonly messageType: 'codex' | 'pi' | 'unknown'
}): GetSessionId200MessagesItem {
  const nowIso = new Date().toISOString()
  const idSuffix = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  const id = `optimistic:${args.sessionId}:${idSuffix}`

  const body =
    args.messageType === 'pi'
      ? {
          type: 'message_end',
          message: {
            id,
            role: 'user',
            content: [{ type: 'text', text: args.text }]
          }
        }
      : {
          type: 'user_input',
          input: [{ type: 'text', text: args.text }]
        }

  return {
    id,
    agentId: args.agentId,
    sessionId: args.sessionId,
    turnId: null,
    createdBy: null,
    embeddings: null,
    createdAt: nowIso,
    body
  }
}

function findServerEchoForOptimisticMessage (
  serverMessages: readonly GetSessionId200MessagesItem[],
  optimisticMessage: GetSessionId200MessagesItem
): GetSessionId200MessagesItem | null {
  const optimisticText = extractUserMessageText(optimisticMessage.body)
  if (!optimisticText) return null
  const normalizedOptimisticText = normalizeMessageText(optimisticText)
  if (normalizedOptimisticText.length === 0) return null

  const optimisticCreatedAtMs = Date.parse(optimisticMessage.createdAt)
  for (const message of serverMessages) {
    if (message.id === optimisticMessage.id) continue
    const nextText = extractUserMessageText(message.body)
    if (!nextText) continue
    if (normalizeMessageText(nextText) !== normalizedOptimisticText) {
      continue
    }
    if (!Number.isFinite(optimisticCreatedAtMs)) return message
    const nextCreatedAtMs = Date.parse(message.createdAt)
    if (!Number.isFinite(nextCreatedAtMs)) return message
    if (
      nextCreatedAtMs >=
      optimisticCreatedAtMs - OPTIMISTIC_ECHO_CLOCK_SKEW_MS
    ) {
      return message
    }
  }
  return null
}

function resolveDisplayedMessages (args: {
  readonly serverMessages: readonly GetSessionId200MessagesItem[]
  readonly optimisticMessage: GetSessionId200MessagesItem | null
  readonly agentId: string
  readonly sessionId: string
}): {
  readonly messages: readonly GetSessionId200MessagesItem[]
  readonly hasVisibleOptimisticMessage: boolean
} {
  const { serverMessages, optimisticMessage, agentId, sessionId } = args
  if (!optimisticMessage) {
    return { messages: serverMessages, hasVisibleOptimisticMessage: false }
  }

  if (
    optimisticMessage.agentId !== agentId ||
    optimisticMessage.sessionId !== sessionId
  ) {
    return { messages: serverMessages, hasVisibleOptimisticMessage: false }
  }

  const echoed = findServerEchoForOptimisticMessage(
    serverMessages,
    optimisticMessage
  )
  if (!echoed) {
    return {
      messages: [...serverMessages, optimisticMessage],
      hasVisibleOptimisticMessage: true
    }
  }

  return {
    messages: serverMessages.map(message =>
      message.id === echoed.id
        ? { ...message, id: optimisticMessage.id }
        : message
    ),
    hasVisibleOptimisticMessage: false
  }
}

function mergeSessionMessages (
  initialMessages: readonly GetSessionId200MessagesItem[],
  streamMessages: readonly GetSessionId200MessagesItem[]
): readonly GetSessionId200MessagesItem[] {
  if (initialMessages.length === 0) return streamMessages
  if (streamMessages.length === 0) return initialMessages

  const messagesById = new Map<string, GetSessionId200MessagesItem>()
  for (const message of initialMessages) {
    messagesById.set(message.id, message)
  }
  for (const message of streamMessages) {
    messagesById.set(message.id, message)
  }
  return Array.from(messagesById.values())
}

type SessionWorkspacePatch = {
  readonly status?: string
  readonly title?: string | null
  readonly lastMessageBody?: string | null
  readonly updatedAt?: string
}

function patchSessionRecord (
  session: Record<string, unknown>,
  patch: SessionWorkspacePatch
): Record<string, unknown> {
  let next = session
  let changed = false

  if (typeof patch.status === 'string' && next.status !== patch.status) {
    next = { ...next, status: patch.status }
    changed = true
  }
  if ('title' in patch && next.title !== patch.title) {
    next = { ...next, title: patch.title }
    changed = true
  }
  if (
    'lastMessageBody' in patch &&
    next.lastMessageBody !== patch.lastMessageBody
  ) {
    next = { ...next, lastMessageBody: patch.lastMessageBody }
    changed = true
  }
  if (
    typeof patch.updatedAt === 'string' &&
    next.updatedAt !== patch.updatedAt
  ) {
    next = { ...next, updatedAt: patch.updatedAt }
    changed = true
  }

  return changed ? next : session
}

function patchSessionInListPayload (
  value: unknown,
  sessionId: string,
  patch: SessionWorkspacePatch
): unknown {
  if (!isRecord(value) || !Array.isArray(value.data)) return value

  let changed = false
  const nextData = value.data.map(item => {
    if (!isRecord(item)) return item
    if (item.id !== sessionId) return item
    const patched = patchSessionRecord(item, patch)
    if (patched !== item) changed = true
    return patched
  })
  if (!changed) return value
  return { ...value, data: nextData }
}

function getLatestUpdatedAt (
  sessions: readonly unknown[],
  fallback?: unknown
): string | undefined {
  let latestValue: string | undefined
  let latestMs = Number.NEGATIVE_INFINITY

  for (const session of sessions) {
    if (!isRecord(session)) continue
    if (typeof session.updatedAt !== 'string') continue
    const timestamp = Date.parse(session.updatedAt)
    if (!Number.isFinite(timestamp)) continue
    if (timestamp <= latestMs) continue
    latestMs = timestamp
    latestValue = session.updatedAt
  }

  if (typeof latestValue === 'string') return latestValue
  if (typeof fallback === 'string') return fallback
  return undefined
}

function patchSessionInGroupsPayload (
  value: unknown,
  sessionId: string,
  patch: SessionWorkspacePatch
): unknown {
  if (!isRecord(value) || !Array.isArray(value.data)) return value

  let changed = false
  const nextGroups = value.data.map(group => {
    if (!isRecord(group) || !Array.isArray(group.sessions)) return group

    let groupChanged = false
    const nextSessions = group.sessions.map(session => {
      if (!isRecord(session)) return session
      if (session.id !== sessionId) return session
      const patched = patchSessionRecord(session, patch)
      if (patched !== session) groupChanged = true
      return patched
    })
    if (!groupChanged) return group

    const nextGroup: Record<string, unknown> = {
      ...group,
      sessions: nextSessions
    }
    if (typeof patch.updatedAt === 'string') {
      const latestUpdatedAt = getLatestUpdatedAt(
        nextSessions,
        group.latestUpdatedAt
      )
      if (
        typeof latestUpdatedAt === 'string' &&
        nextGroup.latestUpdatedAt !== latestUpdatedAt
      ) {
        nextGroup.latestUpdatedAt = latestUpdatedAt
      }
    }

    changed = true
    return nextGroup
  })

  if (!changed) return value
  return { ...value, data: nextGroups }
}

function applySessionPatchToWorkspaceCaches (
  queryClient: QueryClient,
  sessionId: string,
  patch: SessionWorkspacePatch
): void {
  queryClient.setQueriesData({ queryKey: ['/session'] }, value =>
    patchSessionInListPayload(value, sessionId, patch)
  )
  queryClient.setQueriesData(
    { queryKey: ['workspace', 'session-side-panel', 'sessions'] },
    value => patchSessionInListPayload(value, sessionId, patch)
  )
  queryClient.setQueriesData(
    { queryKey: ['workspace', 'session-side-panel', 'session-groups'] },
    value => patchSessionInGroupsPayload(value, sessionId, patch)
  )
}

function toStoredMessageBody (value: unknown): string | null | undefined {
  if (value == null) return null
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function FallbackMessage (props: {
  readonly message: GetSessionId200MessagesItem
}) {
  const body = parseBody(props.message.body)
  const fallback = (() => {
    if (body == null) return null
    if (typeof body === 'string') return body
    try {
      return JSON.stringify(body, null, 2)
    } catch {
      return null
    }
  })()

  if (!fallback) return null

  return (
    <div className='rounded-lg border border-border bg-background px-3 py-2'>
      <div className='flex items-center gap-2 min-w-0'>
        <div className='text-[11px] px-2 py-0.5 rounded-full border border-border text-text-secondary'>
          message
        </div>
        <div className='flex-1' />
        <div className='text-xs text-text-tertiary font-mono truncate'>
          {props.message.createdAt}
        </div>
      </div>
      <div className='mt-2 text-sm whitespace-pre-wrap break-words'>
        {fallback}
      </div>
    </div>
  )
}

function SessionMessages (props: {
  readonly messages: readonly GetSessionId200MessagesItem[]
  readonly messageType: 'codex' | 'pi' | 'unknown'
}) {
  if (props.messageType === 'codex') {
    return <CodexMessages messages={props.messages} />
  }

  if (props.messageType === 'pi') {
    return <PiMessages messages={props.messages} />
  }

  return (
    <>
      {props.messages.map(m => (
        <FallbackMessage key={m.id} message={m} />
      ))}
    </>
  )
}

function useScrollParent (ref: React.RefObject<HTMLElement | null>) {
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const isScrollableY = (node: HTMLElement): boolean => {
      const overflowY = window.getComputedStyle(node).overflowY
      return (
        overflowY === 'auto' ||
        overflowY === 'scroll' ||
        overflowY === 'overlay'
      )
    }

    let parent: HTMLElement | null = el.parentElement
    while (parent) {
      if (parent.hasAttribute('data-radix-scroll-area-viewport')) break
      if (isScrollableY(parent)) break
      parent = parent.parentElement
    }
    setScrollParent(parent)
  }, [ref])

  return scrollParent
}

function useStickyScroll (
  scrollParent: HTMLElement | null,
  messagesEndRef: React.RefObject<HTMLDivElement | null>,
  depKey: string
) {
  const isAtBottomRef = useRef(false)

  useEffect(() => {
    if (!scrollParent) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollParent
      isAtBottomRef.current =
        scrollHeight - scrollTop - clientHeight <
        STICKY_SCROLL_BOTTOM_THRESHOLD_PX
    }

    handleScroll()
    scrollParent.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollParent.removeEventListener('scroll', handleScroll)
  }, [scrollParent])

  useLayoutEffect(() => {
    if (!scrollParent) return
    // Avoid defaulting to "at bottom" on mount (e.g. when split/stack reshapes layout).
    const { scrollTop, scrollHeight, clientHeight } = scrollParent
    isAtBottomRef.current =
      scrollHeight - scrollTop - clientHeight <
      STICKY_SCROLL_BOTTOM_THRESHOLD_PX
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [depKey, messagesEndRef, scrollParent])
}

function SessionComposer (props: {
  readonly agentId: string
  readonly sessionId: string
  readonly access: GetAgentsAgentIdAccess200
  readonly setConfig: PanelProps<AgentSessionPanelConfig>['setConfig']
  readonly isSendingOptimistic: boolean
  readonly messageType: 'codex' | 'pi' | 'unknown'
  readonly onOptimisticMessageChange: (
    message: GetSessionId200MessagesItem | null
  ) => void
  readonly onOptimisticSendingChange: (isSending: boolean) => void
  readonly inputRef: { current: HTMLTextAreaElement | null }
}) {
  const queryClient = useQueryClient()

  const [draft, setDraft] = useState('')

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      if (!props.access?.agentApiUrl || !props.access.agentAuthToken) {
        throw new Error('Missing agent runtime access')
      }
      return await postSession({}, {
        baseUrl: props.access.agentApiUrl,
        agentAuthToken: props.access.agentAuthToken
      } as unknown as RequestInit)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['agentRuntime', props.agentId, 'sessions']
      })
    }
  })

  const sendMutation = useMutation({
    mutationFn: async (args: {
      readonly sessionId: string
      readonly text: string
    }) => {
      if (!props.access?.agentApiUrl || !props.access.agentAuthToken) {
        throw new Error('Missing agent runtime access')
      }
      return await postSessionIdMessage(
        args.sessionId,
        { input: [{ type: 'text', text: args.text }] },
        {
          baseUrl: props.access.agentApiUrl,
          agentAuthToken: props.access.agentAuthToken
        } as unknown as RequestInit
      )
    }
  })

  async function ensureSessionId (): Promise<string> {
    if (props.sessionId.length > 0) return props.sessionId
    const created = unwrapCreatedSession(
      await createSessionMutation.mutateAsync()
    )
    if (!created) throw new Error('Unexpected response shape (createSession).')
    props.setConfig(prev => ({
      ...prev,
      sessionId: created.id,
      sessionTitle: created.title?.trim() || ''
    }))
    return created.id
  }

  async function handleSend (): Promise<void> {
    const text = draft.trim()
    if (text.length === 0) return

    setDraft('')
    props.onOptimisticSendingChange(true)

    try {
      const nextSessionId = await ensureSessionId()
      const optimisticMessage = createOptimisticUserMessage({
        agentId: props.agentId,
        sessionId: nextSessionId,
        text,
        messageType: props.messageType
      })
      applySessionPatchToWorkspaceCaches(queryClient, nextSessionId, {
        status: SESSION_STATUS_PROCESSING,
        updatedAt: optimisticMessage.createdAt,
        lastMessageBody: toStoredMessageBody(optimisticMessage.body)
      })
      props.onOptimisticMessageChange(optimisticMessage)
      await sendMutation.mutateAsync({ sessionId: nextSessionId, text })
    } catch (err) {
      props.onOptimisticMessageChange(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/session'] }),
        queryClient.invalidateQueries({
          queryKey: ['workspace', 'session-side-panel', 'sessions']
        }),
        queryClient.invalidateQueries({
          queryKey: ['workspace', 'session-side-panel', 'session-groups']
        })
      ])
      setDraft(text)
      toast.error(toErrorMessage(err))
    } finally {
      props.onOptimisticSendingChange(false)
    }
  }

  const composerDisabled =
    props.isSendingOptimistic ||
    sendMutation.isPending ||
    createSessionMutation.isPending

  return (
    <div className='space-y-2'>
      <div className='bg-background'>
        <Textarea
          data-agent-session-composer-input='true'
          ref={props.inputRef}
          rows={2}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (!composerDisabled) void handleSend()
            }
          }}
          placeholder='Message…'
          disabled={composerDisabled}
          className='resize-none bg-transparent border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 px-4 py-3 text-sm'
        />
      </div>
    </div>
  )
}

export function AgentSessionPanel (props: PanelProps<AgentSessionPanelConfig>) {
  const queryClient = useQueryClient()
  const agentId =
    typeof props.config.agentId === 'string' ? props.config.agentId.trim() : ''
  const sessionId =
    typeof props.config.sessionId === 'string'
      ? props.config.sessionId.trim()
      : ''

  const agentQuery = useGetAgentsAgentId(agentId, {
    query: { enabled: agentId.length > 0 }
  })
  const accessQuery = useGetAgentsAgentIdAccess(agentId, {
    query: {
      enabled: agentId.length > 0,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: false
    }
  })

  const access = unwrapAccess(accessQuery.data)
  const sessionQuery = useQuery({
    queryKey: [
      'agentRuntime',
      agentId,
      'session',
      sessionId,
      access?.agentApiUrl ?? null
    ],
    enabled: Boolean(
      access?.agentApiUrl && access?.agentAuthToken && sessionId.length > 0
    ),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async ({ signal }) => {
      if (
        !access?.agentApiUrl ||
        !access.agentAuthToken ||
        sessionId.length === 0
      ) {
        throw new Error('Missing session runtime access')
      }
      const response = await getSessionId(sessionId, {
        signal,
        baseUrl: access.agentApiUrl,
        agentAuthToken: access.agentAuthToken
      } as unknown as RequestInit)
      const session = unwrapSession(response)
      if (!session) throw new Error('Unexpected response shape (getSessionId).')
      return session
    }
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollParent = useScrollParent(containerRef)

  const [stream, setStream] = useState<StreamState>(INITIAL_STREAM_STATE)
  const [optimisticMessage, setOptimisticMessage] =
    useState<GetSessionId200MessagesItem | null>(null)
  const [isOptimisticSending, setIsOptimisticSending] = useState(false)
  const streamConnectionRef = useRef<SessionStreamConnection | null>(null)
  const prevIsRunningRef = useRef<boolean | null>(null)
  const initialMessages = sessionQuery.data?.messages ?? []
  const mergedMessages = useMemo(
    () => mergeSessionMessages(initialMessages, stream.messages),
    [initialMessages, stream.messages]
  )
  const messageType = useMemo((): 'codex' | 'pi' | 'unknown' => {
    const harness = sessionQuery.data?.harness?.trim().toLowerCase()
    if (harness === 'codex') return 'codex'
    if (harness === 'pi') return 'pi'
    return 'unknown'
  }, [sessionQuery.data?.harness])
  const displayedMessages = useMemo(
    () =>
      resolveDisplayedMessages({
        serverMessages: mergedMessages,
        optimisticMessage,
        agentId,
        sessionId
      }),
    [agentId, mergedMessages, optimisticMessage, sessionId]
  )
  const { messages, hasVisibleOptimisticMessage } = displayedMessages
  const sessionTitle = useMemo(() => {
    const configTitle = props.config.sessionTitle?.trim() ?? ''
    if (configTitle.length > 0) return configTitle
    const fetchedTitle = sessionQuery.data?.title?.trim() ?? ''
    if (fetchedTitle.length > 0) return fetchedTitle

    for (const message of messages) {
      const text = extractSessionTitleText(message.body)
      if (!text) continue
      const derivedTitle = deriveSessionTitleFromText(text)
      if (!derivedTitle) continue
      return derivedTitle
    }
    return ''
  }, [messages, props.config.sessionTitle, sessionQuery.data?.title])
  const stickyScrollDepKey = useMemo(() => {
    if (messages.length === 0) return '0'
    const last = messages[messages.length - 1]
    return `${messages.length}:${last?.id ?? ''}:${last?.createdAt ?? ''}`
  }, [messages])

  useStickyScroll(scrollParent, messagesEndRef, stickyScrollDepKey)

  const resetSessionStatusMutation = useMutation({
    mutationFn: async (args: {
      readonly sessionId: string
      readonly agentId: string
      readonly harness: string
    }) => {
      await putSessionId(args.sessionId, {
        agentId: args.agentId,
        status: 'initial',
        harness: args.harness
      })
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: ['/session'] })
      await queryClient.invalidateQueries({
        queryKey: ['workspace', 'session-side-panel', 'sessions']
      })
      await queryClient.invalidateQueries({
        queryKey: ['workspace', 'session-side-panel', 'session-groups']
      })
    }
  })

  useEffect(() => {
    const prev = prevIsRunningRef.current
    prevIsRunningRef.current = stream.isRunning

    const runJustEnded = prev === true && stream.isRunning === false
    if (!runJustEnded) return
    if (!agentId || !sessionId) return

    const latestMessage = stream.messages[stream.messages.length - 1] ?? null
    const latestUpdatedAt =
      typeof latestMessage?.createdAt === 'string' &&
      Number.isFinite(Date.parse(latestMessage.createdAt))
        ? latestMessage.createdAt
        : sessionQuery.data?.updatedAt
    const sessionTitleValue = sessionTitle.trim()
    const latestLastMessage = findLatestLastMessageBodyCandidate(
      stream.messages
    )
    const lastMessageBody = latestLastMessage
      ? toStoredMessageBody(latestLastMessage.body)
      : undefined
    const patch: SessionWorkspacePatch = {
      status: SESSION_STATUS_INITIAL,
      updatedAt: latestUpdatedAt,
      ...(typeof lastMessageBody !== 'undefined' ? { lastMessageBody } : {}),
      ...(sessionTitleValue.length > 0 ? { title: sessionTitleValue } : {})
    }
    applySessionPatchToWorkspaceCaches(queryClient, sessionId, patch)

    const harness = sessionQuery.data?.harness?.trim()
    if (!harness || resetSessionStatusMutation.isPending) return

    resetSessionStatusMutation.mutate({
      sessionId,
      agentId,
      harness
    })
  }, [
    agentId,
    queryClient,
    resetSessionStatusMutation,
    sessionId,
    sessionQuery.data?.harness,
    sessionQuery.data?.updatedAt,
    stream.messages,
    stream.isRunning,
    props.config.sessionTitle
  ])

  const stopRun = useCallback(async (): Promise<void> => {
    if (!access?.agentApiUrl || !access.agentAuthToken) {
      const next = (prev: StreamState) => ({
        ...prev,
        error: 'Missing agent runtime access'
      })
      setStream(next)
      const connection = streamConnectionRef.current
      if (connection) setSessionState(connection, next)
      return
    }
    if (!sessionId) return

    try {
      await postSessionIdStop(sessionId, {
        baseUrl: access.agentApiUrl,
        agentAuthToken: access.agentAuthToken
      } as unknown as RequestInit)
      const next = (prev: StreamState) => ({ ...prev, isRunning: false })
      setStream(next)
      const connection = streamConnectionRef.current
      if (connection) setSessionState(connection, next)
    } catch (err) {
      const next = (prev: StreamState) => ({
        ...prev,
        error: toErrorMessage(err)
      })
      setStream(next)
      const connection = streamConnectionRef.current
      if (connection) setSessionState(connection, next)
    }
  }, [access?.agentApiUrl, access?.agentAuthToken, sessionId])

  useEffect(() => {
    const handler = () => {
      if (stream.isRunning !== true) return
      void stopRun()
    }
    window.addEventListener('agent-manager-web:cancel-stream', handler)
    return () =>
      window.removeEventListener('agent-manager-web:cancel-stream', handler)
  }, [stopRun, stream.isRunning])

  useEffect(() => {
    streamConnectionRef.current = null
    if (!access?.agentApiUrl || !access.agentAuthToken || !sessionId) {
      setStream(INITIAL_STREAM_STATE)
      return
    }
    if (!sessionQuery.isFetched) {
      setStream(INITIAL_STREAM_STATE)
      return
    }

    const connection = retainSessionStreamConnection({
      agentId,
      sessionId,
      agentApiUrl: access.agentApiUrl,
      agentAuthToken: access.agentAuthToken
    })
    streamConnectionRef.current = connection

    const unsubscribe = subscribeSessionStream(connection, next => {
      setStream(next)
    })

    return () => {
      unsubscribe()
      if (streamConnectionRef.current === connection) {
        streamConnectionRef.current = null
      }
      releaseSessionStreamConnection(connection)
    }
  }, [
    access?.agentApiUrl,
    access?.agentAuthToken,
    agentId,
    sessionId,
    sessionQuery.isFetched
  ])

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className={
        accessQuery.isLoading
          ? 'h-full min-h-0 outline-none focus:outline-none focus-visible:outline-none'
          : 'space-y-3 outline-none focus:outline-none focus-visible:outline-none'
      }
      onPointerDownCapture={e => {
        const target = e.target as HTMLElement | null
        if (!target) return
        if (target.closest('[data-agent-session-composer-input="true"]')) return

        const focusableTarget = target.closest(
          'a[href],button,input,textarea,select,[contenteditable="true"],[role="button"],[tabindex]:not([tabindex="-1"])'
        )

        const active = document.activeElement as HTMLElement | null
        if (active?.matches('[data-agent-session-composer-input="true"]')) {
          active.blur()
        }

        if (focusableTarget) return
        containerRef.current?.focus({ preventScroll: true })
      }}
    >
      {agentId.length === 0 ? (
        <div className='text-sm text-text-secondary'>
          Select an agent to view or start sessions.
        </div>
      ) : agentQuery.isError ? (
        <div className='text-sm text-destructive'>
          {toErrorMessage(agentQuery.error)}
        </div>
      ) : accessQuery.isLoading ? (
        <div className='flex h-full w-full items-center justify-center text-sm text-text-secondary'>
          <SandboxLoader label='starting up the sandbox' />
        </div>
      ) : accessQuery.isError ? (
        <div className='text-sm text-destructive'>
          {toErrorMessage(accessQuery.error)}
        </div>
      ) : !access ? (
        <div className='text-sm text-text-secondary'>
          Missing runtime access.
        </div>
      ) : (
        <div className='space-y-3'>
          <div className='space-y-2'>
            {sessionId.length === 0 &&
            messages.length === 0 &&
            !isOptimisticSending ? (
              <div className='text-sm text-text-secondary'>
                Send a message to start a new session.
              </div>
            ) : sessionQuery.isLoading && messages.length === 0 ? (
              <div className='text-sm text-text-secondary'>
                <Loader label='Loading messages…' />
              </div>
            ) : stream.phase === 'connecting' && messages.length === 0 ? (
              <div className='text-sm text-text-secondary'>
                <Loader label='Loading messages…' />
              </div>
            ) : messages.length === 0 ? (
              isOptimisticSending ? (
                <div className='pt-1'>
                  <Loader label='Working…' />
                </div>
              ) : (
                <div className='text-sm text-text-secondary'>
                  No messages yet.
                </div>
              )
            ) : (
              <>
                <SessionMessages messages={messages} messageType={messageType} />
                {stream.isRunning === true ||
                isOptimisticSending ||
                hasVisibleOptimisticMessage ? (
                  <div className='pt-1'>
                    <Loader label='Working…' />
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className='-mx-3 -mb-3 border-t border-border/60'>
            <SessionComposer
              key={`${agentId}:${sessionId}`}
              agentId={agentId}
              sessionId={sessionId}
              access={access}
              setConfig={props.setConfig}
              isSendingOptimistic={isOptimisticSending}
              messageType={messageType}
              onOptimisticMessageChange={setOptimisticMessage}
              onOptimisticSendingChange={setIsOptimisticSending}
              inputRef={composerInputRef}
            />
          </div>

          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  )
}
