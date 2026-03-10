import { useEffect, useState } from 'react'
import type { GetSessionId200MessagesItem } from '@/api/generated/agent'
import type {
  CommandExecutionItem,
  FileChangeItem,
  McpToolCallItem,
  ThreadEvent,
  ThreadItem,
  TodoListItem,
  UserInput,
  WebSearchItem
} from '@openai/codex-sdk'
import { Check, ChevronRight, Circle, X } from 'lucide-react'
import { getCssVarAsNumber } from '@/utils/css-vars'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import { MessageTextBlock } from '@/components/messages/message-text-block'
import { StatusIndicator } from '@/components/messages/status-indicator'

type CodexUserInputEvent = {
  readonly type: 'user_input'
  readonly input: readonly UserInput[]
}

type LegacyCodexEvent =
  | { readonly type: 'assistant.delta'; readonly delta?: unknown }
  | {
      readonly type: 'assistant.message'
      readonly text?: unknown
      readonly delta?: unknown
    }

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCodexUserInput (value: unknown): value is UserInput {
  if (!isRecord(value)) return false
  if (value.type === 'text') return typeof value.text === 'string'
  if (value.type === 'local_image') return typeof value.path === 'string'
  return false
}

function isCodexUserInputEvent (value: unknown): value is CodexUserInputEvent {
  if (!isRecord(value)) return false
  if (value.type !== 'user_input') return false
  if (!Array.isArray(value.input)) return false
  return value.input.every(isCodexUserInput)
}

export function isCodexMessageBody (
  value: unknown
): value is ThreadEvent | CodexUserInputEvent | LegacyCodexEvent {
  if (!isRecord(value)) return false
  if (isCodexUserInputEvent(value)) return true
  const type = value.type
  return typeof type === 'string' && (type.includes('.') || type === 'error')
}

function safeJsonStringify (value: unknown): string | null {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return null
  }
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

function getItem (body: unknown): ThreadItem | null {
  if (!isRecord(body)) return null
  const item = (body as { item?: unknown }).item
  if (!isRecord(item)) return null
  return item as ThreadItem
}

function getAssistantText (body: unknown): string | null {
  if (!isRecord(body)) return null
  if (body.type === 'assistant.message') {
    const text =
      (body as { text?: unknown; delta?: unknown }).text ??
      (body as { delta?: unknown }).delta
    return typeof text === 'string' ? text : null
  }
  const item = getItem(body)
  if (item?.type === 'agent_message') return item.text
  return null
}

function getEventErrorMessage (body: unknown): string | null {
  if (!isRecord(body) || typeof body.type !== 'string') return null

  if (body.type === 'turn.failed') {
    const error = (body as { error?: unknown }).error
    if (!isRecord(error)) return null
    const message = (error as { message?: unknown }).message
    return typeof message === 'string' && message.trim().length > 0
      ? message
      : null
  }

  if (body.type === 'error') {
    const directMessage = (body as { message?: unknown }).message
    if (typeof directMessage === 'string' && directMessage.trim().length > 0) {
      return directMessage
    }
    const nestedError = (body as { error?: unknown }).error
    if (typeof nestedError === 'string' && nestedError.trim().length > 0) {
      return nestedError
    }
    if (isRecord(nestedError)) {
      const nestedMessage = (nestedError as { message?: unknown }).message
      if (
        typeof nestedMessage === 'string' &&
        nestedMessage.trim().length > 0
      ) {
        return nestedMessage
      }
    }
  }

  return null
}

