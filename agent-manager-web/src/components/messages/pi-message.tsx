import { useEffect, useState } from 'react'
import type { GetSessionId200MessagesItem } from '@/api/generated/agent'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { UserInput } from '@openai/codex-sdk'
import type { ChatMessage } from '@/types/chat'
import { Check, ChevronRight, X } from 'lucide-react'
import { getCssVarAsNumber } from '@/utils/css-vars'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import { Markdown } from '@/components/markdown'

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
  const [isOpen, setIsOpen] = useState(initial)
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean }>).detail
      if (detail && typeof detail.open === 'boolean') {
        setIsOpen(detail.open)
      }
    }
    window.addEventListener('collapsible:toggle-all', handler)
    return () => window.removeEventListener('collapsible:toggle-all', handler)
  }, [])
  return [isOpen, setIsOpen] as const
}

function StatusIcon (props: { readonly status: string }) {
  const iconSize = getCssVarAsNumber('--size-icon-sm', 14)
  if (props.status === 'completed') {
    return (
      <Check size={iconSize - 2} className='flex-shrink-0 text-green-500' />
    )
  }
  if (props.status === 'failed') {
    return <X size={iconSize - 2} className='flex-shrink-0 text-red-500' />
  }
  return null
}

function PiCollapsibleBlock (props: {
  readonly title: string
  readonly subtitle?: string
  readonly badge?: string
  readonly status?: string
  readonly children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useCollapsibleToggleAll()
  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className='w-full text-sm'
      data-collapsible-toggle-all='true'
      data-collapsible-open={isOpen ? 'true' : 'false'}
    >
      <CollapsibleTrigger className='flex items-center gap-2 w-full py-1 border-none cursor-pointer'>
        <ChevronRight
          size={getCssVarAsNumber('--size-icon-sm', 14)}
          className={`flex-shrink-0 transition-transform duration-200 text-text-tertiary ${
            isOpen ? 'rotate-90' : ''
          }`}
        />
        {props.badge ? (
          <span className='text-[10px] px-1.5 py-0.5 bg-surface-3 text-text-tertiary font-mono flex-shrink-0'>
            {props.badge}
          </span>
        ) : null}
        <span className='font-medium text-text-primary truncate'>
          {props.title}
        </span>
        {props.subtitle ? (
          <span className='text-xs text-text-tertiary flex-shrink-0'>
            {props.subtitle}
          </span>
        ) : null}
        {props.status ? <StatusIcon status={props.status} /> : null}
      </CollapsibleTrigger>
      <CollapsibleContent className='ml-6 mt-1 px-3 py-2 bg-surface-3 text-xs'>
        {props.children}
      </CollapsibleContent>
    </Collapsible>
  )
}

function PiToolExecutionBlock (props: {
  readonly toolName: string
  readonly resultText: string
  readonly status?: string
}) {
  return (
    <PiCollapsibleBlock
      title={props.toolName}
      badge='tool_call'
      status={props.status ?? 'completed'}
    >
      {props.resultText.length > 0 ? (
        <>
          <div className='text-[11px] uppercase tracking-wide text-text-tertiary'>
            Response
          </div>
          <pre className='m-0 pt-1 text-xs text-text-secondary whitespace-pre-wrap break-all overflow-x-auto leading-relaxed max-h-60 overflow-y-auto'>
            {props.resultText}
          </pre>
        </>
      ) : (
        <div className='text-xs text-text-tertiary'>No response</div>
      )}
    </PiCollapsibleBlock>
  )
}

function PiToolCallBlock (props: {
  readonly toolName: string
  readonly argsText: string
  readonly resultText: string
  readonly status: string
}) {
  return (
    <PiCollapsibleBlock
      title={props.toolName}
      badge='tool_call'
      status={props.status}
    >
      {props.argsText.length > 0 ? (
        <>
          <div className='text-[11px] uppercase tracking-wide text-text-tertiary'>
            Request
          </div>
          <pre className='m-0 pt-1 text-xs text-text-secondary whitespace-pre-wrap break-all overflow-x-auto leading-relaxed'>
            {props.argsText}
          </pre>
        </>
      ) : null}
      {props.resultText.length > 0 ? (
        <>
          <div className='pt-2 text-[11px] uppercase tracking-wide text-text-tertiary'>
            Response
          </div>
          <pre className='m-0 pt-1 text-xs text-text-secondary whitespace-pre-wrap break-all overflow-x-auto leading-relaxed max-h-60 overflow-y-auto'>
            {props.resultText}
          </pre>
        </>
      ) : props.status === 'pending' ? (
        <div className='pt-2 text-xs text-text-tertiary'>Pending...</div>
      ) : (
        <div className='pt-2 text-xs text-text-tertiary'>No response</div>
      )}
    </PiCollapsibleBlock>
  )
}

function PiBashExecutionBlock (props: {
  readonly command: string
  readonly output: string
  readonly exitCode: number | undefined
}) {
  const status =
    props.exitCode === undefined
      ? undefined
      : props.exitCode === 0
      ? 'completed'
      : 'failed'

  return (
    <PiCollapsibleBlock
      title={
        props.command.length > 60
          ? props.command.slice(0, 60) + '…'
          : props.command
      }
      badge='command'
      status={status}
    >
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
    </PiCollapsibleBlock>
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

  for (const message of props.messages) {
    const body = parsePiBody(message.body)
    if (!body) continue

    // Skip tool_execution_end events that have a toolCallId (they'll be shown inline)
    const toolExec = getToolExecution(body)
    if (toolExec?.toolCallId && toolCallIdsWithResults.has(toolExec.toolCallId)) {
      continue
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
    <>
      {displayMessages.map(({ key, message, body }, index) => {
        return (
          <PiMessage
            key={key}
            message={message}
            body={body}
            isFirst={index === 0}
            toolResultsByCallId={toolResultsByCallId}
          />
        )
      })}
    </>
  )
}

export function PiMessage (props: {
  readonly message: GetSessionId200MessagesItem
  readonly body: PiMessageBody
  readonly isFirst?: boolean
  readonly toolResultsByCallId?: Map<string, ToolExecutionInfo>
}) {
  const event = props.body
  if (isPiUserInputEvent(event)) {
    const text = formatUserInput(event.input)
    if (!text) return null
    return (
      <div
        className={`${
          props.isFirst ? '' : 'mt-8'
        } w-full bg-surface-3 px-3 py-2 text-sm whitespace-pre-wrap break-words`}
      >
        {text}
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
      if (!text || text.trim().length === 0) return null
      return (
        <div
          className={`${
            props.isFirst ? '' : 'mt-8'
          } w-full bg-surface-3 px-3 py-2 text-sm whitespace-pre-wrap break-words`}
        >
          {text}
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
      text && text.trim().length > 0 ? (
        <div className='text-sm'>
          <Markdown>{text}</Markdown>
        </div>
      ) : null

    // Render tool calls with their results
    const toolCallElements = toolCalls.map((toolCall, index) => {
      const result =
        toolCall.id && props.toolResultsByCallId
          ? props.toolResultsByCallId.get(toolCall.id)
          : null
      const argsText =
        toolCall.arguments && typeof toolCall.arguments === 'object'
          ? JSON.stringify(toolCall.arguments, null, 2)
          : ''
      return (
        <PiToolCallBlock
          key={toolCall.id ?? `toolcall-${index}`}
          toolName={result?.toolName ?? toolCall.name}
          argsText={argsText}
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
