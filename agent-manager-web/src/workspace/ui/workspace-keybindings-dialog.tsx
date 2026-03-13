import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type {
  WorkspaceCommandDefinition,
  WorkspaceKeybinding
} from '../keybindings/types'
import { formatKeySequence } from '../keybindings/types'

export interface WorkspaceKeybindingsDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly commands: readonly WorkspaceCommandDefinition[]
  readonly bindings: readonly WorkspaceKeybinding[]
  readonly onOpenSettings: () => void
}

function commandMatchesQuery (
  command: WorkspaceCommandDefinition,
  query: string
): boolean {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0) return true
  return (
    command.title.toLowerCase().includes(normalized) ||
    command.description.toLowerCase().includes(normalized) ||
    command.id.toLowerCase().includes(normalized) ||
    command.category.toLowerCase().includes(normalized)
  )
}

export function WorkspaceKeybindingsDialog (
  props: WorkspaceKeybindingsDialogProps
) {
  const [query, setQuery] = useState('')

  const shortcutsByCommandId = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const binding of props.bindings) {
      const existing = map.get(binding.actionId) ?? []
      existing.push(formatKeySequence(binding.sequence))
      map.set(binding.actionId, existing)
    }
    return map
  }, [props.bindings])

  const visibleCommands = useMemo(() => {
    return [...props.commands]
      .filter(command => commandMatchesQuery(command, query))
      .sort((a, b) => {
        if (a.category !== b.category) {
          return a.category.localeCompare(b.category)
        }
        return a.title.localeCompare(b.title)
      })
  }, [props.commands, query])

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-w-4xl p-0 overflow-hidden gap-0'>
        <DialogHeader className='px-4 py-3 border-b border-border'>
          <DialogTitle className='text-sm'>Keyboard Shortcuts</DialogTitle>
          <DialogDescription className='text-xs text-text-tertiary'>
            Effective workspace bindings from the shared command registry.
          </DialogDescription>
        </DialogHeader>
        <div className='px-4 py-3 border-b border-border flex items-center gap-2'>
          <Input
            autoFocus
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder='Search commands, IDs, or categories…'
          />
          <Button
            variant='secondary'
            size='sm'
            onClick={() => {
              props.onOpenChange(false)
              props.onOpenSettings()
            }}
          >
            Open settings
          </Button>
        </div>
        <div className='max-h-[560px] overflow-y-auto divide-y divide-border/60'>
          {visibleCommands.length === 0 ? (
            <div className='px-4 py-8 text-sm text-text-secondary'>
              No commands found.
            </div>
          ) : (
            visibleCommands.map(command => {
              const shortcuts = shortcutsByCommandId.get(command.id) ?? []
              return (
                <div key={command.id} className='px-4 py-3 space-y-1.5'>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <p className='text-sm font-medium text-text-primary truncate'>
                        {command.title}
                      </p>
                      <p className='text-xs text-text-secondary'>
                        {command.description}
                      </p>
                    </div>
                    <span className='text-[11px] text-text-tertiary whitespace-nowrap'>
                      {command.category}
                    </span>
                  </div>
                  <div className='flex items-center gap-2 flex-wrap'>
                    <code className='text-[11px] text-text-tertiary'>
                      {command.id}
                    </code>
                    {shortcuts.length > 0 ? (
                      shortcuts.map(shortcut => (
                        <span
                          key={`${command.id}:${shortcut}`}
                          className='rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] font-mono text-text-secondary'
                        >
                          {shortcut}
                        </span>
                      ))
                    ) : (
                      <span className='text-[11px] text-text-tertiary'>
                        Unbound
                      </span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
