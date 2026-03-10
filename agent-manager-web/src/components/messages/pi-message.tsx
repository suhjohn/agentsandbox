import { createContext, useContext, useEffect, useState } from 'react'
import type { GetSessionId200MessagesItem } from '@/api/generated/agent'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { UserInput } from '@openai/codex-sdk'
import type { ChatMessage } from '@/types/chat'
import type { HarnessMessageSender } from '@/harnesses/types'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import { MessageSenderHeader } from '@/components/messages/message-sender-header'
import { MessageTextBlock } from '@/components/messages/message-text-block'
import { StatusIndicator } from '@/components/messages/status-indicator'
import type { WorkspaceToggleAllCollapsiblesEventDetail } from '@/workspace/keybindings/events'

type StoredSessionMessage = { readonly id: string; readonly body: unknown }
type PiUserInputEvent = {
  readonly type: 'user_input'
  readonly input: readonly UserInput[]
}
type PiMessageBody = AgentSessionEvent | PiUserInputEvent

type ParsedStoredMessage =
  | { readonly kind: 'turn_started' }
  | { readonly kind: 'user'; readonly message: ChatMessage }
  | {
      readonly kind: 'assistant'
      readonly itemId: string
      readonly text: string
      readonly isFinal: boolean
    }

type PiStreamParseResult =
  | { readonly kind: 'turn_started' }
  | { readonly kind: 'stopped' }
  | {
      readonly kind: 'assistant_delta'
      readonly itemId: string
      readonly text: string
    }
  | {
      readonly kind: 'assistant_message'
      readonly itemId: string
      readonly text: string
      readonly isFinal?: boolean
    }
  | { readonly kind: 'error'; readonly message: string }

const PI_EVENT_TYPES = new Set<string>([
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'auto_compaction_start',
  'auto_compaction_end',
  'auto_retry_start',
  'auto_retry_end'
])

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPiUserInput (value: unknown): value is UserInput {
  if (!isRecord(value)) return false
  if (value.type === 'text') return typeof value.text === 'string'
  if (value.type === 'local_image') return typeof value.path === 'string'
  return false
}

function isPiUserInputEvent (value: unknown): value is PiUserInputEvent {
  if (!isRecord(value)) return false
  if (value.type !== 'user_input') return false
  if (!Array.isArray(value.input)) return false
  return value.input.every(isPiUserInput)
}

function formatUserInput (input: readonly UserInput[]): string | null {
  const parts: string[] = []
  for (const item of input) {
    if (item.type === 'text') {
      if (item.text.trim().length > 0) parts.push(item.text)
      continue
    }
    if (item.type === 'local_image') {
      const path = item.path.trim()
      if (path.length > 0) parts.push(`[image: ${path}]`)
    }
  }
  const content = parts.join('\n\n').trim()
  return content.length > 0 ? content : null
}

const CollapsibleScopeContext = createContext<string | null>(null)

export function isPiMessageBody (value: unknown): value is PiMessageBody {
  if (isPiUserInputEvent(value)) return true
  if (!isRecord(value)) return false
  const type = value.type
  return typeof type === 'string' && PI_EVENT_TYPES.has(type)
}

function toTextContent (content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []

  const parts: string[] = []
  for (const item of content) {
    if (!isRecord(item)) continue
    const type = item.type
    if (type === 'text' && typeof item.text === 'string') {
      parts.push(item.text)
      continue
    }
    if (type === 'thinking' && typeof item.thinking === 'string') {
      parts.push(`**Thinking**\n\n${item.thinking}`)
      continue
    }
    // Skip toolCall items - they're shown via tool_execution_end events
    if (type === 'toolCall') continue
    if (type === 'image' && typeof item.mimeType === 'string') {
      parts.push(`[image: ${item.mimeType}]`)
      continue
    }
  }
  return parts
}

function getRole (message: unknown): string | null {
  if (!isRecord(message)) return null
  const role = message.role
  return typeof role === 'string' ? role : null
}