function formatMaybeJson (value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  return safeJsonStringify(value)
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

function truncateArgs (args: unknown, maxLen = 60): string {
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

function CollapsibleBlock (props: {
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

function ToolCallBlock (props: {
  readonly item: McpToolCallItem
  readonly eventType: string
}) {
  const [isOpen, setIsOpen] = useCollapsibleToggleAll()
  const status =
    props.item.status ??
    (props.eventType === 'item.started'
      ? 'started'
      : props.eventType === 'item.updated'
      ? 'updated'
      : 'completed')
  const argsJson = formatAsJson(props.item.arguments)
  const resultContentJson = formatAsJson(props.item.result?.content)
  const resultStructuredJson = formatAsJson(
    props.item.result?.structured_content
  )
  const hasResponse =
    resultContentJson || resultStructuredJson || props.item.error?.message
  const truncatedArgs = truncateArgs(props.item.arguments)

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
          <span className='font-bold'>{props.item.tool}</span>
          {truncatedArgs ? (
            <span className='text-text-tertiary ml-3'>{truncatedArgs}</span>
          ) : null}
        </span>
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
        {hasResponse ? (
          <>
            <div className='pt-2 text-[11px] uppercase tracking-wide text-text-tertiary'>
              Response
            </div>
            {resultContentJson ? (
              <pre className='m-0 pt-1 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto'>
                {resultContentJson}
              </pre>
            ) : null}
            {resultStructuredJson ? (
              <pre className='m-0 pt-1 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto'>
                {resultStructuredJson}
              </pre>
            ) : null}
            {props.item.error?.message ? (
              <div className='pt-1 text-xs text-[var(--color-destructive)]'>
                Error: {props.item.error.message}
              </div>
            ) : null}
          </>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}

function CommandExecutionBlock (props: { readonly item: CommandExecutionItem }) {
  const [isOpen, setIsOpen] = useCollapsibleToggleAll()
  const { item } = props
  const status = item.status ?? 'completed'
  const truncatedCommand =
    item.command.length > 60 ? item.command.slice(0, 60) + '…' : item.command

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
          <span className='font-bold'>bash</span>
          <span className='text-text-tertiary ml-2'>{truncatedCommand}</span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className='ml-4 mt-1 px-3 py-2 bg-surface-3 text-xs'>
        <div className='text-[11px] uppercase tracking-wide text-text-tertiary'>
          Command
        </div>
        <pre className='m-0 pt-1 text-xs text-text-secondary whitespace-pre-wrap break-all leading-relaxed'>
          {item.command}
        </pre>
        {item.exit_code !== undefined ? (
          <div className='pt-2 text-xs text-text-tertiary'>
            Exit code: {item.exit_code}
          </div>
        ) : null}
        {item.aggregated_output.length > 0 ? (
          <>
            <div className='pt-2 text-[11px] uppercase tracking-wide text-text-tertiary'>
              Output
            </div>
            <pre className='m-0 pt-1 text-xs text-text-secondary whitespace-pre-wrap break-all overflow-x-auto leading-relaxed max-h-60 overflow-y-auto'>
              {item.aggregated_output}
            </pre>
          </>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}

function FileChangeBlock (props: { readonly item: FileChangeItem }) {
  const { item } = props
  const summary =
    item.changes.length === 0
      ? 'No changes'
      : `${item.changes.length} file${item.changes.length === 1 ? '' : 's'}`
  return (
    <CollapsibleBlock title={summary} badge='file_change' status={item.status}>
      {item.changes.length === 0 ? (
        <div className='text-xs text-text-tertiary'>No changes</div>
      ) : (
        <ul className='m-0 p-0 list-none space-y-0.5'>
          {item.changes.map((change, i) => (
            <li key={i} className='text-xs text-text-secondary'>
              <span className='text-text-tertiary'>{change.kind}</span>{' '}
              <span className='font-mono'>{change.path}</span>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleBlock>
  )
}

function WebSearchBlock (props: {
  readonly item: WebSearchItem
  readonly eventType: string
}) {
  const statusLabel =
    props.eventType === 'item.started'
      ? 'started'
      : props.eventType === 'item.updated'
      ? 'updated'
      : 'completed'
  return (
    <CollapsibleBlock
      title={props.item.query}
      badge='web_search'
      status={statusLabel}
    >
      <div className='text-xs text-text-secondary'>{props.item.query}</div>
    </CollapsibleBlock>
  )
}

function ReasoningBlock (props: { readonly text: string }) {
  return (
    <MessageTextBlock
      text={stripReasoningTitle(props.text)}
      className='py-2 text-text-secondary'
    />
  )
}

function stripReasoningTitle (text: string): string {
  const normalized = text.trim()
  if (normalized.length === 0) return normalized

  const blocks = normalized.split(/\n\s*\n/)
  if (blocks.length < 2) return normalized

  const firstBlock = blocks[0].trim()
  if (firstBlock.length === 0 || firstBlock.includes('\n')) return normalized

  const unwrappedTitle = firstBlock
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .trim()

  const looksLikeTitle =
    unwrappedTitle.length > 0 &&
    unwrappedTitle.length <= 80 &&
    !/[.!?:]$/.test(unwrappedTitle)

  if (!looksLikeTitle) return normalized

  return blocks.slice(1).join('\n\n').trim()
}

function TodoListBlock (props: { readonly item: TodoListItem }) {
  const { item } = props
  const allCompleted =
    item.items.length > 0 && item.items.every(it => it.completed)
  const title = allCompleted ? 'Completed' : 'Todo'
  const doneCount = item.items.filter(it => it.completed).length
  const progress =
    item.items.length > 0 ? (doneCount / item.items.length) * 100 : 0
  const iconSize = getCssVarAsNumber('--size-icon-sm', 14)

  return (
    <div className='text-sm border border-border-primary bg-surface-2 overflow-hidden'>
      <div className='flex items-center justify-between px-3 py-2 bg-surface-3'>
        <div className='flex items-center gap-2'>
          <span className='font-medium text-text-primary'>{title}</span>
          <span className='text-xs text-text-tertiary'>
            {doneCount}/{item.items.length}
          </span>
        </div>
        {item.items.length > 0 && (
          <div className='flex items-center gap-2'>
            <div className='w-16 h-1.5 bg-surface-1 overflow-hidden'>
              <div
                className='h-full bg-green-500 transition-all duration-300'
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className='text-[10px] text-text-tertiary font-medium'>
              {Math.round(progress)}%
            </span>
          </div>
        )}
      </div>
      {item.items.length === 0 ? (
        <div className='px-3 py-3 text-xs text-text-tertiary'>No items</div>
      ) : (
        <ul className='m-0 p-0 list-none divide-y divide-border-primary'>
          {item.items.map((it, i) => (
            <li key={i} className='px-3 py-2 text-xs flex items-start gap-2'>
              <span className='flex-shrink-0 mt-0.5'>
                {it.completed ? (
                  <Check size={iconSize - 2} className='text-green-500' />
                ) : (
                  <Circle size={iconSize - 2} className='text-text-tertiary' />
                )}
              </span>
              <span
                className={
                  it.completed
                    ? 'text-text-tertiary line-through'
                    : 'text-text-secondary'
                }
              >
                {it.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type CodexMessageBody = ThreadEvent | CodexUserInputEvent | LegacyCodexEvent

function parseCodexBody (raw: unknown): CodexMessageBody | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.length === 0) return null
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (isCodexMessageBody(parsed)) return parsed
    } catch {
      return null
    }
    return null
  }
  if (isCodexMessageBody(raw)) return raw
  return null
}

export function CodexMessages (props: {
  readonly messages: readonly GetSessionId200MessagesItem[]
}) {
  const displayMessages = buildDisplayMessages(props.messages)
  return (
    <>
      {displayMessages.map(({ key, message, body }, index) => (
        <CodexMessage
          key={key}
          message={message}
          body={body}
          isFirst={index === 0}
        />
      ))}
    </>
  )
}

type DisplayMessage = {
  readonly key: string
  readonly message: GetSessionId200MessagesItem
  readonly body: CodexMessageBody
}

function getItemId (item: ThreadItem): string | null {
  if (!isRecord(item)) return null
  const id = (item as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : null
}

function getItemEventRank (eventType: string): number {
  if (eventType === 'item.started') return 0
  if (eventType === 'item.updated') return 1
  if (eventType === 'item.completed' || eventType === 'item.failed') return 2
  return 1
}

function buildDisplayMessages (
  messages: readonly GetSessionId200MessagesItem[]
): DisplayMessage[] {
  const display: DisplayMessage[] = []
  const indexByKey = new Map<string, number>()
  const rankByKey = new Map<string, number>()

  for (const message of messages) {
    const body = parseCodexBody(message.body)
    if (!body) continue

    const eventType = body.type
    const item = getItem(body)
    const itemId = item ? getItemId(item) : null

    if (eventType.startsWith('item.') && itemId) {
      const turnKey = message.turnId ?? 'no-turn'
      const key = `turn:${turnKey}:item:${itemId}`
      const nextRank = getItemEventRank(eventType)

      const existingIndex = indexByKey.get(key)
      if (existingIndex === undefined) {
        indexByKey.set(key, display.length)
        rankByKey.set(key, nextRank)
        display.push({ key, message, body })
      } else {
        const prevRank = rankByKey.get(key) ?? -1
        if (nextRank >= prevRank) {
          rankByKey.set(key, nextRank)
          display[existingIndex] = { ...display[existingIndex], body }
        }
      }
      continue
    }

    display.push({ key: message.id, message, body })
  }

  return display
}

export function CodexMessage (props: {
  readonly message: GetSessionId200MessagesItem
  readonly body: ThreadEvent | CodexUserInputEvent | LegacyCodexEvent
  readonly isFirst?: boolean
}) {
  const body = props.body
  const eventType = body.type

  if (isCodexUserInputEvent(body)) {
    const text = formatUserInput(body.input)
    if (!text) return null
    return (
      <div
        className={`${
          props.isFirst ? '' : 'mt-8'
        } w-full bg-surface-4 px-3 py-2 text-sm whitespace-pre-wrap break-words`}
      >
        {text}
      </div>
    )
  }

  const item = getItem(body)
  if (item) {
    switch (item.type) {
      case 'mcp_tool_call':
        return <ToolCallBlock item={item} eventType={eventType} />
      case 'command_execution':
        return <CommandExecutionBlock item={item} />
      case 'file_change':
        return <FileChangeBlock item={item} />
      case 'web_search':
        return <WebSearchBlock item={item} eventType={eventType} />
      case 'todo_list':
        return <TodoListBlock item={item} />
      case 'reasoning':
        return <ReasoningBlock text={(item as { text?: string }).text ?? ''} />
      case 'agent_message': {
        const text = item.text
        if (!text || text.trim().length === 0) return null
        return <MessageTextBlock text={text} />
      }
      case 'error':
        return <div className='text-sm text-red-500'>{item.message}</div>
      default:
        return null
    }
  }

  const text = getAssistantText(body)
  if (text && text.trim().length > 0) {
    return <MessageTextBlock text={text} />
  }

  const eventErrorMessage = getEventErrorMessage(body)
  if (eventErrorMessage) {
    return <div className='text-sm text-red-500'>{eventErrorMessage}</div>
  }

  return null
}
