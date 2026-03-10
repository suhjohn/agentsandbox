import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type React from 'react'
import { createPortal } from 'react-dom'
import { PickerPopover } from '@/components/ui/picker-popover'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { GripVertical, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  WORKSPACE_PANE_ZOOM_TOGGLE_EVENT,
  type WorkspacePaneZoomToggleEventDetail
} from '../keybindings/events'
import type { LayoutNode, LeafNode, SplitNode } from '../types'
import { clampRatio } from '../layout'
import { getPanelDefinition, listPanelDefinitions } from '../panels/registry'
import type { PanelOpenPlacement, PanelProps } from '../panels/types'
import { useWorkspaceSelector, useWorkspaceStore } from '../store'

const WORKSPACE_DND_MIME = 'application/x-agent-manager-web-workspace-drag'
const WORKSPACE_DRAG_STATE_EVENT = 'agent-manager-web:workspace-drag-state'

type DropPlacement = 'left' | 'right' | 'top' | 'bottom' | 'center'

type PaneDragPayload = {
  readonly kind: 'pane'
  readonly windowId: string
  readonly fromLeafId: string
}

let activeWorkspaceDrag: PaneDragPayload | null = null
let workspaceDragCleanupInstalled = false

function installWorkspaceDragCleanup (): void {
  if (workspaceDragCleanupInstalled) return
  if (typeof window === 'undefined') return
  workspaceDragCleanupInstalled = true
  const clear = () => {
    if (activeWorkspaceDrag !== null) {
      setActiveWorkspaceDrag(null)
    }
  }
  window.addEventListener('dragend', clear)
  window.addEventListener('drop', clear)
}

function setActiveWorkspaceDrag (payload: PaneDragPayload | null): void {
  if (activeWorkspaceDrag === payload) return
  if (payload !== null) installWorkspaceDragCleanup()
  activeWorkspaceDrag = payload
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_DRAG_STATE_EVENT, {
      detail: { active: payload !== null }
    })
  )
}

const panelDefs = listPanelDefinitions()

type PanelSlotContextValue = {
  readonly setSlot: (
    panelInstanceId: string,
    element: HTMLDivElement | null
  ) => void
  readonly slotsByPanelInstanceId: ReadonlyMap<string, HTMLDivElement>
}

type LeafPanelTarget = {
  readonly leafId: string
  readonly panelInstanceId: string
}

const PanelSlotContext = createContext<PanelSlotContextValue | null>(null)
const PaneExpandShortcutContext = createContext<string | null>(null)

function usePanelSlots (): PanelSlotContextValue {
  const ctx = useContext(PanelSlotContext)
  if (!ctx) {
    throw new Error('PanelSlotContext is missing')
  }
  return ctx
}

function listLeafPanelTargets (
  node: LayoutNode,
  out: LeafPanelTarget[] = []
): LeafPanelTarget[] {
  if (node.kind === 'leaf') {
    out.push({ leafId: node.id, panelInstanceId: node.panelInstanceId })
    return out
  }
  listLeafPanelTargets(node.a, out)
  listLeafPanelTargets(node.b, out)
  return out
}

function readWorkspaceDragPayload (e: React.DragEvent): PaneDragPayload | null {
  const raw = e.dataTransfer.getData(WORKSPACE_DND_MIME)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const v = parsed as Record<string, unknown>
    if (
      v.kind === 'pane' &&
      typeof v.windowId === 'string' &&
      typeof v.fromLeafId === 'string'
    ) {
      return {
        kind: 'pane',
        windowId: v.windowId,
        fromLeafId: v.fromLeafId
      }
    }
    return null
  } catch {
    return null
  }
}

function resolveDirectionalPlacement (
  rect: DOMRect,
  clientX: number,
  clientY: number
): DropPlacement {
  if (rect.width <= 0 || rect.height <= 0) return 'right'
  const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
  const y = Math.max(0, Math.min(rect.height, clientY - rect.top))
  const xRatio = x / rect.width
  const yRatio = y / rect.height
  const horizontalStrength = Math.abs(xRatio - 0.5)
  const verticalStrength = Math.abs(yRatio - 0.5)
  if (horizontalStrength >= verticalStrength) {
    return xRatio < 0.5 ? 'left' : 'right'
  }
  return yRatio < 0.5 ? 'top' : 'bottom'
}

