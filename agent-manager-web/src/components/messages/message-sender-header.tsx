import { UserIdentity } from '@/components/user-identity'
import type { HarnessMessageSender } from '@/harnesses/types'

export function MessageSenderHeader (props: {
  readonly sender: HarnessMessageSender
}) {
  return (
    <UserIdentity
      user={props.sender}
      className='mb-2 text-xs text-text-tertiary'
      avatarClassName='h-6 w-6'
      avatarTextClassName='text-[11px]'
      nameClassName='text-text-secondary'
    />
  )
}
