import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SettingsRow (props: {
  readonly left: ReactNode
  readonly right?: ReactNode
  readonly className?: string
  readonly disabled?: boolean
}) {
  return (
    <div
      className={cn(
        'px-4 py-3 flex items-center justify-between gap-4',
        props.disabled ? 'opacity-60' : '',
        props.className
      )}
    >
      <div className='min-w-0 flex-1'>{props.left}</div>
      {props.right ? <div className='shrink-0'>{props.right}</div> : null}
    </div>
  )
}

export function SettingsRowLeft (props: {
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly leading?: ReactNode
}) {
  return (
    <div className='flex items-center gap-3 min-w-0'>
      {props.leading ? <div className='shrink-0'>{props.leading}</div> : null}
      <div className='min-w-0'>
        <div className='text-sm font-medium text-text-primary truncate'>
          {props.title}
        </div>
        {props.description ? (
          <div className='text-xs text-text-tertiary truncate'>
            {props.description}
          </div>
        ) : null}
      </div>
    </div>
  )
}
