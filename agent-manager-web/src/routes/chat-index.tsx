import { CoordinatorAgentShell } from '@/components/coordinator-agent-shell'
import { useAuth } from '../lib/auth'

export function ChatIndexPage () {
  const auth = useAuth()

  if (!auth.user) {
    return (
      <div className='text-sm text-muted-foreground'>
        You need to log in to use chat.
      </div>
    )
  }

  return (
    <div className='h-full min-h-0 overflow-hidden rounded-xl border border-border bg-surface-1'>
      <CoordinatorAgentShell variant='page' />
    </div>
  )
}
