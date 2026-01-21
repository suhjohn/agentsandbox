import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SettingsList (props: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <div
      className={cn(
        'border border-border bg-surface-2 overflow-hidden divide-border',
        props.className
      )}
    >
      {props.children}
    </div>
  )
}
