import type { GetSessionId200MessagesItem } from '@/api/generated/agent'
import type { HarnessMessageProps } from './types'
import { parseBody as parseBodyUtil } from '@/workspace/panels/session-message-utils'

function formatFallbackMessageBody (value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function FallbackMessage (props: { readonly message: GetSessionId200MessagesItem }) {
  const fallback = (() => {
    const parsed = parseBodyUtil(props.message.body)
    if (parsed == null) return formatFallbackMessageBody(props.message.body)
    return formatFallbackMessageBody(parsed)
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

export function FallbackMessages (props: HarnessMessageProps) {
  return (
    <>
      {props.messages.map(message => (
        <FallbackMessage key={message.id} message={message} />
      ))}
    </>
  )
}
