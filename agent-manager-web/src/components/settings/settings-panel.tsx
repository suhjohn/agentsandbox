import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SettingsPanel (props: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <div
      className={cn(
        'border border-border bg-surface-1 overflow-hidden',
        props.className
      )}
    >
      {props.children}
    </div>
  )
}

export function SettingsPanelBody (props: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return <div className={cn('p-4', props.className)}>{props.children}</div>
}

export function SettingsPanelFooter (props: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <div
      className={cn(
        'px-4 py-3 border-t border-border bg-surface-1 flex items-center justify-end gap-2',
        props.className
      )}
    >
      {props.children}
    </div>
  )
}
