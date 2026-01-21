import { useEffect, useState } from 'react'
import type { GetSessionId200MessagesItem } from '@/api/generated/agent'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
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

export function isPiMessageBody (value: unknown): value is AgentSessionEvent {
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
    if (type === 'toolCall') {
      const name = typeof item.name === 'string' ? item.name : 'tool'
      const args =
        item.arguments && typeof item.arguments === 'object'
          ? JSON.stringify(item.arguments, null, 2)
          : ''
      parts.push(
        args.length > 0
          ? `**Tool call: ${name}**\n\n\`\`\`json\n${args}\n\`\`\``
          : `**Tool call: ${name}**`
      )
      continue
    }
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

function getToolExecution (
  event: unknown
): { toolName: string; resultText: string } | null {
  if (!isRecord(event)) return null
  if (event.type !== 'tool_execution_end') return null
  const toolName = typeof event.toolName === 'string' ? event.toolName : 'tool'
  const result = event.result
  const resultText =
    result && typeof result === 'object'
      ? JSON.stringify(result, null, 2)
      : typeof result === 'string'
      ? result
      : ''
  return { toolName, resultText }
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
      className='w-full text-sm text-text-primary'
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
      <CollapsibleContent className='ml-6 mt-1 px-3 py-2 bg-surface-3 text-xs text-text-primary'>
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

function parsePiBody (raw: unknown): AgentSessionEvent | null {
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
  const displayMessages = props.messages.flatMap(message => {
    const body = parsePiBody(message.body)
    if (!body) return []
    return [{ key: message.id, message, body }] as const
  })

  return (
    <>
      {displayMessages.map(({ key, message, body }, index) => {
        return (
          <PiMessage
            key={key}
            message={message}
            body={body}
            isFirst={index === 0}
          />
        )
      })}
    </>
  )
}

export function PiMessage (props: {
  readonly message: GetSessionId200MessagesItem
  readonly body: AgentSessionEvent
  readonly isFirst?: boolean
}) {
  const event = props.body
  const eventType = (event as { type?: string }).type

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
          className={`${props.isFirst ? '' : 'mt-8'} w-full bg-surface-3 px-3 py-2 text-sm text-text-primary whitespace-pre-wrap break-words`}
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

    const text = extractPiMessageText(message)
    if (text && text.trim().length > 0) {
      return (
        <div className='text-sm text-text-primary'>
          <Markdown>{text}</Markdown>
        </div>
      )
    }
  }

  if (eventType === 'message_update') return null

  return null
}