function resolveEdgePlacement (
  rect: DOMRect,
  clientX: number,
  clientY: number,
  threshold = 0.2
): DropPlacement | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  const xRatio = (clientX - rect.left) / rect.width
  const yRatio = (clientY - rect.top) / rect.height
  const clampedX = Math.max(0, Math.min(1, xRatio))
  const clampedY = Math.max(0, Math.min(1, yRatio))

  const candidates: Array<{
    readonly placement: DropPlacement
    readonly score: number
  }> = []
  if (clampedX <= threshold)
    candidates.push({ placement: 'left', score: clampedX })
  if (clampedX >= 1 - threshold) {
    candidates.push({ placement: 'right', score: 1 - clampedX })
  }
  if (clampedY <= threshold)
    candidates.push({ placement: 'top', score: clampedY })
  if (clampedY >= 1 - threshold) {
    candidates.push({ placement: 'bottom', score: 1 - clampedY })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.score - b.score)
  return candidates[0]!.placement
}

function resolveCenterPlacement (
  rect: DOMRect,
  clientX: number,
  clientY: number,
  threshold = 0.18
): DropPlacement | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  const xRatio = (clientX - rect.left) / rect.width
  const yRatio = (clientY - rect.top) / rect.height
  const clampedX = Math.max(0, Math.min(1, xRatio))
  const clampedY = Math.max(0, Math.min(1, yRatio))
  const centerDistanceX = Math.abs(clampedX - 0.5)
  const centerDistanceY = Math.abs(clampedY - 0.5)

  if (centerDistanceX <= threshold && centerDistanceY <= threshold) {
    return 'center'
  }
  return null
}

function resolveDropPlacement (
  leafRect: DOMRect,
  clientX: number,
  clientY: number
): DropPlacement {
  const edgePlacement = resolveEdgePlacement(leafRect, clientX, clientY)
  if (edgePlacement) return edgePlacement
  const centerPlacement = resolveCenterPlacement(leafRect, clientX, clientY)
  if (centerPlacement) return centerPlacement
  return resolveDirectionalPlacement(leafRect, clientX, clientY)
}

function createPanelRuntime (
  store: ReturnType<typeof useWorkspaceStore>,
  leafId: string,
  panelInstanceId: string
) {
  return {
    leafId,
    now: () => performance.now(),
    replaceSelf: (panelType: string, config?: unknown) => {
      store.dispatch({
        type: 'panel/type',
        panelInstanceId,
        panelType
      })
      if (typeof config !== 'undefined') {
        store.dispatch({
          type: 'panel/config',
          panelInstanceId,
          updater: () => config
        })
      }
    },
    openPanel: (
      panelType: string,
      config?: unknown,
      options?: { readonly placement?: PanelOpenPlacement; readonly forceNew?: boolean }
    ) => {
      store.dispatch({
        type: 'panel/open',
        fromLeafId: leafId,
        placement: options?.placement ?? 'self',
        panelType,
        config,
        forceNew: options?.forceNew
      })
    }
  }
}

function LayoutNodeBranchImpl (props: { readonly node: LayoutNode }) {
  if (props.node.kind === 'leaf') {
    return <LeafView leaf={props.node} />
  }
  return <SplitView node={props.node} />
}

const LayoutNodeBranch = memo(
  LayoutNodeBranchImpl,
  (prev, next) => prev.node === next.node
)

function LayoutNodeViewImpl (props: {
  readonly node: LayoutNode
  readonly paneExpandShortcut?: string | null
}) {
  const [slotsByPanelInstanceId, setSlotsByPanelInstanceId] = useState<
    ReadonlyMap<string, HTMLDivElement>
  >(() => new Map())

  const setSlot = useCallback(
    (panelInstanceId: string, element: HTMLDivElement | null) => {
      setSlotsByPanelInstanceId(prev => {
        const current = prev.get(panelInstanceId) ?? null
        if (current === element) return prev

        const next = new Map(prev)
        if (element) {
          next.set(panelInstanceId, element)
        } else {
          next.delete(panelInstanceId)
        }
        return next
      })
    },
    []
  )

  const leafPanels = useMemo(
    () => listLeafPanelTargets(props.node),
    [props.node]
  )

  const slotContext = useMemo<PanelSlotContextValue>(
    () => ({ setSlot, slotsByPanelInstanceId }),
    [setSlot, slotsByPanelInstanceId]
  )

  return (
    <TooltipProvider delayDuration={250}>
      <PaneExpandShortcutContext.Provider
        value={props.paneExpandShortcut ?? null}
      >
        <PanelSlotContext.Provider value={slotContext}>
          <LayoutNodeBranch node={props.node} />
          <PanelPortalLayer leafPanels={leafPanels} />
        </PanelSlotContext.Provider>
      </PaneExpandShortcutContext.Provider>
    </TooltipProvider>
  )
}

export const LayoutNodeView = memo(
  LayoutNodeViewImpl,
  (prev, next) =>
    prev.node === next.node &&
    prev.paneExpandShortcut === next.paneExpandShortcut
)

