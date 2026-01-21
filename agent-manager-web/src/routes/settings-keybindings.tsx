import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAuth, type AuthContextValue } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  SettingsList,
  SettingsPage,
  SettingsPanel,
  SettingsSection,
  SettingsRow,
  SettingsRowLeft
} from '@/components/settings'
import { useWorkspaceKeybindings } from '@/workspace/keybindings/use-workspace-keybindings'
import {
  hasWorkspaceKeybindingOverrides,
  loadWorkspaceKeybindingOverrides,
  normalizePersistedWorkspaceKeybindingPayload,
  sanitizeWorkspaceKeybindingOverrides,
  toPersistedWorkspaceKeybindingPayload
} from '@/workspace/keybindings/persistence'
import type {
  KeybindingContext,
  WorkspaceCommandDefinition,
  WorkspaceCommandId,
  WorkspaceKeybinding,
  WorkspaceKeybindingOverrides
} from '@/workspace/keybindings/types'
import {
  createKeySequence,
  areKeySequencesEqual,
  formatKeySequence,
  keyChordFromEvent
} from '@/workspace/keybindings/types'
import { DEFAULT_LEADER_SEQUENCE } from '@/workspace/keybindings/defaults'

type RecordingTarget = {
  readonly commandId: WorkspaceCommandId
  readonly context: KeybindingContext
  readonly args?: unknown
  readonly replaceBindingId?: string
}

const MODIFIER_KEY_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight'
])

