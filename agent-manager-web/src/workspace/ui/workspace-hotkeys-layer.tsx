import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { findLeafNode, listLeafIds } from '../layout'
import { useWorkspaceSelector, useWorkspaceStore } from '../store'
import { useWorkspaceKeybindings } from '../keybindings/use-workspace-keybindings'
import {
  hasWorkspaceKeybindingOverrides,
  loadWorkspaceKeybindingOverrides,
  normalizePersistedWorkspaceKeybindingPayload,
  sanitizeWorkspaceKeybindingOverrides
} from '../keybindings/persistence'
import type {
  WorkspaceCommandId,
  WorkspaceKeybinding,
  WorkspaceKeybindingOverrides
} from '../keybindings/types'
import { formatKeySequence } from '../keybindings/types'
import {
  WORKSPACE_CANCEL_STREAM_EVENT,
  WORKSPACE_OPEN_COORDINATOR_EVENT,
  WORKSPACE_PANE_ZOOM_TOGGLE_EVENT,
  WORKSPACE_RUN_COMMAND_EVENT,
  type WorkspaceRunCommandEventDetail,
  WORKSPACE_TOGGLE_ALL_COLLAPSIBLES_EVENT
} from '../keybindings/events'
import {
  WorkspaceCommandPalette,
  type WorkspaceCommandPaletteItem
} from './workspace-command-palette'
import { WorkspaceKeybindingsDialog } from './workspace-keybindings-dialog'

interface WorkspaceHotkeysLayerProps {
  readonly userId: string | null | undefined
  readonly accountKeybindings?: unknown
  readonly sessionsPanelOpen: boolean
  readonly onSetSessionsPanelOpen: (open: boolean) => void
  readonly onFocusSessionsFilter: () => void
}

function getWindowIndexArg (args: unknown): number | null {
  if (typeof args === 'number' && Number.isFinite(args)) {
    return Math.trunc(args)
  }
  if (typeof args !== 'object' || args === null) return null
  const index = (args as { index?: unknown }).index
  if (typeof index !== 'number' || !Number.isFinite(index)) return null
  return Math.trunc(index)
}

function toggleAllCollapsibles (): void {
  const collapsibles = document.querySelectorAll('[data-collapsible-toggle-all]')
  if (collapsibles.length === 0) return

  const openCollapsibles = document.querySelectorAll(
    '[data-collapsible-toggle-all][data-collapsible-open="true"]'
  )
  const nextOpen = openCollapsibles.length !== collapsibles.length
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_TOGGLE_ALL_COLLAPSIBLES_EVENT, {
      detail: { open: nextOpen }
    })
  )
}

function isEventTargetInsideCoordinatorDialog (
  target: EventTarget | null
): boolean {
  if (!(target instanceof Element)) return false
  return target.closest('[data-coordinator-dialog="true"]') !== null
}