function SplitViewImpl (props: { readonly node: SplitNode }) {
  const store = useWorkspaceStore()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const lastRatioRef = useRef<number>(props.node.ratio)
  const draggingRef = useRef(false)
  const [isResizing, setIsResizing] = useState(false)

  const isRow = props.node.dir === 'row'
  const template = `${props.node.ratio}fr ${1 - props.node.ratio}fr`

  const setTemplate = (ratio: number) => {
    const el = containerRef.current
    if (!el) return
    const nextTemplate = `${ratio}fr ${1 - ratio}fr`
    if (isRow) el.style.gridTemplateColumns = nextTemplate
    else el.style.gridTemplateRows = nextTemplate
    el.style.setProperty('--workspace-split-ratio', String(ratio))
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-full w-full grid min-h-0 min-w-0 group gap-px bg-border',
        isRow ? 'grid-cols-[1fr_1fr]' : 'grid-rows-[1fr_1fr]'
      )}
      style={
        isRow
          ? ({
              gridTemplateColumns: template,
              ['--workspace-split-ratio' as string]: String(props.node.ratio)
            } as React.CSSProperties)
          : ({
              gridTemplateRows: template,
              ['--workspace-split-ratio' as string]: String(props.node.ratio)
            } as React.CSSProperties)
      }
    >
      <div className='min-h-0 min-w-0'>
        <LayoutNodeBranch node={props.node.a} />
      </div>

      <div
        role='separator'
        className={cn(
          'absolute z-20 touch-none select-none',
          isRow
            ? 'inset-y-0 w-3 -translate-x-1/2 cursor-col-resize'
            : 'inset-x-0 h-3 -translate-y-1/2 cursor-row-resize'
        )}
        style={
          isRow
            ? { left: 'calc(var(--workspace-split-ratio) * 100%)' }
            : { top: 'calc(var(--workspace-split-ratio) * 100%)' }
        }
        onPointerDown={e => {
          const el = containerRef.current
          if (!el) return
          e.preventDefault()
          e.stopPropagation()
          draggingRef.current = true
          setIsResizing(true)
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          const rect = el.getBoundingClientRect()
          const compute = (clientX: number, clientY: number) => {
            if (isRow) {
              const ratio = (clientX - rect.left) / rect.width
              return clampRatio(ratio)
            }
            const ratio = (clientY - rect.top) / rect.height
            return clampRatio(ratio)
          }
          const next = compute(e.clientX, e.clientY)
          lastRatioRef.current = next
          setTemplate(next)
        }}
        onPointerMove={e => {
          if (!draggingRef.current) return
          const el = containerRef.current
          if (!el) return
          const rect = el.getBoundingClientRect()
          const next = clampRatio(
            isRow
              ? (e.clientX - rect.left) / rect.width
              : (e.clientY - rect.top) / rect.height
          )
          lastRatioRef.current = next
          setTemplate(next)
        }}
        onPointerUp={e => {
          if (!draggingRef.current) return
          draggingRef.current = false
          setIsResizing(false)
          try {
            ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
          } catch {
            // ignore
          }
          store.dispatch({
            type: 'split/ratio',
            splitId: props.node.id,
            ratio: lastRatioRef.current
          })
        }}
        onPointerCancel={e => {
          if (!draggingRef.current) return
          draggingRef.current = false
          setIsResizing(false)
          try {
            ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
          } catch {
            // ignore
          }
          store.dispatch({
            type: 'split/ratio',
            splitId: props.node.id,
            ratio: lastRatioRef.current
          })
        }}
      >
        <div
          className={cn(
            'absolute transition-opacity',
            isRow
              ? 'inset-y-0 left-1/2 -translate-x-1/2 w-[2px]'
              : 'inset-x-0 top-1/2 -translate-y-1/2 h-[2px]',
            isResizing
              ? 'opacity-100 bg-border'
              : 'opacity-0 group-hover:opacity-100 bg-border/80'
          )}
        />
      </div>

      <div className='min-h-0 min-w-0'>
        <LayoutNodeBranch node={props.node.b} />
      </div>
    </div>
  )
}

const SplitView = memo(SplitViewImpl, (prev, next) => prev.node === next.node)

function getPanelTitle (panelType: string, config: unknown): string {
  const def = getPanelDefinition(panelType)
  if (!def) return panelType
  if (!def.getTitle) return def.title
  try {
    const derived = def.getTitle(config as never)
    return typeof derived === 'string' && derived.trim().length > 0
      ? derived
      : def.title
  } catch {
    return def.title
  }
}