function formatContextLabel (context: KeybindingContext): string {
  if (context === 'global') return 'Global'
  if (context === 'workspace') return 'Workspace'
  if (context === 'workspace.prefix') return 'Prefix'
  if (context === 'workspace.pane_number') return 'Pane number'
  if (context.startsWith('panel:')) {
    return `Panel (${context.slice('panel:'.length)})`
  }
  return context
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

function getBindingsForCommand (
  bindings: readonly WorkspaceKeybinding[],
  commandId: WorkspaceCommandId
): readonly WorkspaceKeybinding[] {
  return bindings.filter(binding => binding.commandId === commandId)
}

export function SettingsKeybindingsPage () {
  const auth = useAuth()
  const accountOverrides = useMemo(
    () => sanitizeWorkspaceKeybindingOverrides(auth.user?.workspaceKeybindings),
    [auth.user?.workspaceKeybindings]
  )
  const initialOverrides = useMemo((): WorkspaceKeybindingOverrides => {
    if (hasWorkspaceKeybindingOverrides(accountOverrides)) return accountOverrides
    return loadWorkspaceKeybindingOverrides(auth.user?.id)
  }, [accountOverrides, auth.user?.id])
  const accountKey = useMemo(() => {
    const payload = normalizePersistedWorkspaceKeybindingPayload(
      auth.user?.workspaceKeybindings
    )
    return payload ? JSON.stringify(payload) : 'none'
  }, [auth.user?.workspaceKeybindings])

  return (
    <SettingsKeybindingsEditor
      key={`${auth.user?.id ?? 'anonymous'}:${accountKey}`}
      auth={auth}
      initialOverrides={initialOverrides}
    />
  )
}

function SettingsKeybindingsEditor (props: {
  readonly auth: AuthContextValue
  readonly initialOverrides: WorkspaceKeybindingOverrides
}) {
  const keybindings = useWorkspaceKeybindings({
    userId: props.auth.user?.id,
    initialOverrides: props.initialOverrides,
    workspaceActive: false
  })

  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<RecordingTarget | null>(null)
  const [leaderRecording, setLeaderRecording] = useState(false)
  const [importPayload, setImportPayload] = useState('')
  const [isSavingAccount, setIsSavingAccount] = useState(false)

  useEffect(() => {
    if (!recording) return

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (MODIFIER_KEY_CODES.has(event.code)) return

      if (
        event.code === 'Escape' &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        setRecording(null)
        return
      }

      const sequence = createKeySequence(keyChordFromEvent(event))
      const candidate: WorkspaceKeybinding = {
        id: recording.replaceBindingId ?? 'recording-candidate',
        context: recording.context,
        commandId: recording.commandId,
        sequence,
        args: recording.args
      }
      const conflicts = keybindings.getConflictsForBinding(candidate)
      const hasReservedConflict = conflicts.some(
        conflict => conflict.kind === 'reserved'
      )
      if (hasReservedConflict) {
        toast.error('That shortcut is reserved for global controls.')
        return
      }
      const hasCommandConflict = conflicts.some(
        conflict =>
          conflict.kind === 'binding' &&
          conflict.commandIds.some(commandId => commandId !== recording.commandId)
      )
      if (hasCommandConflict) {
        toast.error('That shortcut is already bound in this context.')
        return
      }

      if (recording.replaceBindingId) {
        keybindings.removeBinding(recording.replaceBindingId)
      }
      keybindings.rebindCommand({
        commandId: recording.commandId,
        context: recording.context,
        sequence,
        args: recording.args,
        replaceExisting: false
      })
      toast.success(
        `Bound ${recording.commandId} to ${formatKeySequence(sequence)}`
      )
      setRecording(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [keybindings, recording])

  useEffect(() => {
    if (!leaderRecording) return

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (MODIFIER_KEY_CODES.has(event.code)) return

      if (
        event.code === 'Escape' &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        setLeaderRecording(false)
        return
      }

      const sequence = createKeySequence(keyChordFromEvent(event))
      const reservedConflict = keybindings.reservedChords.some(reserved =>
        areKeySequencesEqual(reserved.sequence, sequence)
      )
      if (reservedConflict) {
        toast.error('That shortcut is reserved for global controls.')
        return
      }

      keybindings.setLeaderSequence(sequence)
      toast.success(`Leader set to ${formatKeySequence(sequence)}`)
      setLeaderRecording(false)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [keybindings, leaderRecording])

  const filteredCommands = useMemo(
    () =>
      [...keybindings.commands]
        .filter(command => commandMatchesQuery(command, query))
        .sort((a, b) => {
          if (a.category !== b.category) {
            return a.category.localeCompare(b.category)
          }
          return a.title.localeCompare(b.title)
        }),
    [keybindings.commands, query]
  )

  const copyExportToClipboard = useCallback(async () => {
    const payload = keybindings.exportBindings()
    try {
      await navigator.clipboard.writeText(payload)
      toast.success('Export copied to clipboard')
    } catch {
      setImportPayload(payload)
      toast.message('Clipboard unavailable. Export copied into textarea.')
    }
  }, [keybindings])

  const saveToAccount = useCallback(async () => {
    setIsSavingAccount(true)
    try {
      const payload = toPersistedWorkspaceKeybindingPayload(keybindings.overrides)
      await props.auth.updateMe({ workspaceKeybindings: payload })
      toast.success(
        payload
          ? 'Saved keybindings to account'
          : 'Cleared account keybinding overrides'
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save keybindings'
      )
    } finally {
      setIsSavingAccount(false)
    }
  }, [keybindings, props.auth])

  const isDefaultLeader = useMemo(
    () => areKeySequencesEqual(keybindings.leaderSequence, DEFAULT_LEADER_SEQUENCE),
    [keybindings.leaderSequence]
  )

  return (
    <SettingsPage
      title='Keybindings'
      description='Manage tmux-style workspace shortcuts and command bindings.'
      action={
        <div className='flex items-center gap-2'>
          <Button
            onClick={() => {
              void saveToAccount()
            }}
            disabled={isSavingAccount || !props.auth.user}
          >
            {isSavingAccount ? 'Saving…' : 'Save to account'}
          </Button>
          <Button
            variant='secondary'
            onClick={() => {
              keybindings.resetBindings()
              toast.success('Keybindings reset to defaults')
            }}
            disabled={isSavingAccount}
          >
            Reset defaults
          </Button>
        </div>
      }
    >
      <div className='space-y-4'>
        <SettingsSection title='Leader'>
          <SettingsPanel>
            <SettingsList className='rounded-none border-0'>
              <SettingsRow
                left={
                  <SettingsRowLeft
                    title='Prefix leader'
                    description='Starts tmux-style prefix mode. Press Ctrl+Escape while recording to cancel.'
                  />
                }
                right={
                  <div className='flex items-center gap-2'>
                    <Badge variant='outline' className='font-mono'>
                      {formatKeySequence(keybindings.leaderSequence)}
                    </Badge>
                    <Button
                      size='sm'
                      variant={leaderRecording ? 'outline' : 'secondary'}
                      onClick={() => setLeaderRecording(prev => !prev)}
                      disabled={recording !== null}
                    >
                      {leaderRecording ? 'Cancel capture' : 'Record leader'}
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => {
                        keybindings.resetLeaderSequence()
                        toast.success(
                          `Leader reset to default (${formatKeySequence(DEFAULT_LEADER_SEQUENCE)})`
                        )
                      }}
                      disabled={leaderRecording || recording !== null || isDefaultLeader}
                    >
                      Reset
                    </Button>
                  </div>
                }
              />
            </SettingsList>
          </SettingsPanel>
        </SettingsSection>

        <SettingsSection title='Search'>
          <SettingsPanel>
            <SettingsList className='rounded-none border-0'>
              <SettingsRow
                left={
                  <SettingsRowLeft
                    title='Filter commands'
                    description='Search by title, command ID, or category.'
                  />
                }
                right={
                  <Input
                    className='w-[340px]'
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder='Search commands…'
                  />
                }
              />
            </SettingsList>
          </SettingsPanel>
        </SettingsSection>

        <SettingsSection
          title='Commands'
          description='Every command is viewable here and bindings are editable per context.'
        >
          <SettingsPanel>
            <div className='divide-y divide-border'>
              {filteredCommands.length === 0 ? (
                <div className='px-4 py-6 text-sm text-text-secondary'>
                  No commands found.
                </div>
              ) : (
                filteredCommands.map(command => {
                  const commandBindings = getBindingsForCommand(
                    keybindings.bindings,
                    command.id
                  )
                  return (
                    <div key={command.id} className='px-4 py-3 space-y-3'>
                      <div className='flex items-start justify-between gap-3'>
                        <div className='min-w-0'>
                          <p className='text-sm font-medium text-text-primary truncate'>
                            {command.title}
                          </p>
                          <p className='text-xs text-text-secondary'>
                            {command.description}
                          </p>
                          <p className='text-[11px] text-text-tertiary font-mono mt-0.5'>
                            {command.id}
                          </p>
                        </div>
                        <Badge variant='outline'>{command.category}</Badge>
                      </div>

                      {command.contexts.map(context => {
                        const contextBindings = commandBindings.filter(
                          binding => binding.context === context
                        )
                        return (
                          <div key={`${command.id}:${context}`} className='space-y-2'>
                            <div className='flex items-center justify-between gap-2'>
                              <p className='text-xs text-text-tertiary'>
                                {formatContextLabel(context)}
                              </p>
                              <Button
                                size='sm'
                                variant='secondary'
                                onClick={() => {
                                  if (
                                    recording?.commandId === command.id &&
                                    recording?.context === context &&
                                    !recording?.replaceBindingId
                                  ) {
                                    setRecording(null)
                                    return
                                  }
                                  setRecording({
                                    commandId: command.id,
                                    context
                                  })
                                }}
                              >
                                {recording?.commandId === command.id &&
                                recording?.context === context
                                  ? 'Recording… (Ctrl+Esc to cancel)'
                                  : 'Add binding'}
                              </Button>
                            </div>
                            {contextBindings.length === 0 ? (
                              <p className='text-xs text-text-tertiary'>Unbound</p>
                            ) : (
                              <div className='flex flex-wrap items-center gap-2'>
                                {contextBindings.map(binding => {
                                  const conflicts =
                                    keybindings.getConflictsForBinding(binding)
                                  return (
                                    <div
                                      key={binding.id}
                                      className='inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-1'
                                    >
                                      <span className='text-[11px] font-mono text-text-secondary'>
                                        {formatKeySequence(binding.sequence)}
                                      </span>
                                      {conflicts.length > 0 ? (
                                        <span className='text-[11px] text-destructive'>
                                          conflict
                                        </span>
                                      ) : null}
                                      <Button
                                        size='sm'
                                        variant='ghost'
                                        className='h-6 px-1 text-[11px]'
                                        onClick={() => {
                                          if (recording?.replaceBindingId === binding.id) {
                                            setRecording(null)
                                            return
                                          }
                                          setRecording({
                                            commandId: command.id,
                                            context: binding.context,
                                            args: binding.args,
                                            replaceBindingId: binding.id
                                          })
                                        }}
                                      >
                                        Rebind
                                      </Button>
                                      <Button
                                        size='sm'
                                        variant='ghost'
                                        className='h-6 px-1 text-[11px]'
                                        onClick={() =>
                                          keybindings.removeBinding(binding.id)
                                        }
                                      >
                                        Remove
                                      </Button>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </div>
          </SettingsPanel>
        </SettingsSection>

        <SettingsSection
          title='Conflicts'
          description='Conflicts prevent deterministic command dispatch.'
        >
          <SettingsPanel>
            {keybindings.conflicts.length === 0 ? (
              <div className='px-4 py-3 text-sm text-text-secondary'>
                No conflicts detected.
              </div>
            ) : (
              <div className='divide-y divide-border'>
                {keybindings.conflicts.map(conflict => (
                  <div
                    key={`${conflict.kind}:${conflict.context}:${conflict.sequenceDisplay}:${conflict.bindingIds.join(',')}`}
                    className='px-4 py-3'
                  >
                    <p className='text-sm text-text-primary'>
                      {conflict.sequenceDisplay} in {formatContextLabel(conflict.context)}
                    </p>
                    <p className='text-xs text-text-secondary mt-0.5'>
                      {conflict.kind === 'reserved'
                        ? `Reserved chord (${conflict.reservedChordId ?? 'reserved'}).`
                        : `Bound to multiple commands: ${conflict.commandIds.join(', ')}.`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </SettingsPanel>
        </SettingsSection>

        <SettingsSection
          title='Import / Export'
          description='Share or restore keybinding overrides as JSON.'
        >
          <SettingsPanel>
            <div className='p-4 space-y-2'>
              <Textarea
                value={importPayload}
                onChange={event => setImportPayload(event.target.value)}
                rows={8}
                placeholder='Paste exported keybindings JSON here…'
              />
              <div className='flex flex-wrap items-center gap-2'>
                <Button
                  variant='secondary'
                  onClick={() => {
                    setImportPayload(keybindings.exportBindings())
                  }}
                >
                  Load export into textarea
                </Button>
                <Button variant='secondary' onClick={() => void copyExportToClipboard()}>
                  Copy export
                </Button>
                <Button
                  onClick={() => {
                    const result = keybindings.importBindings(importPayload)
                    if (!result.ok) {
                      toast.error(result.error ?? 'Failed to import keybindings')
                      return
                    }
                    toast.success('Keybindings imported')
                  }}
                >
                  Import JSON
                </Button>
                <Button
                  variant='secondary'
                  onClick={() => {
                    const payload = normalizePersistedWorkspaceKeybindingPayload(
                      props.auth.user?.workspaceKeybindings
                    )
                    if (!payload) {
                      toast.message('No keybindings saved in account yet.')
                      return
                    }
                    const serialized = JSON.stringify(payload)
                    const result = keybindings.importBindings(serialized)
                    if (!result.ok) {
                      toast.error(
                        result.error ?? 'Failed to load keybindings from account'
                      )
                      return
                    }
                    toast.success('Loaded keybindings from account')
                  }}
                >
                  Load from account
                </Button>
              </div>
            </div>
          </SettingsPanel>
        </SettingsSection>
      </div>
    </SettingsPage>
  )
}
