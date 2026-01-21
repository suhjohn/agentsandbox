import type { ReactNode } from 'react'

export function SettingsSection (props: {
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly action?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section className='space-y-2'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='text-sm font-semibold text-text-primary truncate'>
            {props.title}
          </div>
          {props.description ? (
            <div className='mt-1 text-xs text-text-tertiary'>
              {props.description}
            </div>
          ) : null}
        </div>
        {props.action ? <div className='shrink-0'>{props.action}</div> : null}
      </div>
      {props.children}
    </section>
  )
}