function extractPiMessageText (message: unknown): string | null {
  if (!isRecord(message)) return null
  const role = getRole(message)
  if (!role) return null

  if (role === 'bashExecution') {
    const command = typeof message.command === 'string' ? message.command : ''
    const output = typeof message.output === 'string' ? message.output : ''
    const exitCode =
      typeof message.exitCode === 'number' ? message.exitCode : undefined
    const lines = [
      '**Command execution**',
      command.length > 0 ? `\nCommand:\n${command}` : '',
      typeof exitCode === 'number' ? `\nExit code: ${exitCode}` : '',
      output.length > 0 ? `\nOutput:\n${output}` : ''
    ].filter(v => v.length > 0)
    return lines.join('\n')
  }

  if (role === 'toolResult') {
    const toolName =
      typeof message.toolName === 'string' ? message.toolName : 'tool'
    const content = toTextContent(message.content)
    const details =
      message.details && typeof message.details === 'object'
        ? JSON.stringify(message.details, null, 2)
        : ''
    const lines = [
      `**Tool result: ${toolName}**`,
      content.length > 0 ? content.join('\n') : '',
      details.length > 0 ? `\nDetails:\n\`\`\`json\n${details}\n\`\`\`` : ''
    ].filter(v => v.length > 0)
    return lines.join('\n')
  }

  if (role === 'custom') {
    const customType =
      typeof message.customType === 'string' ? message.customType : 'custom'
    const content = toTextContent(message.content)
    return [`**${customType}**`, content.join('\n')]
      .filter(v => v.length > 0)
      .join('\n')
  }

  const content = toTextContent(message.content)
  if (content.length === 0) return null
  return content.join('\n')
}

function getPiMessageId (message: unknown, fallback: string): string {
  if (!isRecord(message)) return fallback
  const id = message.id
  if (typeof id === 'string' && id.trim().length > 0) return id
  const ts = message.timestamp
  if (typeof ts === 'number' && Number.isFinite(ts)) return `ts:${ts}`
  return fallback
}

export function parsePiStoredMessage (
  raw: StoredSessionMessage
): ParsedStoredMessage | null {
  if (!isPiMessageBody(raw.body)) return null

  if (isPiUserInputEvent(raw.body)) {
    const text = formatUserInput(raw.body.input)
    if (!text) return null
    return {
      kind: 'user',
      message: { id: raw.id, role: 'user', content: text }
    }
  }

  const event = raw.body as AgentSessionEvent
  if (event.type === 'turn_start') return { kind: 'turn_started' }

  if (event.type === 'message_end') {
    const message = (event as { message?: unknown }).message
    const role = getRole(message)
    const text = extractPiMessageText(message)
    if (!text || text.trim().length === 0) return null
    if (role === 'user') {
      return {
        kind: 'user',
        message: { id: raw.id, role: 'user', content: text }
      }
    }
    return {
      kind: 'assistant',
      itemId: getPiMessageId(message, raw.id),
      text,
      isFinal: true
    }
  }

  if (event.type === 'tool_execution_end') {
    const toolName =
      typeof (event as { toolName?: unknown }).toolName === 'string'
        ? ((event as { toolName?: string }).toolName as string)
        : 'tool'
    const result = (event as { result?: unknown }).result
    const resultText =
      result && typeof result === 'object'
        ? JSON.stringify(result, null, 2)
        : typeof result === 'string'
        ? result
        : ''
    const text = [
      `**Tool execution (${toolName})**`,
      resultText.length > 0 ? `\n\`\`\`json\n${resultText}\n\`\`\`` : ''
    ]
      .filter(v => v.length > 0)
      .join('\n')
    if (!text) return null
    return { kind: 'assistant', itemId: raw.id, text, isFinal: true }
  }

  return null
}

