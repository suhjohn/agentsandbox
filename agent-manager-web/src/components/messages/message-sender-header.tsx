import { UserAvatar } from '@/components/user-avatar'
import type { HarnessMessageSender } from '@/harnesses/types'

export function MessageSenderHeader (props: {
  readonly sender: HarnessMessageSender
}) {
  return (
    <div className='mb-2 flex items-center gap-2 text-xs text-text-tertiary'>
      <UserAvatar
        user={props.sender}
        className='h-6 w-6'
        textClassName='text-[11px]'
      />
      <span className='truncate font-medium text-text-secondary'>
        {props.sender.name}
      </span>
    </div>
  )
}