function LeafViewImpl (props: { readonly leaf: LeafNode }) {
  const { setSlot } = usePanelSlots()
  const store = useWorkspaceStore()
  const paneExpandShortcut = useContext(PaneExpandShortcutContext)
  const leafRef = useRef<HTMLDivElement | null>(null)
  const leafId = props.leaf.id
  const panelInstanceId = props.leaf.panelInstanceId

  const activeWindowId = useWorkspaceSelector(s => s.activeWindowId)
  const isFocused = useWorkspaceSelector(s => {
    const window = s.windowsById[s.activeWindowId]
    return window?.focusedLeafId === leafId
  })
  const panel = useWorkspaceSelector(s => {
    const window = s.windowsById[s.activeWindowId]
    return window?.panelsById[panelInstanceId] ?? null
  })

  const panelDef = useMemo(
    () => (panel ? getPanelDefinition(panel.type) : null),
    [panel]
  )
  const HeaderComponent = panelDef?.HeaderComponent ?? null
  const ActionsComponent = panelDef?.ActionsComponent ?? null

  const headerRuntime = useMemo(
    () => createPanelRuntime(store, leafId, panelInstanceId),
    [store, leafId, panelInstanceId]
  )
  const setPanelConfig = useCallback(
    (updater: (prev: unknown) => unknown) =>
      store.dispatch({
        type: 'panel/config',
        panelInstanceId,
        updater: prev => updater(prev)
      }),
    [store, panelInstanceId]
  )

  const [dragOver, setDragOver] = useState(false)
  const [dropPlacement, setDropPlacement] = useState<DropPlacement | null>(null)
  const [isWorkspaceDragActive, setIsWorkspaceDragActive] = useState(
    activeWorkspaceDrag !== null
  )
  const dragDepthRef = useRef(0)
  const [panelPickerOpen, setPanelPickerOpen] = useState(false)
  const [headerPopoverOpen, setHeaderPopoverOpen] = useState(false)
  const [actionsPopoverOpen, setActionsPopoverOpen] = useState(false)
  const [panelPickerQuery, setPanelPickerQuery] = useState('')
  const [isHeaderHovered, setIsHeaderHovered] = useState(false)
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false)
  const [leafSlotElement, setLeafSlotElement] = useState<HTMLDivElement | null>(
    null
  )
  const [dialogSlotElement, setDialogSlotElement] =
    useState<HTMLDivElement | null>(null)
  const lastPointerFocusAtRef = useRef<number>(-1)
  const markPointerDrivenFocus = useCallback(() => {
    lastPointerFocusAtRef.current = performance.now()
  }, [])

  const showControls =
    isHeaderHovered ||
    panelPickerOpen ||
    headerPopoverOpen ||
    actionsPopoverOpen

  useEffect(() => {
    if (!isFocused) return
    // Pointer-driven pane focus should not steal focus from clicked content.
    if (
      lastPointerFocusAtRef.current > 0 &&
      performance.now() - lastPointerFocusAtRef.current < 250
    ) {
      return
    }
    if (!panel || !panelDef?.getAutoFocusSelector) return
    const selector = panelDef.getAutoFocusSelector(panel.config)
    if (!selector) return

    const root = leafRef.current
    if (!root) return

    const isDisabled = (el: HTMLElement): boolean => {
      if ('disabled' in el) {
        return Boolean(
          (
            el as
              | HTMLInputElement
              | HTMLTextAreaElement
              | HTMLButtonElement
              | HTMLSelectElement
          ).disabled
        )
      }
      return el.getAttribute('aria-disabled') === 'true'
    }
    const tryFocus = (): boolean => {
      const activePanelRoot = root.querySelector<HTMLElement>(
        "[data-panel-active='true']"
      )
      if (!activePanelRoot) return false

      const target = activePanelRoot.querySelector<HTMLElement>(selector)
      if (!target) return false

      const active = document.activeElement as HTMLElement | null
      if (active === target) return true
      if (isDisabled(target)) return false

      target.focus({ preventScroll: true })
      return document.activeElement === target
    }

    if (tryFocus()) return

    const observer = new MutationObserver(() => {
      if (tryFocus()) observer.disconnect()
    })
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled']
    })

    return () => observer.disconnect()
  }, [isFocused, panel, panelDef])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onDragState = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly active?: boolean }>)
        .detail
      const active = detail?.active === true
      setIsWorkspaceDragActive(active)
      if (!active) {
        dragDepthRef.current = 0
        setDragOver(false)
        setDropPlacement(null)
      }
    }
    window.addEventListener(
      WORKSPACE_DRAG_STATE_EVENT,
      onDragState as EventListener
    )
    return () => {
      window.removeEventListener(
        WORKSPACE_DRAG_STATE_EVENT,
        onDragState as EventListener
      )
    }
  }, [])

  const canAcceptDrop = (payload: PaneDragPayload | null): boolean => {
    if (!payload) return false
    if (payload.windowId !== activeWindowId) return false
    return payload.fromLeafId !== leafId
  }

  const getCurrentPayload = (e: React.DragEvent): PaneDragPayload | null => {
    return activeWorkspaceDrag ?? readWorkspaceDragPayload(e)
  }

  useEffect(() => {
    setSlot(
      panelInstanceId,
      isFullscreenOpen ? dialogSlotElement : leafSlotElement
    )
  }, [
    dialogSlotElement,
    isFullscreenOpen,
    leafSlotElement,
    panelInstanceId,
    setSlot
  ])

  useEffect(
    () => () => {
      setSlot(panelInstanceId, null)
    },
    [panelInstanceId, setSlot]
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onTogglePaneZoom = (event: Event) => {
      const detail = (
        event as CustomEvent<WorkspacePaneZoomToggleEventDetail | undefined>
      ).detail
      const targetLeafId =
        typeof detail?.leafId === 'string' ? detail.leafId : null
      if (targetLeafId && targetLeafId !== leafId) return
      if (!targetLeafId && !isFocused) return
      setIsFullscreenOpen(prev => !prev)
    }
    window.addEventListener(
      WORKSPACE_PANE_ZOOM_TOGGLE_EVENT,
      onTogglePaneZoom as EventListener
    )
    return () => {
      window.removeEventListener(
        WORKSPACE_PANE_ZOOM_TOGGLE_EVENT,
        onTogglePaneZoom as EventListener
      )
    }
  }, [isFocused, leafId])

  return (
    <div
      ref={leafRef}
      data-workspace-leaf-id={leafId}
      data-workspace-leaf-focused={isFocused ? 'true' : 'false'}
      className={cn(
        'relative h-full w-full min-h-0 min-w-0 flex flex-col bg-surface-1',
        dragOver && 'ring-2 ring-ring/60'
      )}
      onPointerDown={() => {
        markPointerDrivenFocus()
        store.dispatch({ type: 'leaf/focus', leafId })
      }}
      onDragEnter={e => {
        const payload = getCurrentPayload(e)
        if (!canAcceptDrop(payload)) return
        dragDepthRef.current += 1
        const rect = e.currentTarget.getBoundingClientRect()
        const placement = resolveDropPlacement(rect, e.clientX, e.clientY)
        setDragOver(true)
        setDropPlacement(placement)
      }}
      onDragOver={e => {
        const payload = getCurrentPayload(e)
        if (!canAcceptDrop(payload)) {
          setDragOver(false)
          setDropPlacement(null)
          return
        }
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const rect = e.currentTarget.getBoundingClientRect()
        const placement = resolveDropPlacement(rect, e.clientX, e.clientY)
        setDragOver(true)
        if (dropPlacement !== placement) setDropPlacement(placement)
      }}
      onDragLeave={() => {
        dragDepthRef.current -= 1
        if (dragDepthRef.current <= 0) {
          dragDepthRef.current = 0
          setDragOver(false)
          setDropPlacement(null)
        }
      }}
      onDrop={e => {
        const payload = getCurrentPayload(e)
        if (!canAcceptDrop(payload)) return
        e.preventDefault()
        dragDepthRef.current = 0
        setDragOver(false)
        const placement =
          dropPlacement ??
          resolveDropPlacement(
            e.currentTarget.getBoundingClientRect(),
            e.clientX,
            e.clientY
          )
        setDropPlacement(null)
        setActiveWorkspaceDrag(null)

        store.dispatch({
          type: 'pane/move',
          fromLeafId: payload!.fromLeafId,
          toLeafId: leafId,
          placement
        })
      }}
    >
      {dragOver && dropPlacement ? (
        <div className='pointer-events-none absolute inset-0 z-30'>
          <div className='absolute inset-0 rounded-sm border border-blue-500/40 bg-blue-500/5' />
          {dropPlacement === 'center' ? (
            <div className='absolute inset-1 rounded-sm border-2 border-blue-500/70 bg-blue-500/15' />
          ) : null}
          {dropPlacement === 'left' ? (
            <div className='absolute inset-y-1 left-1 right-1/2 rounded-sm border-2 border-blue-500/70 bg-blue-500/15' />
          ) : null}
          {dropPlacement === 'right' ? (
            <div className='absolute inset-y-1 right-1 left-1/2 rounded-sm border-2 border-blue-500/70 bg-blue-500/15' />
          ) : null}
          {dropPlacement === 'top' ? (
            <div className='absolute inset-x-1 top-1 bottom-1/2 rounded-sm border-2 border-blue-500/70 bg-blue-500/15' />
          ) : null}
          {dropPlacement === 'bottom' ? (
            <div className='absolute inset-x-1 bottom-1 top-1/2 rounded-sm border-2 border-blue-500/70 bg-blue-500/15' />
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          'relative border-b border-border',
          isFocused ? 'bg-surface-4' : 'bg-surface-1'
        )}
        onMouseEnter={() => setIsHeaderHovered(true)}
        onMouseLeave={() => {
          setIsHeaderHovered(false)
          if (!panelPickerOpen && !headerPopoverOpen) {
            setPanelPickerQuery('')
          }
        }}
      >
        <div className='flex items-center gap-1 px-1 py-0.5 min-w-0'>
          <button
            type='button'
            draggable
            data-no-drag='true'
            className={cn(
              'h-6 w-6 shrink-0 rounded-md !cursor-grab hover:!cursor-grab active:!cursor-grabbing grid place-items-center',
              isFocused
                ? 'text-info hover:text-info'
                : 'text-text-quaternary hover:text-text-secondary'
            )}
            title='Drag panel'
            aria-label='Drag panel'
            onDragStart={e => {
              e.dataTransfer.effectAllowed = 'move'
              const payload: PaneDragPayload = {
                kind: 'pane',
                windowId: activeWindowId,
                fromLeafId: leafId
              }
              setActiveWorkspaceDrag(payload)
              const serialized = JSON.stringify(payload)
              e.dataTransfer.setData('text/plain', serialized)
              e.dataTransfer.setData(WORKSPACE_DND_MIME, serialized)
            }}
            onDragEnd={() => {
              setActiveWorkspaceDrag(null)
              dragDepthRef.current = 0
              setDragOver(false)
              setDropPlacement(null)
            }}
          >
            <GripVertical className='h-3.5 w-3.5' />
          </button>

          <div className='min-w-0 flex-1 text-xs text-text-secondary truncate px-2'>
            {panel ? getPanelTitle(panel.type, panel.config) : 'Panel'}
          </div>

          {ActionsComponent && panel ? (
            <ActionsComponent
              config={panel.config}
              setConfig={setPanelConfig}
              runtime={headerRuntime}
              onPopoverOpenChange={setActionsPopoverOpen}
            />
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='inline-flex'>
                <Button
                  type='button'
                  variant='icon'
                  size='icon'
                  className='h-6 w-6 shrink-0'
                  title='Toggle expand'
                  aria-label='Toggle expand'
                  disabled={!panel}
                  onClick={() => setIsFullscreenOpen(true)}
                >
                  <Maximize2 className='h-3.5 w-3.5' />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side='bottom' align='end'>
              <div className='flex flex-col gap-1'>
                <span className='text-xs text-text-primary'>Toggle expand</span>
                {paneExpandShortcut ? (
                  <span className='text-[11px] font-mono text-text-tertiary'>
                    {paneExpandShortcut}
                  </span>
                ) : null}
              </div>
            </TooltipContent>
          </Tooltip>
        </div>

        {showControls ? (
          <div className='absolute left-0 right-0 top-full z-20 flex items-center gap-2 px-2 py-0.5 min-w-0 border-b shadow-xl shadow-black/30 bg-surface-3'>
            <PickerPopover
              valueId={panel?.type ?? 'coordinator'}
              valueLabel={panelDef?.title ?? 'Select panel'}
              placeholder='Select a panel'
              queryPlaceholder='Search panels…'
              query={panelPickerQuery}
              onQueryChange={setPanelPickerQuery}
              open={panelPickerOpen}
              onOpenChange={setPanelPickerOpen}
              items={panelDefs.map(def => ({ id: def.type, title: def.title }))}
              sectionLabel='Panels'
              loading={false}
              loadingMore={false}
              error={null}
              hasMore={false}
              onLoadMore={() => {}}
              onSelect={panelType =>
                store.dispatch({
                  type: 'panel/type',
                  panelInstanceId,
                  panelType
                })
              }
              emptyLabel='No panels available.'
              showSearch={false}
              showFooter={false}
            />
            {HeaderComponent && panel ? (
              <span className='text-text-tertiary text-xs select-none'>/</span>
            ) : null}
            {HeaderComponent && panel ? (
              <div className='flex items-center gap-2 flex-1 min-w-0 overflow-hidden'>
                <HeaderComponent
                  config={panel.config}
                  setConfig={setPanelConfig}
                  runtime={headerRuntime}
                  onPopoverOpenChange={setHeaderPopoverOpen}
                />
              </div>
            ) : (
              <div className='flex-1 min-w-0' />
            )}
          </div>
        ) : null}
      </div>

      <div
        className='flex-1 min-h-0 min-w-0 overflow-hidden relative'
        onPointerDownCapture={markPointerDrivenFocus}
      >
        {isWorkspaceDragActive ? (
          <div
            className='absolute inset-0 z-10'
            onDragEnter={e => {
              e.stopPropagation()
              const payload = getCurrentPayload(e)
              if (!canAcceptDrop(payload)) return
              dragDepthRef.current += 1
              const rect =
                leafRef.current?.getBoundingClientRect() ??
                e.currentTarget.getBoundingClientRect()
              const placement = resolveDropPlacement(rect, e.clientX, e.clientY)
              setDragOver(true)
              setDropPlacement(placement)
            }}
            onDragOver={e => {
              e.stopPropagation()
              const payload = getCurrentPayload(e)
              if (!canAcceptDrop(payload)) {
                setDragOver(false)
                setDropPlacement(null)
                return
              }
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const rect =
                leafRef.current?.getBoundingClientRect() ??
                e.currentTarget.getBoundingClientRect()
              const placement = resolveDropPlacement(rect, e.clientX, e.clientY)
              setDragOver(true)
              if (dropPlacement !== placement) setDropPlacement(placement)
            }}
            onDragLeave={e => {
              e.stopPropagation()
              dragDepthRef.current -= 1
              if (dragDepthRef.current <= 0) {
                dragDepthRef.current = 0
                setDragOver(false)
                setDropPlacement(null)
              }
            }}
            onDrop={e => {
              e.stopPropagation()
              const payload = getCurrentPayload(e)
              if (!canAcceptDrop(payload)) return
              e.preventDefault()
              dragDepthRef.current = 0
              setDragOver(false)
              const rect =
                leafRef.current?.getBoundingClientRect() ??
                e.currentTarget.getBoundingClientRect()
              const placement = resolveDropPlacement(rect, e.clientX, e.clientY)
              setDropPlacement(null)
              setActiveWorkspaceDrag(null)

              store.dispatch({
                type: 'pane/move',
                fromLeafId: payload!.fromLeafId,
                toLeafId: leafId,
                placement
              })
            }}
          />
        ) : null}

        {!isFullscreenOpen ? (
          <div
            data-panel-active='true'
            ref={setLeafSlotElement}
            className={cn(
              'absolute inset-0 min-h-0 min-w-0',
              isWorkspaceDragActive
                ? 'pointer-events-none'
                : 'pointer-events-auto'
            )}
          />
        ) : null}
      </div>

      <Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
        <DialogContent
          overlayClassName='bg-black/35'
          className='!left-0 !top-0 !translate-x-0 !translate-y-0 !w-screen !max-w-none !h-dvh !max-h-none !flex !flex-col min-h-0 rounded-none border-0 p-0 gap-0 overflow-hidden bg-surface-1'
        >
          <DialogHeader className='shrink-0 h-10 px-3 border-b border-border space-y-0'>
            <div className='flex items-center justify-between h-full gap-2'>
              <DialogTitle className='text-sm font-medium truncate'>
                {panel ? getPanelTitle(panel.type, panel.config) : 'Panel'}
              </DialogTitle>
              <DialogDescription className='sr-only'>
                Fullscreen panel dialog for the selected workspace pane.
              </DialogDescription>
              <Button
                type='button'
                variant='icon'
                size='icon'
                className='h-6 w-6 shrink-0'
                title='Close fullscreen dialog'
                aria-label='Close fullscreen dialog'
                onClick={() => setIsFullscreenOpen(false)}
              >
                <Minimize2 className='h-3.5 w-3.5' />
              </Button>
            </div>
          </DialogHeader>
          <div
            className='relative flex-1 min-h-0 min-w-0 overflow-hidden'
            onPointerDownCapture={markPointerDrivenFocus}
          >
            <div
              data-panel-active='true'
              ref={setDialogSlotElement}
              className='absolute inset-0 min-h-0 min-w-0'
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const LeafView = memo(LeafViewImpl, (prev, next) => prev.leaf === next.leaf)

function PanelPortalLayer (props: {
  readonly leafPanels: readonly LeafPanelTarget[]
}) {
  const { slotsByPanelInstanceId } = usePanelSlots()

  return (
    <>
      {props.leafPanels.map(leafPanel => (
        <PanelPortalMount
          key={leafPanel.panelInstanceId}
          leafId={leafPanel.leafId}
          panelInstanceId={leafPanel.panelInstanceId}
          target={slotsByPanelInstanceId.get(leafPanel.panelInstanceId) ?? null}
        />
      ))}
    </>
  )
}

function PanelPortalMountImpl (props: {
  readonly leafId: string
  readonly panelInstanceId: string
  readonly target: HTMLDivElement | null
}) {
  const stableHost = useMemo(() => {
    if (typeof document === 'undefined') return null
    const host = document.createElement('div')
    host.style.height = '100%'
    host.style.width = '100%'
    host.style.minHeight = '0'
    host.style.minWidth = '0'
    return host
  }, [])

  const scrollSnapshotRef = useRef<{
    readonly top: number
    readonly left: number
  } | null>(null)

  function pickScroller (): HTMLElement | null {
    if (!stableHost) return null
    const candidates = Array.from(
      stableHost.querySelectorAll<HTMLElement>(
        '[data-workspace-panel-scroller="true"]'
      )
    )
    // Prefer the "deepest" marked scroller that actually scrolls (agent-detail has an
    // inner scroller; PanelHost is the outer fallback).
    for (let i = candidates.length - 1; i >= 0; i--) {
      const el = candidates[i]
      if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)
        return el
      if (el.scrollTop !== 0 || el.scrollLeft !== 0) return el
    }
    return candidates[candidates.length - 1] ?? null
  }

  useEffect(() => {
    if (!stableHost) return
    return () => {
      stableHost.remove()
    }
  }, [stableHost])

  useEffect(() => {
    if (!stableHost) return

    // Snapshot before moving the host (covers cases where the panel DOM is recreated
    // during split/stack and scroll needs to be restored).
    const before = pickScroller()
    if (before) {
      scrollSnapshotRef.current = {
        top: before.scrollTop,
        left: before.scrollLeft
      }
    }

    if (props.target) {
      props.target.appendChild(stableHost)
    } else {
      // Avoid detach churn; keep the host where it was until we have a real target.
      // (If the previous target unmounts, the DOM will detach naturally.)
      return
    }

    const after = pickScroller()
    const snap = scrollSnapshotRef.current
    if (after && snap) {
      let attempts = 0
      const apply = () => {
        attempts++
        after.scrollTop = snap.top
        after.scrollLeft = snap.left
        // During split/stack resize, layout can clamp scrollTop to 0 for a few frames.
        if (
          attempts < 12 &&
          (Math.abs(after.scrollTop - snap.top) > 2 ||
            Math.abs(after.scrollLeft - snap.left) > 2)
        ) {
          requestAnimationFrame(apply)
        }
      }
      requestAnimationFrame(apply)
    }

    if (!after) return

    const onScroll = () => {
      scrollSnapshotRef.current = {
        top: after.scrollTop,
        left: after.scrollLeft
      }
    }
    after.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      onScroll()
      after.removeEventListener('scroll', onScroll)
    }
  }, [props.target, stableHost])

  if (!stableHost) return null
  return createPortal(
    <PanelHost leafId={props.leafId} panelInstanceId={props.panelInstanceId} />,
    stableHost
  )
}

const PanelPortalMount = memo(
  PanelPortalMountImpl,
  (prev, next) =>
    prev.leafId === next.leafId &&
    prev.panelInstanceId === next.panelInstanceId &&
    prev.target === next.target
)

function PanelHostImpl (props: {
  readonly leafId: string
  readonly panelInstanceId: string
}) {
  const store = useWorkspaceStore()
  const panel = useWorkspaceSelector(s => {
    const window = s.windowsById[s.activeWindowId]
    return window?.panelsById[props.panelInstanceId] ?? null
  })
  const focusLeaf = useCallback(() => {
    store.dispatch({ type: 'leaf/focus', leafId: props.leafId })
  }, [store, props.leafId])

  const def = panel ? getPanelDefinition(panel.type) : null
  const runtime = useMemo(
    () => createPanelRuntime(store, props.leafId, props.panelInstanceId),
    [store, props.leafId, props.panelInstanceId]
  )
  const setPanelConfig = useCallback(
    (updater: (prev: unknown) => unknown) =>
      store.dispatch({
        type: 'panel/config',
        panelInstanceId: props.panelInstanceId,
        updater: prev => updater(prev)
      }),
    [store, props.panelInstanceId]
  )

  if (!panel || !def) return null

  const Component = def.Component as React.ComponentType<PanelProps<unknown>>
  const paddingClass = def.bodyPadding === 'none' ? 'p-0' : 'p-3'

  return (
    <div
      className={cn(
        'h-full min-h-0 min-w-0 overflow-auto overscroll-contain',
        paddingClass
      )}
      data-workspace-panel-scroller='true'
      onPointerDownCapture={focusLeaf}
    >
      <Component
        config={panel.config}
        setConfig={setPanelConfig}
        runtime={runtime}
      />
    </div>
  )
}

const PanelHost = memo(
  PanelHostImpl,
  (prev, next) =>
    prev.leafId === next.leafId && prev.panelInstanceId === next.panelInstanceId
)