export function parsePiStreamEvent (
  eventType: string,
  data: unknown
): PiStreamParseResult | null {
  if (eventType === 'turn_start') return { kind: 'turn_started' }
  if (eventType === 'turn_end' || eventType === 'agent_end')
    return { kind: 'stopped' }

  if (!isRecord(data)) return null

  if (eventType === 'message_update') {
    const assistantMessageEvent = data.assistantMessageEvent
    if (!isRecord(assistantMessageEvent)) return null
    const deltaType = assistantMessageEvent.type
    const delta = assistantMessageEvent.delta
    if (deltaType !== 'text_delta' && deltaType !== 'thinking_delta')
      return null
    if (typeof delta !== 'string' || delta.length === 0) return null
    const message = data.message
    const itemId = getPiMessageId(message, 'pi-message')
    const text =
      deltaType === 'thinking_delta' ? `**Thinking** ${delta}` : delta
    return { kind: 'assistant_delta', itemId, text }
  }

  if (eventType === 'message_end') {
    const message = data.message
    const text = extractPiMessageText(message)
    if (!text || text.trim().length === 0) return null
    return {
      kind: 'assistant_message',
      itemId: getPiMessageId(message, 'pi-message'),
      text,
      isFinal: true
    }
  }

  if (eventType === 'tool_execution_end') {
    const toolName = typeof data.toolName === 'string' ? data.toolName : 'tool'
    const result = data.result
    const resultText =
      result && typeof result === 'object'
        ? JSON.stringify(result, null, 2)
        : typeof result === 'string'
        ? result
        : ''
    const text = [
      `**Tool execution (${toolName})**`,
      resultText.length > 0 ? `\n\`\`\`json\n${resultText}\n\`\`\`` : ''
    ]
      .filter(v => v.length > 0)
      .join('\n')
    if (!text) return null
    return {
      kind: 'assistant_message',
      itemId: `tool:${toolName}`,
      text,
      isFinal: true
    }
  }

  if (eventType === 'error') {
    const message =
      typeof data.message === 'string' ? data.message : 'Unknown error'
    return { kind: 'error', message }
  }

  return null
}

function getMessage (event: unknown): Record<string, unknown> | null {
  if (!isRecord(event)) return null
  const message = (event as { message?: unknown }).message
  if (!isRecord(message)) return null
  return message
}

type ToolExecutionInfo = {
  readonly toolCallId: string | null
  readonly toolName: string
  readonly resultText: string
}

function getToolExecution (event: unknown): ToolExecutionInfo | null {
  if (!isRecord(event)) return null
  if (event.type !== 'tool_execution_end') return null
  const toolCallId =
    typeof event.toolCallId === 'string' ? event.toolCallId : null
  const toolName = typeof event.toolName === 'string' ? event.toolName : 'tool'
  const result = event.result
  const resultText =
    result && typeof result === 'object'
      ? JSON.stringify(result, null, 2)
      : typeof result === 'string'
      ? result
      : ''
  return { toolCallId, toolName, resultText }
}

type ToolCallItem = {
  readonly id: string | null
  readonly name: string
  readonly arguments: unknown
}

function extractToolCalls (message: unknown): ToolCallItem[] {
  if (!isRecord(message)) return []
  const content = message.content
  if (!Array.isArray(content)) return []

  const toolCalls: ToolCallItem[] = []
  for (const item of content) {
    if (!isRecord(item)) continue
    if (item.type !== 'toolCall') continue
    const id = typeof item.id === 'string' ? item.id : null
    const name = typeof item.name === 'string' ? item.name : 'tool'
    toolCalls.push({ id, name, arguments: item.arguments })
  }
  return toolCalls
}

function useCollapsibleToggleAll (initial = false) {
  const leafId = useContext(CollapsibleScopeContext)
  const [isOpen, setIsOpen] = useState(initial)
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<WorkspaceToggleAllCollapsiblesEventDetail>
      ).detail
      if (
        typeof detail?.leafId === 'string' &&
        detail.leafId !== leafId
      ) {
        return
      }
      if (detail && typeof detail.open === 'boolean') {
        setIsOpen(detail.open)
      }
    }
    window.addEventListener('collapsible:toggle-all', handler)
    return () => window.removeEventListener('collapsible:toggle-all', handler)
  }, [])
  return [isOpen, setIsOpen] as const
}

function formatArgsFlat (args: unknown, prefix = ''): string[] {
  if (args === null || args === undefined) return []
  // If args is a JSON string, parse it first
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args)
      if (typeof parsed === 'object' && parsed !== null) {
        return formatArgsFlat(parsed, prefix)
      }
    } catch {
      // Not JSON, treat as plain string
    }
    return prefix ? [`${prefix}: ${args}`] : [args]
  }
  if (Array.isArray(args)) {
    const items = args.map(item =>
      typeof item === 'object' && item !== null
        ? JSON.stringify(item)
        : String(item)
    )
    return prefix ? [`${prefix}: ${items.join(', ')}`] : [items.join(', ')]
  }
  if (typeof args === 'object') {
    const lines: string[] = []
    for (const [key, value] of Object.entries(
      args as Record<string, unknown>
    )) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      if (value === null || value === undefined) {
        lines.push(`${fullKey}: null`)
      } else if (Array.isArray(value)) {
        const items = value.map(item =>
          typeof item === 'object' && item !== null
            ? JSON.stringify(item)
            : String(item)
        )
        lines.push(`${fullKey}: ${items.join(', ')}`)
      } else if (typeof value === 'object') {
        lines.push(...formatArgsFlat(value, fullKey))
      } else {
        lines.push(`${fullKey}: ${String(value)}`)
      }
    }
    return lines
  }
  return prefix ? [`${prefix}: ${String(args)}`] : [String(args)]
}

