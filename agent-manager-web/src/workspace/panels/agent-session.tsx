import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient
} from '@tanstack/react-query'
import { getModels, getProviders } from '@mariozechner/pi-ai'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ModelCombobox } from '@/components/ui/model-combobox'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Check, ChevronsUpDown, Code, Columns2, Columns3Icon, Copy, GitCommit, GitCompare, Globe, Rows, Rows2, Square, TableColumnsSplit, Terminal } from 'lucide-react'
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
  type PostSession201,
  type PostSessionBodyModelReasoningEffort,
  type PostSessionIdMessageBodyModelReasoningEffort
} from '@/api/generated/agent'
import { CodexMessages } from '@/components/messages/codex-message'
import { PiMessages } from '@/components/messages/pi-message'
import type { PanelProps } from './types'
import { parseBody as parseBodyUtil } from './session-message-utils'
import { useWorkspaceStore } from '../store'
import { listLeafIds } from '../layout'
import { TbTableColumn, TbTableRow } from 'react-icons/tb'

export interface AgentSessionPanelConfig {
  readonly agentId: string
  readonly agentName?: string
  readonly sessionId: string
  readonly sessionTitle?: string
  readonly sessionModel?: string
  readonly sessionModelReasoningEffort?: string
  readonly sessionHarness?: string
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
const STICKY_SCROLL_BOTTOM_THRESHOLD_PX = 300
const SESSION_STATUS_PROCESSING = 'processing'
const SESSION_STATUS_INITIAL = 'initial'
type ThinkingLevel =
  PostSessionBodyModelReasoningEffort &
  PostSessionIdMessageBodyModelReasoningEffort
type SelectedThinkingLevel = '' | ThinkingLevel
type SessionToolTab = 'terminal' | 'browser' | 'vscode' | 'diff'

const CODEX_THINKING_LEVELS: readonly ThinkingLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
]
const PI_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
] as const satisfies readonly ThinkingLevel[]

type CatalogModel = {
  readonly id: string
  readonly name: string
  readonly provider: string
}

const ALL_MODELS: readonly CatalogModel[] = getProviders()
  .flatMap(provider =>
    getModels(provider).map(model => ({
      id: model.id,
      name: model.name,
      provider: model.provider
    }))
  )
  .sort((a, b) => {
    const providerCompare = a.provider.localeCompare(b.provider)
    if (providerCompare !== 0) return providerCompare
    return a.name.localeCompare(b.name)
  })

const OPENAI_MODELS = ALL_MODELS.filter(model => model.provider === 'openai')

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

function getAvailableModelsForHarness (
  harness: 'codex' | 'pi'
): readonly CatalogModel[] {
  if (harness === 'codex') return OPENAI_MODELS
  return ALL_MODELS.map(model => ({
    ...model,
    id: `${model.provider}/${model.id}`
  }))
}

function resolveSelectableModels (args: {
  readonly harness: 'codex' | 'pi'
  readonly selectedModel: string
}): readonly CatalogModel[] {
  const available = getAvailableModelsForHarness(args.harness)
  const selectedModel = args.selectedModel.trim()
  if (
    selectedModel.length === 0 ||
    available.some(model => model.id === selectedModel)
  ) {
    return available
  }

  return [
    {
      id: selectedModel,
      name:
        args.harness === 'pi' && !selectedModel.includes('/')
          ? `${selectedModel} (provider unspecified)`
          : args.harness === 'codex'
          ? `${selectedModel} (current)`
          : `${selectedModel.split('/').slice(1).join('/')} (current)`,
      provider:
        args.harness === 'pi' && !selectedModel.includes('/')
          ? 'saved'
          : 'current'
    },
    ...available
  ]
}

function getThinkingLevelsForHarness (
  harness: 'codex' | 'pi'
): readonly ThinkingLevel[] {
  return harness === 'pi' ? PI_THINKING_LEVELS : CODEX_THINKING_LEVELS
}