function WorkspaceHotkeysLayerImpl (
  props: WorkspaceHotkeysLayerProps & {
    readonly initialOverrides: WorkspaceKeybindingOverrides
  }
) {
  const navigate = useNavigate()
  const store = useWorkspaceStore()

  const activeWindow = useWorkspaceSelector(
    state => state.windowsById[state.activeWindowId] ?? null
  )
  const windows = useWorkspaceSelector(state =>
    Object.keys(state.windowsById).map((windowId, index) => {
      const window = state.windowsById[windowId]
      return {
        id: windowId,
        index,
        name: window?.name ?? `Window ${index + 1}`,
        active: windowId === state.activeWindowId
      }
    })
  )
  const activePanelType = useWorkspaceSelector(state => {
    const window = state.windowsById[state.activeWindowId]
    if (!window || !window.focusedLeafId) return null
    const focusedLeaf = findLeafNode(window.root, window.focusedLeafId)
    if (!focusedLeaf) return null
    return window.panelsById[focusedLeaf.panelInstanceId]?.type ?? null
  })

  const [helpOpen, setHelpOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [windowSwitcherOpen, setWindowSwitcherOpen] = useState(false)
  const [renameDialogState, setRenameDialogState] = useState<{
    windowId: string
    initialName: string
  } | null>(null)
  const [renameInputValue, setRenameInputValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  const leafIds = useMemo(
    () => (activeWindow ? listLeafIds(activeWindow.root) : []),
    [activeWindow]
  )

  useEffect(() => {
    if (renameDialogState) {
      setRenameInputValue(renameDialogState.initialName)
      const timer = setTimeout(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [renameDialogState])

  const runCommand = useCallback(
    async (commandId: WorkspaceCommandId, args?: unknown): Promise<void> => {
      const state = store.getState()
      const activeWindowState = state.windowsById[state.activeWindowId] ?? null
      const focusedLeafId = activeWindowState?.focusedLeafId ?? null

      switch (commandId) {
        case 'keyboard.help.open': {
          setHelpOpen(true)
          return
        }
        case 'keyboard.palette.open': {
          setCommandPaletteOpen(true)
          return
        }
        case 'keyboard.mode.cancel': {
          setHelpOpen(false)
          setCommandPaletteOpen(false)
          setWindowSwitcherOpen(false)
          setRenameDialogState(null)
          window.dispatchEvent(new Event(WORKSPACE_CANCEL_STREAM_EVENT))
          return
        }
        case 'keyboard.leader.send': {
          toast.message('Leader pass-through is handled by focused terminal input.')
          return
        }
        case 'pane.split.down': {
          if (!focusedLeafId) return
          store.dispatch({ type: 'leaf/split', leafId: focusedLeafId, dir: 'col' })
          return
        }
        case 'pane.split.right': {
          if (!focusedLeafId) return
          store.dispatch({ type: 'leaf/split', leafId: focusedLeafId, dir: 'row' })
          return
        }
        case 'pane.split.down.full': {
          store.dispatch({ type: 'window/split-full', dir: 'col' })
          return
        }
        case 'pane.split.right.full': {
          store.dispatch({ type: 'window/split-full', dir: 'row' })
          return
        }
        case 'pane.close': {
          if (!focusedLeafId) return
          store.dispatch({ type: 'leaf/close', leafId: focusedLeafId })
          return
        }
        case 'pane.zoom.toggle': {
          if (!focusedLeafId) return
          window.dispatchEvent(
            new CustomEvent(WORKSPACE_PANE_ZOOM_TOGGLE_EVENT, {
              detail: { leafId: focusedLeafId }
            })
          )
          return
        }
        case 'pane.focus.next': {
          store.dispatch({ type: 'pane/focus-next' })
          return
        }
        case 'pane.focus.last': {
          store.dispatch({ type: 'pane/focus-prev' })
          return
        }
        case 'pane.focus.left':
        case 'pane.focus.right':
        case 'pane.focus.up':
        case 'pane.focus.down': {
          const direction =
            commandId === 'pane.focus.left'
              ? 'left'
              : commandId === 'pane.focus.right'
                ? 'right'
                : commandId === 'pane.focus.up'
                  ? 'up'
                  : 'down'
          store.dispatch({ type: 'pane/focus-direction', direction })
          return
        }
        case 'pane.number_mode.open': {
          return
        }
        case 'pane.swap.prev': {
          store.dispatch({ type: 'pane/swap-prev' })
          return
        }
        case 'pane.swap.next': {
          store.dispatch({ type: 'pane/swap-next' })
          return
        }
        case 'pane.rotate': {
          store.dispatch({ type: 'pane/rotate' })
          return
        }
        case 'pane.break_to_window': {
          store.dispatch({ type: 'pane/break-to-window' })
          return
        }
        case 'pane.resize.left':
        case 'pane.resize.right':
        case 'pane.resize.up':
        case 'pane.resize.down': {
          const direction =
            commandId === 'pane.resize.left'
              ? 'left'
              : commandId === 'pane.resize.right'
                ? 'right'
                : commandId === 'pane.resize.up'
                  ? 'up'
                  : 'down'
          store.dispatch({
            type: 'split/resize-direction',
            direction,
            amount: 0.02
          })
          return
        }
        case 'window.create': {
          store.dispatch({ type: 'window/create' })
          return
        }
        case 'window.close': {
          if (!activeWindowState) return
          store.dispatch({ type: 'window/close', windowId: activeWindowState.id })
          return
        }
        case 'window.rename': {
          if (!activeWindowState) return
          setRenameDialogState({
            windowId: activeWindowState.id,
            initialName: activeWindowState.name
          })
          return
        }
        case 'window.next': {
          store.dispatch({ type: 'window/activate-next' })
          return
        }
        case 'window.prev': {
          store.dispatch({ type: 'window/activate-prev' })
          return
        }
        case 'window.last': {
          store.dispatch({ type: 'window/activate-last' })
          return
        }
        case 'window.switcher.open': {
          setWindowSwitcherOpen(true)
          return
        }
        case 'window.select_index': {
          const index = getWindowIndexArg(args)
          if (index === null) return
          store.dispatch({ type: 'window/activate-index', index })
          return
        }
        case 'layout.cycle': {
          store.dispatch({ type: 'layout/cycle' })
          return
        }
        case 'layout.equalize': {
          store.dispatch({ type: 'layout/equalize' })
          return
        }
        case 'workspace.sessions_panel.toggle': {
          props.onSetSessionsPanelOpen(!props.sessionsPanelOpen)
          return
        }
        case 'workspace.sessions_panel.focus_filter': {
          props.onFocusSessionsFilter()
          return
        }
        case 'workspace.collapsibles.toggle_all': {
          toggleAllCollapsibles()
          return
        }
        case 'workspace.coordinator.open': {
          window.dispatchEvent(new Event(WORKSPACE_OPEN_COORDINATOR_EVENT))
          return
        }
        case 'workspace.stream.cancel': {
          window.dispatchEvent(new Event(WORKSPACE_CANCEL_STREAM_EVENT))
          return
        }
        case 'settings.open.general': {
          await navigate({ to: '/settings/general' })
          return
        }
        case 'settings.open.images': {
          await navigate({ to: '/settings/images' })
          return
        }
        case 'settings.open.keybindings': {
          await navigate({ to: '/settings/keybindings' })
          return
        }
        default: {
          return
        }
      }
    },
    [props, store]
  )

  const keybindings = useWorkspaceKeybindings({
    userId: props.userId,
    initialOverrides: props.initialOverrides,
    persistOverrides: false,
    workspaceActive: true,
    activePanelType: activePanelType ?? undefined,
    onPaneNumberSelect: index => {
      const state = store.getState()
      const active = state.windowsById[state.activeWindowId] ?? null
      if (!active) return
      const paneLeafIds = listLeafIds(active.root)
      const targetLeafId = paneLeafIds[index]
      if (!targetLeafId) return
      store.dispatch({ type: 'leaf/focus', leafId: targetLeafId })
    },
    onUnknownPrefix: sequence => {
      toast.message(`Unbound: ${formatKeySequence(sequence)}`)
    },
    onCommand: async request => {
      await runCommand(request.commandId, request.args ?? request.binding?.args)
    }
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEventTargetInsideCoordinatorDialog(event.target)) return
      keybindings.handleKeyDown(event)
    }
    const onRunWorkspaceCommand = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceRunCommandEventDetail>).detail
      if (!detail || typeof detail !== 'object') return
      const commandId = detail.commandId
      if (typeof commandId !== 'string') return
      if (typeof detail.respond !== 'function' || typeof detail.reject !== 'function') {
        return
      }

      void (async () => {
        try {
          await runCommand(commandId as WorkspaceCommandId, detail.args)
          detail.respond({ handled: true })
        } catch (error) {
          detail.reject(error)
        }
      })()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener(WORKSPACE_RUN_COMMAND_EVENT, onRunWorkspaceCommand)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener(WORKSPACE_RUN_COMMAND_EVENT, onRunWorkspaceCommand)
    }
  }, [keybindings.handleKeyDown, runCommand])

  const shortcutsByCommandId = useMemo(() => {
    const map = new Map<string, string>()
    const leaderDisplay = formatKeySequence(keybindings.leaderSequence)
    const formatBindingDisplay = (binding: WorkspaceKeybinding): string => {
      const sequenceDisplay = formatKeySequence(binding.sequence)
      if (binding.context === 'workspace.prefix') {
        return `${leaderDisplay} ${sequenceDisplay}`
      }
      return sequenceDisplay
    }
    for (const binding of keybindings.bindings) {
      if (map.has(binding.commandId)) continue
      map.set(binding.commandId, formatBindingDisplay(binding))
    }
    return map
  }, [keybindings.bindings, keybindings.leaderSequence])

  const commandPaletteItems = useMemo<WorkspaceCommandPaletteItem[]>(
    () =>
      [...keybindings.commands]
        .sort((a, b) => {
          if (a.category !== b.category) {
            return a.category.localeCompare(b.category)
          }
          return a.title.localeCompare(b.title)
        })
        .map(command => ({
          id: command.id,
          title: command.title,
          description: command.description,
          detail: shortcutsByCommandId.get(command.id) ?? '',
          keywords: [command.id, command.category]
        })),
    [keybindings.commands, shortcutsByCommandId]
  )

  const windowPaletteItems = useMemo<WorkspaceCommandPaletteItem[]>(
    () =>
      windows.map(window => ({
        id: window.id,
        title: `${window.index}: ${window.name}`,
        description: window.active ? 'Active window' : 'Switch to this window',
        detail: String(window.index),
        keywords: [window.name, String(window.index)]
      })),
    [windows]
  )

  const bindingSummaryByWindowId = useMemo(() => {
    const summary = new Map<string, string>()
    const leaderDisplay = formatKeySequence(keybindings.leaderSequence)
    for (const window of windows) {
      const binding = keybindings.bindings.find(
        candidate =>
          candidate.commandId === 'window.select_index' &&
          getWindowIndexArg(candidate.args) === window.index
      )
      if (!binding) continue
      const sequenceDisplay = formatKeySequence(binding.sequence)
      summary.set(
        window.id,
        binding.context === 'workspace.prefix'
          ? `${leaderDisplay} ${sequenceDisplay}`
          : sequenceDisplay
      )
    }
    return summary
  }, [keybindings.bindings, keybindings.leaderSequence, windows])

  return (
    <>
      <WorkspaceKeybindingsDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        commands={keybindings.commands}
        bindings={keybindings.bindings}
        onOpenSettings={() => {
          void navigate({ to: '/settings/keybindings' })
        }}
      />

      <WorkspaceCommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        title='Key Bindings'
        description='Search and run workspace key binding commands.'
        placeholder='Type to search key bindings…'
        items={commandPaletteItems}
        onSelectItem={item => {
          const commandId = item.id as WorkspaceCommandId
          void (async () => {
            const handled = await keybindings.runCommand(commandId)
            if (!handled) {
              toast.error(`Failed to run command: ${item.title}`)
            }
          })()
        }}
      />

      <WorkspaceCommandPalette
        open={windowSwitcherOpen}
        onOpenChange={setWindowSwitcherOpen}
        title='Window Switcher'
        description='Jump directly to a workspace window.'
        placeholder='Type a window name or index…'
        items={windowPaletteItems.map(item => ({
          ...item,
          detail: bindingSummaryByWindowId.get(item.id) ?? item.detail
        }))}
        onSelectItem={item => {
          const targetWindow = windows.find(window => window.id === item.id)
          if (!targetWindow) return
          store.dispatch({
            type: 'window/activate-index',
            index: targetWindow.index
          })
        }}
      />

      <Dialog
        open={renameDialogState !== null}
        onOpenChange={open => {
          if (!open) setRenameDialogState(null)
        }}
      >
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle className='text-sm'>Rename window</DialogTitle>
            <DialogDescription className='text-xs'>
              Enter a new name for this window.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <Input
              ref={renameInputRef}
              value={renameInputValue}
              onChange={e => setRenameInputValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && renameDialogState) {
                  const nextName = renameInputValue.trim()
                  if (nextName.length > 0) {
                    store.dispatch({
                      type: 'window/rename',
                      windowId: renameDialogState.windowId,
                      name: nextName
                    })
                    setRenameDialogState(null)
                  }
                }
              }}
              placeholder='Window name'
            />
          </div>
          <DialogFooter className='gap-2 sm:gap-0'>
            <Button
              variant='outline'
              onClick={() => setRenameDialogState(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!renameDialogState) return
                const nextName = renameInputValue.trim()
                if (nextName.length === 0) return
                store.dispatch({
                  type: 'window/rename',
                  windowId: renameDialogState.windowId,
                  name: nextName
                })
                setRenameDialogState(null)
              }}
              disabled={renameInputValue.trim().length === 0}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {keybindings.engineState.mode === 'prefix' ? (
        <div className='pointer-events-none fixed top-3 left-1/2 z-40 -translate-x-1/2 rounded border border-border bg-surface-1 px-2.5 py-1 text-[11px] font-mono text-text-secondary shadow-sm'>
          {formatKeySequence(keybindings.leaderSequence)} …
        </div>
      ) : null}

      {keybindings.engineState.mode === 'pane_number' ? (
        <Dialog open onOpenChange={open => !open && keybindings.cancelModes()}>
          <DialogContent className='max-w-md'>
            <DialogHeader>
              <DialogTitle className='text-sm'>Select Pane</DialogTitle>
              <DialogDescription className='text-xs'>
                Press a digit to focus a pane.
              </DialogDescription>
            </DialogHeader>
            <div className='space-y-2'>
              {leafIds.slice(0, 10).map((leafId, index) => {
                const leaf = activeWindow
                  ? findLeafNode(activeWindow.root, leafId)
                  : null
                const panel = leaf
                  ? activeWindow?.panelsById[leaf.panelInstanceId]
                  : null
                const isFocused = activeWindow?.focusedLeafId === leafId
                return (
                  <Button
                    key={leafId}
                    variant={isFocused ? 'default' : 'secondary'}
                    className='w-full justify-start gap-3'
                    onClick={() => {
                      store.dispatch({ type: 'leaf/focus', leafId })
                      keybindings.cancelModes()
                    }}
                  >
                    <span className='font-mono text-xs opacity-80'>{index}</span>
                    <span className='truncate'>{panel?.type ?? 'panel'}</span>
                  </Button>
                )
              })}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

export function WorkspaceHotkeysLayer (props: WorkspaceHotkeysLayerProps) {
  const accountOverrides = useMemo(
    () => sanitizeWorkspaceKeybindingOverrides(props.accountKeybindings),
    [props.accountKeybindings]
  )
  const initialOverrides = useMemo(() => {
    if (hasWorkspaceKeybindingOverrides(accountOverrides)) return accountOverrides
    return loadWorkspaceKeybindingOverrides(props.userId)
  }, [accountOverrides, props.userId])
  const accountKey = useMemo(() => {
    const payload = normalizePersistedWorkspaceKeybindingPayload(
      props.accountKeybindings
    )
    return payload ? JSON.stringify(payload) : 'none'
  }, [props.accountKeybindings])

  return (
    <WorkspaceHotkeysLayerImpl
      key={`${props.userId ?? 'anonymous'}:${accountKey}`}
      {...props}
      initialOverrides={initialOverrides}
    />
  )
}