function truncateArgs (args: unknown, maxLen = 180): string {
  if (!args) return ''
  const lines = formatArgsFlat(args)
  // If only one key, show just the value
  let str: string
  if (lines.length === 1 && lines[0].includes(': ')) {
    str = lines[0].split(': ').slice(1).join(': ')
  } else {
    str = lines.join(', ')
  }
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '…'
}

function PiToolExecutionBlock (props: {
  readonly toolName: string
  readonly resultText: string
  readonly status?: string
}) {
  const [isOpen, setIsOpen] = useCollapsibleToggleAll()
  const status = props.status ?? 'completed'

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className='w-full text-sm'
      data-collapsible-toggle-all='true'
      data-collapsible-open={isOpen ? 'true' : 'false'}
    >
      <CollapsibleTrigger className='flex items-center gap-2 w-full py-1 border-none cursor-pointer'>
        <StatusIndicator status={status} />
        <span className='w-full font-mono text-green-400 truncate'>
          {props.toolName}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className='ml-4 mt-1 px-3 py-2 bg-surface-3 text-xs'>
        {props.resultText.length > 0 ? (
          <>
            <div className='text-[11px] uppercase tracking-wide text-text-tertiary'>
              Response
            </div>
            <div className='pt-1 text-xs text-text-secondary font-mono space-y-0.5 max-h-60 overflow-y-auto'>
              {formatArgsFlat(props.resultText).map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </>
        ) : (
          <div className='text-xs text-text-tertiary'>No response</div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function formatAsJson (value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
}

function PiToolCallBlock (props: {
  readonly toolName: string
  readonly args: unknown
  readonly resultText: string
  readonly status: string
}) {
  const [isOpen, setIsOpen] = useCollapsibleToggleAll()
  const truncatedArgsText = truncateArgs(props.args)
  const argsJson = formatAsJson(props.args)
  const resultJson = formatAsJson(props.resultText)

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className='w-full text-sm'
      data-collapsible-toggle-all='true'
      data-collapsible-open={isOpen ? 'true' : 'false'}
    >
      <CollapsibleTrigger className='flex items-start gap-2 w-full py-1 border-none cursor-pointer'>
        <div className='flex-shrink-0 pt-0.5'>
          <StatusIndicator status={props.status} />
        </div>
        <div className='min-w-0 flex-1 text-left font-mono leading-5 line-clamp-2 text-text-primary'>
          <span className='font-bold'>{props.toolName}</span>
          {truncatedArgsText ? (
            <span className='ml-3 text-text-tertiary'>{truncatedArgsText}</span>
          ) : null}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className='ml-4 mt-1 px-3 py-2 bg-surface-3 text-xs'>
        {argsJson.length > 0 ? (
          <>
            <div className='text-[11px] uppercase tracking-wide text-text-tertiary'>
              Request
            </div>
            <pre className='m-0 pt-1 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all'>
              {argsJson}
            </pre>
          </>
        ) : null}
        {resultJson.length > 0 ? (
          <>
            <div className='pt-2 text-[11px] uppercase tracking-wide text-text-tertiary'>
              Response
            </div>
            <pre className='m-0 pt-1 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto'>
              {resultJson}
            </pre>
          </>
        ) : props.status === 'pending' ? (
          <div className='pt-2 text-xs text-text-tertiary'>Pending...</div>
        ) : (
          <div className='pt-2 text-xs text-text-tertiary'>No response</div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function PiBashExecutionBlock (props: {
  readonly command: string
  readonly output: string
  readonly exitCode: number | undefined
}) {
  const [isOpen, setIsOpen] = useCollapsibleToggleAll()
  const status =
    props.exitCode === undefined
      ? 'pending'
      : props.exitCode === 0
      ? 'completed'
      : 'failed'
  const truncatedCommand =
    props.command.length > 80 ? props.command.slice(0, 80) + '…' : props.command

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className='w-full text-sm'
      data-collapsible-toggle-all='true'
      data-collapsible-open={isOpen ? 'true' : 'false'}
    >
      <CollapsibleTrigger className='flex items-center gap-2 w-full py-1 border-none cursor-pointer'>
        <StatusIndicator status={status} />
        <span className='font-mono text-text-primary truncate'>
          bash
          <span className='text-text-tertiary ml-2'>{truncatedCommand}</span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className='ml-4 mt-1 px-3 py-2 bg-surface-3 text-xs'>
        <div className='text-[11px] uppercase tracking-wide text-text-tertiary'>
          Command
        </div>
        <pre className='m-0 pt-1 text-xs text-text-secondary whitespace-pre-wrap break-all leading-relaxed'>
          {props.command}
        </pre>
        {props.exitCode !== undefined ? (
          <div className='pt-2 text-xs text-text-tertiary'>
            Exit code: {props.exitCode}
          </div>
        ) : null}
        {props.output.length > 0 ? (
          <>
            <div className='pt-2 text-[11px] uppercase tracking-wide text-text-tertiary'>
              Output
            </div>
            <pre className='m-0 pt-1 text-xs text-text-secondary whitespace-pre-wrap break-all overflow-x-auto leading-relaxed max-h-60 overflow-y-auto'>
              {props.output}
            </pre>
          </>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}

function parsePiBody (raw: unknown): PiMessageBody | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.length === 0) return null
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (isPiMessageBody(parsed)) return parsed
    } catch {
      return null
    }
    return null
  }
  if (isPiMessageBody(raw)) return raw
  return null
}

export function PiMessages (props: {
  readonly messages: readonly GetSessionId200MessagesItem[]
  readonly senderById?: Readonly<Record<string, HarnessMessageSender>>
  readonly leafId?: string
}) {
  // First pass: build map of toolCallId → tool execution result
  const toolResultsByCallId = new Map<string, ToolExecutionInfo>()
  const toolCallIdsWithResults = new Set<string>()

  for (const message of props.messages) {
    const body = parsePiBody(message.body)
    if (!body) continue
    const toolExec = getToolExecution(body)
    if (toolExec?.toolCallId) {
      toolResultsByCallId.set(toolExec.toolCallId, toolExec)
      toolCallIdsWithResults.add(toolExec.toolCallId)
    }
  }

  // Second pass: build display messages, skipping tool_execution_end events
  // that will be shown inline with their corresponding tool calls
  const displayMessages: Array<{
    readonly key: string
    readonly message: GetSessionId200MessagesItem
    readonly body: PiMessageBody
  }> = []
  const indexByKey = new Map<string, number>()
  const turnsWithUserInput = new Set<string>()

  // First, identify turns that have user_input events
  for (const message of props.messages) {
    const body = parsePiBody(message.body)
    if (!body) continue
    if (isPiUserInputEvent(body) && message.turnId) {
      turnsWithUserInput.add(message.turnId)
    }
  }

  for (const message of props.messages) {
    const body = parsePiBody(message.body)
    if (!body) continue

    // Skip tool_execution_end events that have a toolCallId (they'll be shown inline)
    const toolExec = getToolExecution(body)
    if (
      toolExec?.toolCallId &&
      toolCallIdsWithResults.has(toolExec.toolCallId)
    ) {
      continue
    }

    // Skip message_end with role === 'toolResult' (shown via tool_execution_end)
    if (body.type === 'message_end') {
      const bodyMessage = getMessage(body)
      const role = getRole(bodyMessage)
      if (role === 'toolResult') {
        continue
      }
      // Skip message_end with role === 'user' if we already have a user_input for this turn
      if (
        role === 'user' &&
        message.turnId &&
        turnsWithUserInput.has(message.turnId)
      ) {
        continue
      }
    }

    let key = message.id
    if (isPiUserInputEvent(body)) {
      key = `turn:${message.turnId ?? 'no-turn'}:user`
    } else if (body.type === 'message_end') {
      const bodyMessage = getMessage(body)
      if (getRole(bodyMessage) === 'user') {
        key = `turn:${message.turnId ?? 'no-turn'}:user`
      }
    }

    const existingIndex = indexByKey.get(key)
    if (existingIndex === undefined) {
      indexByKey.set(key, displayMessages.length)
      displayMessages.push({ key, message, body })
      continue
    }
    displayMessages[existingIndex] = { key, message, body }
  }

  return (
    <CollapsibleScopeContext.Provider value={props.leafId ?? null}>
      {displayMessages.map(({ key, message, body }, index) => {
        return (
          <PiMessage
            key={key}
            message={message}
            body={body}
            isFirst={index === 0}
            sender={getMessageSender(message, props.senderById)}
            toolResultsByCallId={toolResultsByCallId}
          />
        )
      })}
    </CollapsibleScopeContext.Provider>
  )
}

export function PiMessage (props: {
  readonly message: GetSessionId200MessagesItem
  readonly body: PiMessageBody
  readonly isFirst?: boolean
  readonly sender?: HarnessMessageSender
  readonly toolResultsByCallId?: Map<string, ToolExecutionInfo>
}) {
  const event = props.body
  if (isPiUserInputEvent(event)) {
    const text = formatUserInput(event.input)
    if (!text) return null
    return (
      <div className={props.isFirst ? '' : 'mt-8'}>
        {props.sender ? <MessageSenderHeader sender={props.sender} /> : null}
        <div className='w-full bg-surface-4 px-3 py-2 text-sm whitespace-pre-wrap break-words'>
          {text}
        </div>
      </div>
    )
  }

  const eventType = (event as { type?: string }).type

  // Handle standalone tool_execution_end events (without toolCallId match)
  const toolExec = getToolExecution(event)
  if (toolExec) {
    return (
      <PiToolExecutionBlock
        toolName={toolExec.toolName}
        resultText={toolExec.resultText}
      />
    )
  }

  const message = getMessage(event)
  if (message) {
    const role = getRole(message)

    if (role === 'user') {
      const text = extractPiMessageText(message)
      console.log(props)
      if (!text || text.trim().length === 0) return null
      return (
        <div className={props.isFirst ? '' : 'mt-8'}>
          {props.sender ? <MessageSenderHeader sender={props.sender} /> : null}
          <div className='w-full bg-surface-3 px-3 py-2 text-sm whitespace-pre-wrap break-words'>
            {text}
          </div>
        </div>
      )
    }

    if (role === 'bashExecution') {
      const command = typeof message.command === 'string' ? message.command : ''
      const output = typeof message.output === 'string' ? message.output : ''
      const exitCode =
        typeof message.exitCode === 'number' ? message.exitCode : undefined
      return (
        <PiBashExecutionBlock
          command={command}
          output={output}
          exitCode={exitCode}
        />
      )
    }

    if (role === 'toolResult') {
      const toolName =
        typeof message.toolName === 'string' ? message.toolName : 'tool'
      const content = toTextContent(message.content)
      const details =
        message.details && typeof message.details === 'object'
          ? JSON.stringify(message.details, null, 2)
          : ''
      const resultText = [content.join('\n'), details]
        .filter(v => v.length > 0)
        .join('\n')
      return (
        <PiToolExecutionBlock toolName={toolName} resultText={resultText} />
      )
    }

    // For assistant messages, extract text and tool calls
    const text = extractPiMessageText(message)
    const toolCalls = extractToolCalls(message)

    // Render text content if present
    const textElement =
      text && text.trim().length > 0 ? <MessageTextBlock text={text} /> : null

    // Render tool calls with their results
    const toolCallElements = toolCalls.map((toolCall, index) => {
      const result =
        toolCall.id && props.toolResultsByCallId
          ? props.toolResultsByCallId.get(toolCall.id)
          : null
      return (
        <PiToolCallBlock
          key={toolCall.id ?? `toolcall-${index}`}
          toolName={result?.toolName ?? toolCall.name}
          args={toolCall.arguments}
          resultText={result?.resultText ?? ''}
          status={result ? 'completed' : 'pending'}
        />
      )
    })

    if (textElement || toolCallElements.length > 0) {
      return (
        <>
          {textElement}
          {toolCallElements}
        </>
      )
    }
  }

  if (eventType === 'message_update') return null

  return null
}

function getMessageSender (
  message: GetSessionId200MessagesItem,
  senderById: Readonly<Record<string, HarnessMessageSender>> | undefined
): HarnessMessageSender | undefined {
  if (typeof message.createdBy !== 'string' || message.createdBy.length === 0) {
    return undefined
  }
  return senderById?.[message.createdBy]
}