function normalizeThinkingLevel (
  harness: 'codex' | 'pi',
  value: string | null | undefined
): SelectedThinkingLevel {
  const trimmed = value?.trim().toLowerCase() ?? ''
  if (trimmed.length === 0) return ''
  return getThinkingLevelsForHarness(harness).includes(trimmed as ThinkingLevel)
    ? (trimmed as ThinkingLevel)
    : ''
}

function formatThinkingLevelLabel (value: ThinkingLevel): string {
  if (value === 'xhigh') return 'X-High'
  if (value === 'off') return 'Off'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function hasThinkingLevel (value: SelectedThinkingLevel): value is ThinkingLevel {
  return value !== ''
}

function ThinkingLevelCombobox (props: {
  readonly value: SelectedThinkingLevel
  readonly onChange: (value: SelectedThinkingLevel) => void
  readonly levels: readonly ThinkingLevel[]
  readonly disabled?: boolean
  readonly className?: string
}) {
  const [open, setOpen] = useState(false)

  const displayLabel =
    hasThinkingLevel(props.value)
      ? formatThinkingLevelLabel(props.value)
      : 'Default thinking'

  const commitSelection = (value: SelectedThinkingLevel) => {
    props.onChange(value)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          role='combobox'
          aria-expanded={open}
          aria-label='Thinking level'
          disabled={props.disabled}
          className={cn(
            'h-7 justify-between gap-1 px-2 text-xs font-normal text-text-secondary hover:text-text-primary',
            props.className
          )}
        >
          <span className='truncate'>{displayLabel}</span>
          <ChevronsUpDown className='h-3.5 w-3.5 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        sideOffset={4}
        className='w-[180px] p-1 bg-surface-1/95 backdrop-blur-sm'
      >
        <div className='space-y-0.5'>
          <button
            type='button'
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors',
              props.value === ''
                ? 'bg-accent text-accent-foreground'
                : 'text-text-secondary hover:bg-accent/60 hover:text-text-primary'
            )}
            onClick={() => {
              commitSelection('')
            }}
          >
            <span className='flex-1 truncate'>Default thinking</span>
            <Check
              className={cn(
                'h-4 w-4',
                props.value === '' ? 'opacity-100' : 'opacity-0'
              )}
            />
          </button>
          {props.levels.map(level => (
            <button
              key={level}
              type='button'
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors',
                props.value === level
                  ? 'bg-accent text-accent-foreground'
                  : 'text-text-secondary hover:bg-accent/60 hover:text-text-primary'
              )}
              onClick={() => {
                commitSelection(level)
              }}
            >
              <span className='flex-1 truncate'>
                {formatThinkingLevelLabel(level)}
              </span>
              <Check
                className={cn(
                  'h-4 w-4',
                  props.value === level ? 'opacity-100' : 'opacity-0'
                )}
              />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
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

type CopyFormat = 'json' | 'plaintext' | 'markdown'

function extractTextContent (
  body: unknown
): { role: string; text: string } | null {
  const parsed = parseBody(body)
  if (typeof parsed !== 'object' || parsed === null) {
    if (typeof parsed === 'string') return { role: 'message', text: parsed }
    return null
  }
  const rec = parsed as Record<string, unknown>
  const role = typeof rec.role === 'string' ? rec.role : 'message'

  if (typeof rec.content === 'string') return { role, text: rec.content }
  if (Array.isArray(rec.content)) {
    const textParts = rec.content
      .filter(
        (c: unknown) =>
          typeof c === 'object' &&
          c !== null &&
          (c as Record<string, unknown>).type === 'text'
      )
      .map((c: unknown) => String((c as Record<string, unknown>).text ?? ''))
    if (textParts.length > 0) return { role, text: textParts.join('\n') }
  }

  if (typeof rec.type === 'string') {
    if (typeof rec.text === 'string') return { role: rec.type, text: rec.text }
    return { role: rec.type, text: JSON.stringify(parsed) }
  }

  return null
}

function formatMessagesAsPlainText (
  messages: readonly GetSessionId200MessagesItem[]
): string {
  return messages
    .map(m => {
      const extracted = extractTextContent(m.body)
      if (!extracted) return null
      return `[${extracted.role}]: ${extracted.text}`
    })
    .filter(Boolean)
    .join('\n\n')
}

function formatMessagesAsMarkdown (
  messages: readonly GetSessionId200MessagesItem[]
): string {
  return messages
    .map(m => {
      const extracted = extractTextContent(m.body)
      if (!extracted) return null
      return `**${extracted.role}**\n\n${extracted.text}`
    })
    .filter(Boolean)
    .join('\n\n---\n\n')
}

function formatMessages (
  messages: readonly GetSessionId200MessagesItem[],
  format: CopyFormat
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(messages, null, 2)
    case 'plaintext':
      return formatMessagesAsPlainText(messages)
    case 'markdown':
      return formatMessagesAsMarkdown(messages)
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
}): GetSessionId200MessagesItem {
  const nowIso = new Date().toISOString()
  const idSuffix = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  const id = `optimistic:${args.sessionId}:${idSuffix}`

  const body = {
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
  readonly model?: string | null
  readonly modelReasoningEffort?: string | null
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
  if ('model' in patch && next.model !== patch.model) {
    next = { ...next, model: patch.model }
    changed = true
  }
  if (
    'modelReasoningEffort' in patch &&
    next.modelReasoningEffort !== patch.modelReasoningEffort
  ) {
    next = {
      ...next,
      modelReasoningEffort: patch.modelReasoningEffort
    }
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
      if (parent.hasAttribute('data-workspace-panel-scroller')) break
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
  depKey: string,
  sessionKey: string,
  forceScrollToken: number
) {
  const isAtBottomRef = useRef(false)
  const lastHandledForceScrollTokenRef = useRef(forceScrollToken)
  const initialScrollStateRef = useRef<{
    readonly sessionKey: string
    done: boolean
  }>({
    sessionKey,
    done: false
  })

  if (initialScrollStateRef.current.sessionKey !== sessionKey) {
    initialScrollStateRef.current = {
      sessionKey,
      done: false
    }
  }

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

    const scrollToBottom = () => {
      scrollParent.scrollTop = scrollParent.scrollHeight
    }

    if (forceScrollToken !== lastHandledForceScrollTokenRef.current) {
      lastHandledForceScrollTokenRef.current = forceScrollToken
      isAtBottomRef.current = true
      scrollToBottom()
      return
    }

    if (!initialScrollStateRef.current.done && depKey !== '0') {
      initialScrollStateRef.current.done = true
      isAtBottomRef.current = true
      scrollToBottom()
      return
    }

    const { scrollTop, scrollHeight, clientHeight } = scrollParent
    const atBottom =
      scrollHeight - scrollTop - clientHeight <
      STICKY_SCROLL_BOTTOM_THRESHOLD_PX
    isAtBottomRef.current = atBottom
    if (atBottom) {
      scrollToBottom()
    }
  }, [depKey, forceScrollToken, scrollParent, sessionKey])
}

function SessionComposer (props: {
  readonly agentId: string
  readonly agentName?: string
  readonly sessionId: string
  readonly access: GetAgentsAgentIdAccess200
  readonly harness: 'codex' | 'pi'
  readonly selectedModel: string
  readonly selectedModelReasoningEffort: SelectedThinkingLevel
  readonly availableModels: readonly CatalogModel[]
  readonly availableThinkingLevels: readonly ThinkingLevel[]
  readonly setConfig: PanelProps<AgentSessionPanelConfig>['setConfig']
  readonly runtime: PanelProps<AgentSessionPanelConfig>['runtime']
  readonly isSendingOptimistic: boolean
  readonly onSelectedModelChange: (model: string) => void
  readonly onSelectedModelReasoningEffortChange: (
    effort: SelectedThinkingLevel
  ) => void
  readonly onOptimisticMessageChange: (
    message: GetSessionId200MessagesItem | null
  ) => void
  readonly onOptimisticSendingChange: (isSending: boolean) => void
  readonly onSendScrollRequest: () => void
  readonly inputRef: { current: HTMLTextAreaElement | null }
}) {
  const queryClient = useQueryClient()
  const workspaceStore = useWorkspaceStore()

  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [copyDropdownOpen, setCopyDropdownOpen] = useState(false)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const buildAgentDetailConfig = useCallback(
    (activeTab: SessionToolTab) => ({
      agentId: props.agentId,
      agentName: props.agentName?.trim() ?? '',
      activeTab,
      sessionLimit: 20,
      sessionId: props.sessionId,
      sessionTitle: '',
      sessionModel: props.selectedModel,
      sessionModelReasoningEffort: props.selectedModelReasoningEffort,
      sessionHarness: props.harness,
      diffStyle: 'split' as const
    }),
    [
      props.agentId,
      props.agentName,
      props.harness,
      props.selectedModel,
      props.selectedModelReasoningEffort,
      props.sessionId
    ]
  )

  const replaceInPane = useCallback(
    (activeTab: SessionToolTab) => {
      props.runtime.replaceSelf('agent_detail', buildAgentDetailConfig(activeTab))
    },
    [buildAgentDetailConfig, props.runtime]
  )

  const openToSide = useCallback(
    (activeTab: SessionToolTab) => {
      props.runtime.openPanel('agent_detail', buildAgentDetailConfig(activeTab), {
        placement: 'right',
        forceNew: true
      })
    },
    [buildAgentDetailConfig, props.runtime]
  )

  const openToBottom = useCallback(
    (activeTab: SessionToolTab) => {
      props.runtime.openPanel('agent_detail', buildAgentDetailConfig(activeTab), {
        placement: 'bottom',
        forceNew: true
      })
    },
    [buildAgentDetailConfig, props.runtime]
  )

  const openToWindowSplit = useCallback(
    (
      activeTab: SessionToolTab,
      dir: 'row' | 'col'
    ) => {
      const beforeState = workspaceStore.getState()
      const beforeWindow = beforeState.windowsById[beforeState.activeWindowId]
      if (!beforeWindow) return
      const beforeLeafIds = listLeafIds(beforeWindow.root)

      workspaceStore.dispatch({
        type: 'window/split-full',
        dir,
        insertBefore: false
      })

      const afterState = workspaceStore.getState()
      const afterWindow = afterState.windowsById[afterState.activeWindowId]
      if (!afterWindow) return
      const afterLeafIds = listLeafIds(afterWindow.root)
      const newLeafId =
        afterLeafIds.find(id => !beforeLeafIds.includes(id)) ??
        afterWindow.focusedLeafId ??
        null
      if (!newLeafId) return

      workspaceStore.dispatch({
        type: 'panel/open',
        fromLeafId: newLeafId,
        placement: 'self',
        panelType: 'agent_detail',
        config: buildAgentDetailConfig(activeTab)
      })
    },
    [buildAgentDetailConfig, workspaceStore]
  )

  function ToolOpenMenuButton (tool: {
    readonly label: string
    readonly icon: ReactNode
    readonly tab: SessionToolTab
  }) {
    const [open, setOpen] = useState(false)

    return (
      <HoverCard open={open} onOpenChange={setOpen} openDelay={0} closeDelay={100}>
        <HoverCardTrigger asChild>
          <Button
            variant='icon'
            size='icon'
            title={tool.label}
            aria-label={tool.label}
            onClick={() => {
              openToSide(tool.tab)
              setOpen(false)
            }}
          >
            {tool.icon}
          </Button>
        </HoverCardTrigger>
        <HoverCardContent
          align='end'
          sideOffset={8}
          className='w-[240px] p-2 bg-surface-1/95 backdrop-blur-sm'
        >
          <p className='px-1 pb-1 text-xs font-semibold text-text-primary'>
            {tool.label}
          </p>
          <div className='flex flex-col'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-8 justify-start px-2 text-xs'
              onClick={() => {
                replaceInPane(tool.tab)
                setOpen(false)
              }}
            >
              <Square className="h-4 w-4" />
              Open
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-8 justify-start px-2 text-xs'
              onClick={() => {
                openToSide(tool.tab)
                setOpen(false)
              }}
            >
              <Columns2 className="h-4 w-4" />
              Open to side
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-8 justify-start px-2 text-xs'
              onClick={() => {
                openToBottom(tool.tab)
                setOpen(false)
              }}
            >
              <Rows2 className="h-4 w-4 -scale-y-100" />
              Open to bottom
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-8 justify-start px-2 text-xs'
              onClick={() => {
                openToWindowSplit(tool.tab, 'row')
                setOpen(false)
              }}
            >
              <TbTableColumn className="h-4 w-4 -scale-x-100" />
              Open to window side
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-8 justify-start px-2 text-xs'
              onClick={() => {
                openToWindowSplit(tool.tab, 'col')
                setOpen(false)
              }}
            >
              <TbTableRow className="h-4 w-4 -scale-y-100" />

              Open to window bottom
            </Button>
          </div>
        </HoverCardContent>
      </HoverCard>
    )
  }

  const doCopy = useCallback(
    async (format: CopyFormat) => {
      if (!props.access?.agentApiUrl) return
      const messages = getSessionMessages(
        props.agentId,
        props.sessionId,
        props.access.agentApiUrl
      )
      if (messages.length === 0) {
        toast.error('No messages to copy')
        return
      }
      const text = formatMessages(messages, format)
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success('Copied!')
      setTimeout(() => setCopied(false), 2000)
    },
    [props.agentId, props.sessionId, props.access?.agentApiUrl]
  )

  const createSessionMutation = useMutation({
    mutationFn: async (args: {
      readonly model: string
      readonly modelReasoningEffort: SelectedThinkingLevel
    }) => {
      if (!props.access?.agentApiUrl || !props.access.agentAuthToken) {
        throw new Error('Missing agent runtime access')
      }
      const body: Record<string, unknown> = {
        harness: props.harness,
        model: args.model,
        modelReasoningEffort: args.modelReasoningEffort
      }
      return await postSession(
        body as unknown as Parameters<typeof postSession>[0],
        {
          baseUrl: props.access.agentApiUrl,
          agentAuthToken: props.access.agentAuthToken
        } as unknown as RequestInit
      )
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
      const body: Record<string, unknown> = {
        input: [{ type: 'text', text: args.text }],
        model: props.selectedModel,
        modelReasoningEffort: props.selectedModelReasoningEffort
      }
      return await postSessionIdMessage(
        args.sessionId,
        body as unknown as Parameters<typeof postSessionIdMessage>[1],
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
      await createSessionMutation.mutateAsync({
        model: props.selectedModel,
        modelReasoningEffort: props.selectedModelReasoningEffort
      })
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
        text
      })
      applySessionPatchToWorkspaceCaches(queryClient, nextSessionId, {
        status: SESSION_STATUS_PROCESSING,
        updatedAt: optimisticMessage.createdAt,
        lastMessageBody: toStoredMessageBody(optimisticMessage.body),
        model: props.selectedModel.length > 0 ? props.selectedModel : null,
        modelReasoningEffort:
          props.selectedModelReasoningEffort.length > 0
            ? props.selectedModelReasoningEffort
            : null
      })
      props.onSendScrollRequest()
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
    <div className='mx-3 flex flex-col'>
      <div className='w-full flex justify-end gap-1'>
        <ToolOpenMenuButton
          label='Terminal'
          tab='terminal'
          icon={<Terminal className='h-4 w-4' />}
        />
        <ToolOpenMenuButton
          label='Browser'
          tab='browser'
          icon={<Globe className='h-4 w-4' />}
        />
        <ToolOpenMenuButton
          label='VSCode'
          tab='vscode'
          icon={<Code className='h-4 w-4' />}
        />
        <ToolOpenMenuButton
          label='Diff'
          tab='diff'
          icon={<GitCompare className='h-4 w-4' />}
        />
      </div>
      <div className='bg-surface-3'>
        <Textarea
          data-agent-session-composer-input='true'
          ref={props.inputRef}
          rows={2}
          maxRows={15}
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
      <div className='bg-surface-1 px-3 flex items-center gap-3 pt-0.5 pb-2'>
        <div className='flex items-center gap-3'>
          <p className='text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary'>
            {props.harness}
          </p>
        </div>
        <ModelCombobox
          value={props.selectedModel}
          onChange={props.onSelectedModelChange}
          models={props.availableModels}
          disabled={composerDisabled}
        />
        <ThinkingLevelCombobox
          value={props.selectedModelReasoningEffort}
          onChange={props.onSelectedModelReasoningEffortChange}
          levels={props.availableThinkingLevels}
          disabled={composerDisabled}
          className='max-w-[140px]'
        />
        <div className='flex-1' />
        {props.sessionId.length > 0 && (
          <DropdownMenu
            open={copyDropdownOpen}
            onOpenChange={setCopyDropdownOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant='icon'
                size='icon'
                className='h-7 w-7 shrink-0'
                title='Copy thread'
                aria-label='Copy thread'
                onClick={e => {
                  e.preventDefault()
                  setCopyDropdownOpen(false)
                  void doCopy('json')
                }}
                onPointerEnter={() => {
                  hoverTimeoutRef.current = setTimeout(() => {
                    setCopyDropdownOpen(true)
                  }, 300)
                }}
                onPointerLeave={() => {
                  if (hoverTimeoutRef.current) {
                    clearTimeout(hoverTimeoutRef.current)
                    hoverTimeoutRef.current = null
                  }
                }}
              >
                {copied ? (
                  <Check className='!h-3.5 !w-3.5' />
                ) : (
                  <Copy className='!h-3.5 !w-3.5' />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' sideOffset={4}>
              <DropdownMenuLabel>Copy as</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void doCopy('plaintext')}>
                Plain text
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void doCopy('markdown')}>
                Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void doCopy('json')}>
                JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
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
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollParent = useScrollParent(containerRef)

  const [stream, setStream] = useState<StreamState>(INITIAL_STREAM_STATE)
  const [optimisticMessage, setOptimisticMessage] =
    useState<GetSessionId200MessagesItem | null>(null)
  const [isOptimisticSending, setIsOptimisticSending] = useState(false)
  const [forceScrollToken, setForceScrollToken] = useState(0)
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
  const sessionHarness = useMemo((): 'codex' | 'pi' => {
    if (props.config.sessionHarness === 'pi') return 'pi'
    if (props.config.sessionHarness === 'codex') return 'codex'
    const harness = sessionQuery.data?.harness?.trim().toLowerCase()
    return harness === 'pi' ? 'pi' : 'codex'
  }, [props.config.sessionHarness, sessionQuery.data?.harness])
  const selectedSessionModel = useMemo(() => {
    if (typeof props.config.sessionModel === 'string') {
      return props.config.sessionModel.trim()
    }
    return sessionQuery.data?.model?.trim() ?? ''
  }, [props.config.sessionModel, sessionQuery.data?.model])
  const selectedSessionModelReasoningEffort = useMemo(
    () =>
      normalizeThinkingLevel(
        sessionHarness,
        typeof props.config.sessionModelReasoningEffort === 'string'
          ? props.config.sessionModelReasoningEffort
          : sessionQuery.data?.modelReasoningEffort
      ),
    [
      props.config.sessionModelReasoningEffort,
      sessionHarness,
      sessionQuery.data?.modelReasoningEffort
    ]
  )
  const availableModels = useMemo(
    () =>
      resolveSelectableModels({
        harness: sessionHarness,
        selectedModel: selectedSessionModel
      }),
    [selectedSessionModel, sessionHarness]
  )
  const availableThinkingLevels = useMemo(
    () => getThinkingLevelsForHarness(sessionHarness),
    [sessionHarness]
  )
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
    const bodyLen =
      last?.body != null ? JSON.stringify(last.body).length : 0
    return `${messages.length}:${last?.id ?? ''}:${last?.createdAt ?? ''}:${bodyLen}`
  }, [messages])
  const stickyScrollSessionKey = useMemo(
    () => `${agentId}:${sessionId}`,
    [agentId, sessionId]
  )

  useStickyScroll(
    scrollParent,
    stickyScrollDepKey,
    stickyScrollSessionKey,
    forceScrollToken
  )

  const resetSessionStatusMutation = useMutation({
    mutationFn: async (args: {
      readonly sessionId: string
      readonly agentId: string
      readonly harness: string
      readonly model: string | null
      readonly modelReasoningEffort: string | null
    }) => {
      await putSessionId(args.sessionId, {
        agentId: args.agentId,
        status: 'initial',
        harness: args.harness,
        model: args.model,
        modelReasoningEffort: args.modelReasoningEffort
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
      model: selectedSessionModel.length > 0 ? selectedSessionModel : null,
      modelReasoningEffort:
        selectedSessionModelReasoningEffort.length > 0
          ? selectedSessionModelReasoningEffort
          : null,
      ...(typeof lastMessageBody !== 'undefined' ? { lastMessageBody } : {}),
      ...(sessionTitleValue.length > 0 ? { title: sessionTitleValue } : {})
    }
    applySessionPatchToWorkspaceCaches(queryClient, sessionId, patch)

    const harness = sessionQuery.data?.harness?.trim()
    if (!harness || resetSessionStatusMutation.isPending) return

    resetSessionStatusMutation.mutate({
      sessionId,
      agentId,
      harness,
      model: selectedSessionModel.length > 0 ? selectedSessionModel : null,
      modelReasoningEffort:
        selectedSessionModelReasoningEffort.length > 0
          ? selectedSessionModelReasoningEffort
          : null
    })
  }, [
    agentId,
    selectedSessionModel,
    selectedSessionModelReasoningEffort,
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
          ? 'h-full flex flex-col outline-none focus:outline-none focus-visible:outline-none'
          : 'space-y-3 h-full flex flex-col outline-none focus:outline-none focus-visible:outline-none'
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
        <div className='h-full flex flex-col gap-8'>
          <div className='p-3 flex-1 space-y-2'>
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
                <SessionMessages
                  messages={messages}
                  messageType={messageType}
                />
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

          <div className='sticky bottom-0'>
            <SessionComposer
              key={`${agentId}:${sessionId}`}
              agentId={agentId}
              agentName={props.config.agentName}
              sessionId={sessionId}
              access={access}
              harness={sessionHarness}
              selectedModel={selectedSessionModel}
              selectedModelReasoningEffort={selectedSessionModelReasoningEffort}
              availableModels={availableModels}
              availableThinkingLevels={availableThinkingLevels}
              setConfig={props.setConfig}
              runtime={props.runtime}
              isSendingOptimistic={isOptimisticSending}
              onSelectedModelChange={model => {
                props.setConfig(prev => ({
                  ...prev,
                  sessionModel: model
                }))
              }}
              onSelectedModelReasoningEffortChange={modelReasoningEffort => {
                props.setConfig(prev => ({
                  ...prev,
                  sessionModelReasoningEffort: modelReasoningEffort
                }))
              }}
              onOptimisticMessageChange={setOptimisticMessage}
              onOptimisticSendingChange={setIsOptimisticSending}
              onSendScrollRequest={() => {
                setForceScrollToken(prev => prev + 1)
              }}
              inputRef={composerInputRef}
            />
          </div>
        </div>
      )}
    </div>
  )
}
