import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/user-avatar'

type UserIdentityUser = {
  readonly id: string
  readonly name: string
  readonly avatar?: string | null
}

export function UserIdentity (props: {
  readonly user: UserIdentityUser
  readonly className?: string
  readonly avatarClassName?: string
  readonly avatarTextClassName?: string
  readonly nameClassName?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', props.className)}>
      <UserAvatar
        user={props.user}
        className={cn('h-6 w-6', props.avatarClassName)}
        textClassName={props.avatarTextClassName}
      />
      <span
        className={cn(
          'truncate font-medium text-text-secondary',
          props.nameClassName
        )}
      >
        {props.user.name}
      </span>
    </div>
  )
}
