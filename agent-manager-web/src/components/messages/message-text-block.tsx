import { Markdown } from '@/components/markdown'
import { StatusIndicator } from '@/components/messages/status-indicator'
import { cn } from '@/lib/utils'

type MessageTextBlockProps = {
  readonly text: string
  readonly className?: string
  readonly contentClassName?: string
}

export function MessageTextBlock (props: MessageTextBlockProps) {
  return (
    <div className={cn('flex items-start gap-2 text-sm', props.className)}>
      <div className='mt-[0.34rem] flex-shrink-0'>
        <StatusIndicator />
      </div>
      <div
        className={cn(
          'min-w-0 flex-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          props.contentClassName
        )}
      >
        <Markdown>{props.text}</Markdown>
      </div>
    </div>
  )
}
