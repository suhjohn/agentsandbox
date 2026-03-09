import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { FilterMenu } from '@/components/ui/filter-menu'
import { FilterSelect } from '@/components/ui/filter-select'
import {
  AlertCircle,
  Archive,
  Bot,
  Calendar,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Columns2,
  Copy,
  Keyboard,
  Layers,
  Loader2,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Rows2,
  Square,
  User,
  X
} from 'lucide-react'
import { TbTableColumn, TbTableRow } from 'react-icons/tb'
import { PiParachute } from 'react-icons/pi'
import { useAuth } from '@/lib/auth'
import {
  getAgents,
  getImages,
  getSession,
  getSessionGroups,
  putSessionId,
  type GetAgents200,
  type GetImages200,
  type GetSession200,
  type GetSessionGroups200,
  type GetSessionGroups200DataItem,
  type GetSessionGroupsParams,
  type GetSessionParams
} from '@/api/generated/agent-manager'
import { orvalFetcher } from '@/api/orval-fetcher'
import { LayoutNodeView } from './workspace-view_layout'
import { WorkspaceHotkeysLayer } from './workspace-hotkeys-layer'
import { useWorkspaceSelector, useWorkspaceStore } from '../store'
import { listLeafIds } from '../layout'
import type { PanelOpenPlacement } from '../panels/types'
import {
  DEFAULT_LEADER_SEQUENCE,
  resolveWorkspaceKeybindings
} from '../keybindings/defaults'
import {
  WORKSPACE_OPEN_COORDINATOR_EVENT,
  WORKSPACE_RUN_COMMAND_EVENT
} from '../keybindings/events'
import {
  hasWorkspaceKeybindingOverrides,
  loadWorkspaceKeybindingOverrides,
  sanitizeWorkspaceKeybindingOverrides
} from '../keybindings/persistence'
import {
  formatKeySequence,
  type WorkspaceCommandId,
  type WorkspaceKeybinding
} from '../keybindings/types'
import {
  getDialogRuntimeController,
  registerSessionsSidePanelRuntimeController
} from '@/coordinator-actions/runtime-bridge'
import type {
  SessionsSidePanelArchivedFilter,
  SessionsSidePanelFilters,
  SessionsSidePanelGroupBy,
  SessionsSidePanelSnapshot,
  SessionsSidePanelTimeRange
} from '@/coordinator-actions/types'
import { Loader } from '@/components/loader'
import { formatLastMessagePreview } from '@/utils/message-preview'

const SESSIONS_PANEL_OPEN_COOKIE = 'agentManagerWeb.workspaceSessionsPanelOpen'
const SESSIONS_PANEL_WIDTH_COOKIE =
  'agentManagerWeb.workspaceSessionsPanelWidthPx'
const COORDINATOR_COMPOSE_EVENT = 'agent-manager-web:coordinator-compose'
const SESSIONS_PANEL_WIDTH_DEFAULT_PX = 320
const SESSIONS_PANEL_WIDTH_MIN_PX = 240
const SESSIONS_PANEL_WIDTH_MAX_PX = 640
const SESSION_DETAIL_HIDE_DELAY_MS = 100

function getWindowIndexArg (args: unknown): number | null {
  if (typeof args === 'number' && Number.isFinite(args)) {
    return Math.trunc(args)
  }
  if (typeof args !== 'object' || args === null) return null
  const index = (args as { index?: unknown }).index
  if (typeof index !== 'number' || !Number.isFinite(index)) return null
  return Math.trunc(index)
}

function TopBarTooltip (props: {
  readonly label: string
  readonly shortcut?: string | null
  readonly disabled?: boolean
  readonly children: React.ReactElement
}) {
  const trigger = props.disabled ? (
    <span className='inline-flex'>{props.children}</span>
  ) : (
    props.children
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side='bottom' align='center'>
        <div className='flex flex-col gap-1'>
          <span className='text-xs text-text-primary'>{props.label}</span>
          {props.shortcut ? (
            <span className='text-[11px] font-mono text-text-tertiary'>
              {props.shortcut}
            </span>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

type SessionTimeRange = SessionsSidePanelTimeRange
type SessionArchivedFilter = SessionsSidePanelArchivedFilter
type SessionGroupBy = SessionsSidePanelGroupBy
type SessionPanelFilters = SessionsSidePanelFilters

type SessionListItem = {
  readonly id: string
  readonly agentId: string
  readonly imageId: string | null
  readonly createdBy: string
  readonly isArchived: boolean
  readonly status: string
  readonly harness: string
  readonly externalSessionId: string | null
  readonly model: string | null
  readonly modelReasoningEffort: string | null
  readonly title: string | null
  readonly updatedAt: string
  readonly lastMessageBody: string | null
}

type UserListItem = {
  readonly id: string
  readonly name: string
  readonly email: string
}

const SESSION_TIME_RANGE_OPTIONS: ReadonlyArray<{
  readonly value: SessionTimeRange
  readonly label: string
}> = [
  { value: 'all', label: 'All time' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' }
]

const DEFAULT_SESSION_FILTERS: SessionPanelFilters = {
  imageId: '',
  agentId: '',
  createdBy: '',
  archived: 'false',
  status: 'all',
  updatedAtRange: 'all',
  createdAtRange: 'all',
  q: ''
}

const SESSION_ARCHIVED_FILTER_VALUES = new Set<SessionArchivedFilter>([
  'all',
  'true',
  'false'
])
const SESSION_TIME_RANGE_VALUES = new Set<SessionTimeRange>([
  'all',
  '24h',
  '7d',
  '30d',
  '90d'
])
const SESSION_GROUP_BY_VALUES = new Set<SessionGroupBy>([
  'none',
  'imageId',
  'createdBy',
  'status'
])

function isSessionFiltersActive (filters: SessionPanelFilters): boolean {
  return (
    filters.imageId.trim().length > 0 ||
    filters.agentId.trim().length > 0 ||
    filters.createdBy.trim().length > 0 ||
    filters.archived !== 'false' ||
    filters.status !== 'all' ||
    filters.updatedAtRange !== 'all' ||
    filters.createdAtRange !== 'all' ||
    filters.q.trim().length > 0
  )
}

function normalizeSessionFiltersPatch (
  prev: SessionPanelFilters,
  patch: Partial<SessionPanelFilters>
): SessionPanelFilters {
  const nextImageId =
    typeof patch.imageId === 'string' ? patch.imageId.trim() : prev.imageId
  const nextAgentId =
    typeof patch.agentId === 'string' ? patch.agentId.trim() : prev.agentId
  const nextCreatedBy =
    typeof patch.createdBy === 'string'
      ? patch.createdBy.trim()
      : prev.createdBy
  const rawStatus =
    typeof patch.status === 'string' ? patch.status.trim() : prev.status
  const nextStatus = rawStatus.length > 0 ? rawStatus : 'all'
  const nextArchived =
    typeof patch.archived === 'string' &&
    SESSION_ARCHIVED_FILTER_VALUES.has(patch.archived as SessionArchivedFilter)
      ? (patch.archived as SessionArchivedFilter)
      : prev.archived
  const nextUpdatedAtRange =
    typeof patch.updatedAtRange === 'string' &&
    SESSION_TIME_RANGE_VALUES.has(patch.updatedAtRange as SessionTimeRange)
      ? (patch.updatedAtRange as SessionTimeRange)
      : prev.updatedAtRange
  const nextCreatedAtRange =
    typeof patch.createdAtRange === 'string' &&
    SESSION_TIME_RANGE_VALUES.has(patch.createdAtRange as SessionTimeRange)
      ? (patch.createdAtRange as SessionTimeRange)
      : prev.createdAtRange

  const nextQ = typeof patch.q === 'string' ? patch.q.trim() : prev.q

  return {
    imageId: nextImageId,
    agentId: nextAgentId,
    createdBy: nextCreatedBy,
    archived: nextArchived,
    status: nextStatus,
    updatedAtRange: nextUpdatedAtRange,
    createdAtRange: nextCreatedAtRange,
    q: nextQ
  }
}

function buildSessionsSidePanelSnapshot (input: {
  readonly open: boolean
  readonly widthPx: number
  readonly filters: SessionPanelFilters
  readonly groupBy: SessionGroupBy
}): SessionsSidePanelSnapshot {
  return {
    open: input.open,
    widthPx: input.widthPx,
    filters: input.filters,
    groupBy: input.groupBy,
    hasActiveFilters: isSessionFiltersActive(input.filters)
  }
}

const SESSION_GROUP_BY_OPTIONS: ReadonlyArray<{
  readonly value: SessionGroupBy
  readonly label: string
}> = [
  { value: 'none', label: 'None' },
  { value: 'imageId', label: 'Image name' },
  { value: 'createdBy', label: 'Created by' },
  { value: 'status', label: 'Status' }
]

function formatStatusLabel (value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) return 'Unknown'
  return trimmed
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(part => part[0]!.toUpperCase() + part.slice(1))
    .join(' ')
}

function getCookie (name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null
  const cookies = document.cookie.split('; ')
  for (const cookie of cookies) {
    const equalsIndex = cookie.indexOf('=')
    const key = equalsIndex === -1 ? cookie : cookie.slice(0, equalsIndex)
    if (key !== name) continue
    const value = equalsIndex === -1 ? '' : cookie.slice(equalsIndex + 1)
    return decodeURIComponent(value)
  }
  return null
}

function setCookie (name: string, value: string, days = 365): void {
  if (typeof document === 'undefined') return
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(
    value
  )}; expires=${expires}; path=/; SameSite=Lax`
}

function loadSessionPanelOpen (): boolean {
  return getCookie(SESSIONS_PANEL_OPEN_COOKIE) === 'true'
}

function clampSessionPanelWidth (value: number): number {
  if (!Number.isFinite(value)) return SESSIONS_PANEL_WIDTH_DEFAULT_PX
  return Math.min(
    SESSIONS_PANEL_WIDTH_MAX_PX,
    Math.max(SESSIONS_PANEL_WIDTH_MIN_PX, Math.round(value))
  )
}

function loadSessionPanelWidth (): number {
  const raw = getCookie(SESSIONS_PANEL_WIDTH_COOKIE)
  if (!raw) return SESSIONS_PANEL_WIDTH_DEFAULT_PX
  return clampSessionPanelWidth(Number(raw))
}

function unwrapSessionList (value: unknown): GetSession200 | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (Array.isArray(v.data)) return v as GetSession200
  if (typeof v.data === 'object' && v.data !== null) {
    const d = v.data as Record<string, unknown>
    if (Array.isArray(d.data)) return d as GetSession200
  }
  return null
}

function unwrapSessionGroups (value: unknown): GetSessionGroups200 | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (Array.isArray(v.data)) return v as GetSessionGroups200
  if (typeof v.data === 'object' && v.data !== null) {
    const d = v.data as Record<string, unknown>
    if (Array.isArray(d.data)) return d as GetSessionGroups200
  }
  return null
}

function unwrapImages (value: unknown): GetImages200 | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (Array.isArray(v.data)) return v as GetImages200
  if (typeof v.data === 'object' && v.data !== null) {
    const d = v.data as Record<string, unknown>
    if (Array.isArray(d.data)) return d as GetImages200
  }
  return null
}

function unwrapAgents (value: unknown): GetAgents200 | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (Array.isArray(v.data)) return v as GetAgents200
  if (Array.isArray(v.agents)) return v as GetAgents200
  if (typeof v.data === 'object' && v.data !== null) {
    const d = v.data as Record<string, unknown>
    if (Array.isArray(d.data)) return d as GetAgents200
    if (Array.isArray(d.agents)) return d as GetAgents200
  }
  return null
}

function unwrapUsers (value: unknown): readonly UserListItem[] {
  const toUsers = (items: unknown[]): readonly UserListItem[] => {
    const result: UserListItem[] = []
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as Record<string, unknown>
      const id = typeof row.id === 'string' ? row.id.trim() : ''
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      const email = typeof row.email === 'string' ? row.email.trim() : ''
      if (id.length === 0 || name.length === 0) continue
      result.push({ id, name, email })
    }
    return result
  }

  if (Array.isArray(value)) return toUsers(value)
  if (typeof value !== 'object' || value === null) return []
  const v = value as Record<string, unknown>
  if (Array.isArray(v.data)) return toUsers(v.data)
  if (typeof v.data === 'object' && v.data !== null) {
    const d = v.data as Record<string, unknown>
    if (Array.isArray(d.data)) return toUsers(d.data)
  }
  return []
}

function formatTimestamp (value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  return new Date(time).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function SessionStatusIcon ({ status }: { readonly status: string }) {
  const s = status.trim().toLowerCase()
  if (s === 'completed') {
    return (
      <CheckCircle2 className='h-3.5 w-3.5 shrink-0 text-green-500 dark:text-green-400' />
    )
  }
  if (s === 'processing') {
    return (
      <Loader2 className='h-3.5 w-3.5 shrink-0 animate-spin text-blue-500' />
    )
  }
  if (s === 'blocked') {
    return <AlertCircle className='h-3.5 w-3.5 shrink-0 text-amber-500' />
  }
  if (s === 'initial') {
    return <Clock className='h-3.5 w-3.5 shrink-0 text-text-tertiary' />
  }
  return <Circle className='h-3 w-3 shrink-0 text-text-tertiary' />
}

function SessionMetaRow (props: {
  readonly label: string
  readonly value: string
  readonly icon: ReactNode
  readonly mono?: boolean
  readonly copyable?: boolean
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(props.value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [props.value])

  const displayValue = useMemo(() => {
    if (props.value.length <= 28) return props.value
    return `${props.value.slice(0, 12)}…${props.value.slice(-12)}`
  }, [props.value])

  const isTruncated = displayValue !== props.value

  return (
    <div className='h-7 grid grid-cols-[20px_minmax(0,1fr)] gap-2 items-center group'>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='flex items-center justify-center text-text-tertiary cursor-default'>
            {props.icon}
          </span>
        </TooltipTrigger>
        <TooltipContent side='left' sideOffset={4}>
          {props.label}
        </TooltipContent>
      </Tooltip>

      <div className='flex items-center gap-1 min-w-0'>
        <Tooltip>
          <TooltipTrigger asChild>
            <p
              className={cn(
                'text-text-secondary text-xs truncate',
                props.mono && 'font-mono',
                props.copyable && 'cursor-pointer hover:text-text-primary'
              )}
              onClick={props.copyable ? handleCopy : undefined}
            >
              {displayValue}
            </p>
          </TooltipTrigger>
          {(isTruncated || props.copyable) && (
            <TooltipContent side='top' className='max-w-xs'>
              <p className='font-mono text-xs break-all'>{props.value}</p>
              {props.copyable && (
                <p className='text-text-tertiary text-[10px] mt-1'>
                  Click to copy
                </p>
              )}
            </TooltipContent>
          )}
        </Tooltip>

        {props.copyable && (
          <button
            type='button'
            onClick={handleCopy}
            className='opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary hover:text-text-primary'
          >
            {copied ? (
              <Check className='h-3 w-3 text-green-500' />
            ) : (
              <Copy className='h-3 w-3' />
            )}
          </button>
        )}
      </div>
    </div>
  )
}

function SessionIdDisplay (props: { readonly sessionId: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(props.sessionId)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [props.sessionId])

  const truncatedId = useMemo(() => {
    if (props.sessionId.length <= 20) return props.sessionId
    return `${props.sessionId.slice(0, 8)}…${props.sessionId.slice(-8)}`
  }, [props.sessionId])

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            onClick={handleCopy}
            className='flex items-center gap-1 mt-0.5 text-[10px] font-mono text-text-tertiary hover:text-text-secondary transition-colors group'
          >
            <span>{truncatedId}</span>
            {copied ? (
              <Check className='h-2.5 w-2.5 text-green-500' />
            ) : (
              <Copy className='h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity' />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side='bottom' className='max-w-xs'>
          <p className='font-mono text-xs break-all'>{props.sessionId}</p>
          <p className='text-text-tertiary text-[10px] mt-1'>Click to copy</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function WorkspaceView () {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const store = useWorkspaceStore()

  const resolvedWorkspaceKeybindingOverrides = useMemo(() => {
    const accountOverrides = sanitizeWorkspaceKeybindingOverrides(
      auth.user?.workspaceKeybindings
    )
    return hasWorkspaceKeybindingOverrides(accountOverrides)
      ? accountOverrides
      : loadWorkspaceKeybindingOverrides(auth.user?.id)
  }, [auth.user?.id, auth.user?.workspaceKeybindings])

  const resolvedWorkspaceKeybindings = useMemo(
    (): readonly WorkspaceKeybinding[] =>
      resolveWorkspaceKeybindings(resolvedWorkspaceKeybindingOverrides),
    [resolvedWorkspaceKeybindingOverrides]
  )

  const resolvedLeaderSequence =
    resolvedWorkspaceKeybindingOverrides.leaderSequence ??
    DEFAULT_LEADER_SEQUENCE

  const formatBindingShortcut = useCallback(
    (binding: WorkspaceKeybinding): string => {
      if (binding.context !== 'workspace.prefix') {
        return formatKeySequence(binding.sequence)
      }
      return formatKeySequence([...resolvedLeaderSequence, ...binding.sequence])
    },
    [resolvedLeaderSequence]
  )

  const getCommandShortcut = useCallback(
    (
      commandId: WorkspaceCommandId,
      options?: {
        readonly contexts?: readonly WorkspaceKeybinding['context'][]
        readonly args?: unknown
      }
    ): string | null => {
      const contexts = options?.contexts ?? ['workspace.prefix']
      for (const context of contexts) {
        const candidates = resolvedWorkspaceKeybindings.filter(candidate => {
          if (candidate.context !== context) return false
          if (candidate.commandId !== commandId) return false
          if (options?.args === undefined) return true
          if (commandId === 'window.select_index') {
            return (
              getWindowIndexArg(candidate.args) ===
              getWindowIndexArg(options.args)
            )
          }
          return JSON.stringify(candidate.args) === JSON.stringify(options.args)
        })
        const binding =
          candidates.find(candidate => candidate.source === 'user') ??
          candidates[0]
        if (binding) {
          return formatBindingShortcut(binding)
        }
      }
      return null
    },
    [formatBindingShortcut, resolvedWorkspaceKeybindings]
  )

  const getPrefixShortcut = useCallback(
    (
      commandId: WorkspaceCommandId,
      options?: {
        readonly args?: unknown
      }
    ): string | null =>
      getCommandShortcut(commandId, {
        contexts: ['workspace.prefix'],
        args: options?.args
      }),
    [getCommandShortcut]
  )

  const openKeyBindings = useCallback(() => {
    const respond = (): void => {}
    const reject = (): void => {}
    globalThis.window.dispatchEvent(
      new CustomEvent(WORKSPACE_RUN_COMMAND_EVENT, {
        detail: {
          commandId: 'keyboard.palette.open',
          respond,
          reject
        }
      })
    )
  }, [])

  const openCoordinator = useCallback(() => {
    globalThis.window.dispatchEvent(new Event(WORKSPACE_OPEN_COORDINATOR_EVENT))
  }, [])

  const openKeyBindingsShortcut = getCommandShortcut('keyboard.palette.open', {
    contexts: ['workspace', 'workspace.prefix']
  })
  const openCoordinatorShortcut = 'Option + Space'

  const sessionsPanelToggleShortcut = getPrefixShortcut(
    'workspace.sessions_panel.toggle'
  )
  const createWindowShortcut = getPrefixShortcut('window.create')
  const splitRightShortcut = getPrefixShortcut('pane.split.right')
  const splitDownShortcut = getPrefixShortcut('pane.split.down')
  const closePaneShortcut = getPrefixShortcut('pane.close')
  const paneExpandShortcut = getPrefixShortcut('pane.zoom.toggle')

  const windows = useWorkspaceSelector(state => {
    const windowIds = Object.keys(state.windowsById)
    return windowIds.map((windowId, index) => {
      const window = state.windowsById[windowId]
      const name = window?.name?.trim() ?? ''
      return {
        id: windowId,
        index,
        name: name.length > 0 ? name : `Window ${index + 1}`,
        active: windowId === state.activeWindowId
      }
    })
  })
  const activeWindowRoot = useWorkspaceSelector(
    s => s.windowsById[s.activeWindowId]?.root ?? null
  )
  const focusedLeafId = useWorkspaceSelector(
    s => s.windowsById[s.activeWindowId]?.focusedLeafId ?? null
  )
  const [sessionPanelOpen, setSessionPanelOpen] = useState(() =>
    loadSessionPanelOpen()
  )
  const [sessionPanelWidthPx, setSessionPanelWidthPx] = useState(() =>
    loadSessionPanelWidth()
  )
  const [sessionFilters, setSessionFilters] = useState<SessionPanelFilters>(
    DEFAULT_SESSION_FILTERS
  )
  const [sessionGroupBy, setSessionGroupBy] = useState<SessionGroupBy>('none')
  const [isSessionPanelResizing, setIsSessionPanelResizing] = useState(false)
  const [hoveredSessionDetail, setHoveredSessionDetail] = useState<{
    readonly session: SessionListItem
    readonly topPx: number
  } | null>(null)
  const sessionPanelOpenRef = useRef(sessionPanelOpen)
  const sessionPanelWidthPxRef = useRef(sessionPanelWidthPx)
  const sessionFiltersRef = useRef<SessionPanelFilters>(sessionFilters)
  const sessionGroupByRef = useRef<SessionGroupBy>(sessionGroupBy)
  const sessionPanelContainerRef = useRef<HTMLDivElement | null>(null)
  const sessionFilterTriggerRef = useRef<HTMLDivElement | null>(null)
  const sessionDetailCardRef = useRef<HTMLDivElement | null>(null)
  const sessionDetailHideTimeoutRef = useRef<number | null>(null)

  if (!activeWindowRoot) return null

  const leafIds = listLeafIds(activeWindowRoot)
  const leafCount = leafIds.length
  const canCloseFocused = !!focusedLeafId && leafCount > 1
  const panelTargetLeafId = focusedLeafId ?? leafIds[0] ?? null

  const sessionQueryParams = useMemo<GetSessionParams>(() => {
    const params: GetSessionParams = {
      limit: 50,
      updatedAtRange: sessionFilters.updatedAtRange,
      createdAtRange: sessionFilters.createdAtRange
    }
    const imageId = sessionFilters.imageId.trim()
    if (imageId) params.imageId = imageId
    const agentId = sessionFilters.agentId.trim()
    if (agentId) params.agentId = agentId
    const createdBy = sessionFilters.createdBy.trim()
    if (createdBy) params.createdBy = createdBy
    if (sessionFilters.archived !== 'all')
      params.archived = sessionFilters.archived
    if (sessionFilters.status !== 'all') params.status = sessionFilters.status
    const q = sessionFilters.q.trim()
    if (q) params.q = q
    return params
  }, [sessionFilters])
  const sessionGroupsQueryParams =
    useMemo<GetSessionGroupsParams | null>(() => {
      if (sessionGroupBy === 'none') return null

      const params: GetSessionGroupsParams = {
        by: sessionGroupBy,
        limit: 100,
        updatedAtRange: sessionFilters.updatedAtRange,
        createdAtRange: sessionFilters.createdAtRange
      }
      const imageId = sessionFilters.imageId.trim()
      if (imageId) params.imageId = imageId
      const agentId = sessionFilters.agentId.trim()
      if (agentId) params.agentId = agentId
      const createdBy = sessionFilters.createdBy.trim()
      if (createdBy) params.createdBy = createdBy
      if (sessionFilters.archived !== 'all')
        params.archived = sessionFilters.archived
      if (sessionFilters.status !== 'all') params.status = sessionFilters.status
      const q = sessionFilters.q.trim()
      if (q) params.q = q
      return params
    }, [sessionFilters, sessionGroupBy])

  const sessionsQuery = useQuery({
    queryKey: [
      'workspace',
      'session-side-panel',
      'sessions',
      sessionQueryParams
    ],
    enabled: sessionPanelOpen && !!auth.user,
    queryFn: async () => {
      const response = await getSession(sessionQueryParams)
      const parsed = unwrapSessionList(response)
      if (!parsed) throw new Error('Unexpected response shape (getSession).')
      return parsed
    }
  })
  const sessionGroupsQuery = useQuery({
    queryKey: [
      'workspace',
      'session-side-panel',
      'session-groups',
      sessionGroupsQueryParams
    ],
    enabled: sessionPanelOpen && !!auth.user && sessionGroupBy !== 'none',
    queryFn: async () => {
      if (!sessionGroupsQueryParams) {
        throw new Error('Missing session group query params')
      }
      const response = await getSessionGroups(sessionGroupsQueryParams)
      const parsed = unwrapSessionGroups(response)
      if (!parsed) {
        throw new Error('Unexpected response shape (getSessionGroups).')
      }
      return parsed
    }
  })
  const usersQuery = useQuery({
    queryKey: ['workspace', 'session-side-panel', 'users'],
    enabled: sessionPanelOpen && !!auth.user,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        const response = await orvalFetcher<unknown>('/users?hasAgents=true', {
          method: 'GET'
        })
        return unwrapUsers(response)
      } catch {
        return [] as readonly UserListItem[]
      }
    }
  })
  const agentsQuery = useQuery({
    queryKey: ['workspace', 'session-side-panel', 'agents'],
    enabled: sessionPanelOpen && !!auth.user,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await getAgents({ limit: 50 })
      const parsed = unwrapAgents(response)
      if (!parsed) throw new Error('Unexpected response shape (getAgents).')
      return parsed
    }
  })

  const imagesQuery = useQuery({
    queryKey: ['workspace', 'session-side-panel', 'images'],
    enabled: sessionPanelOpen && !!auth.user,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await getImages({ limit: 50 })
      const parsed = unwrapImages(response)
      if (!parsed) throw new Error('Unexpected response shape (getImages).')
      return parsed
    }
  })
  const users = usersQuery.data ?? []
  const userNameById = useMemo(() => {
    const byId = new Map<string, string>()
    for (const user of users) {
      const id = user.id.trim()
      if (id.length === 0) continue
      const name = user.name.trim()
      byId.set(id, name.length > 0 ? name : id)
    }
    return byId
  }, [users])
  const agents = agentsQuery.data?.data ?? []
  const agentNameById = useMemo(() => {
    const byId = new Map<string, string>()
    for (const agent of agents) {
      const id = agent.id.trim()
      if (id.length === 0) continue
      const name = (agent.name ?? '').trim()
      byId.set(id, name.length > 0 ? name : id)
    }
    return byId
  }, [agents])
  const images = imagesQuery.data?.data ?? []
  const imageNameById = useMemo(() => {
    const byId = new Map<string, string>()
    for (const image of images) {
      const id = image.id.trim()
      if (id.length === 0) continue
      const name = image.name.trim()
      byId.set(id, name.length > 0 ? name : id)
    }
    return byId
  }, [images])
  const imageFilterOptions = useMemo<
    ReadonlyArray<{ readonly value: string; readonly label: string }>
  >(() => {
    const all = [{ value: '', label: 'All images' }]
    const sorted = [...images].sort((a, b) => a.name.localeCompare(b.name))
    for (const image of sorted) {
      const id = image.id.trim()
      if (id.length === 0) continue
      const name = image.name.trim()
      all.push({ value: id, label: name.length > 0 ? name : id })
    }
    const selectedImageId = sessionFilters.imageId.trim()
    if (
      selectedImageId.length > 0 &&
      !all.some(option => option.value === selectedImageId)
    ) {
      all.push({
        value: selectedImageId,
        label: `Unknown image (${selectedImageId.slice(0, 8)}…)`
      })
    }
    return all
  }, [images, sessionFilters.imageId])
  const agentFilterOptions = useMemo<
    ReadonlyArray<{ readonly value: string; readonly label: string }>
  >(() => {
    const all = [{ value: '', label: 'All agents' }]
    const sorted = [...agents].sort((a, b) =>
      ((a.name ?? '') || a.id).localeCompare((b.name ?? '') || b.id)
    )
    for (const agent of sorted) {
      const id = agent.id.trim()
      if (id.length === 0) continue
      const name = (agent.name ?? '').trim()
      all.push({ value: id, label: name.length > 0 ? name : id })
    }
    const selectedAgentId = sessionFilters.agentId.trim()
    if (
      selectedAgentId.length > 0 &&
      !all.some(option => option.value === selectedAgentId)
    ) {
      all.push({
        value: selectedAgentId,
        label: `Unknown agent (${selectedAgentId.slice(0, 8)}…)`
      })
    }
    return all
  }, [agents, sessionFilters.agentId])
  const createdByFilterOptions = useMemo<
    ReadonlyArray<{ readonly value: string; readonly label: string }>
  >(() => {
    const all = [{ value: '', label: 'All users' }]
    const sorted = [...users].sort((a, b) => a.name.localeCompare(b.name))
    for (const user of sorted) {
      const id = user.id.trim()
      if (id.length === 0) continue
      const name = user.name.trim()
      const label =
        name.length > 0
          ? user.email.trim().length > 0
            ? `${name} (${user.email.trim()})`
            : name
          : id
      all.push({ value: id, label })
    }
    const selectedCreatedBy = sessionFilters.createdBy.trim()
    if (
      selectedCreatedBy.length > 0 &&
      !all.some(option => option.value === selectedCreatedBy)
    ) {
      all.push({
        value: selectedCreatedBy,
        label: `Unknown user (${selectedCreatedBy.slice(0, 8)}…)`
      })
    }
    return all
  }, [users, sessionFilters.createdBy])

  const openAgentSession = useCallback(
    (input: {
      readonly agentId: string
      readonly sessionId: string
      readonly sessionTitle?: string | null
      readonly agentName?: string
      readonly placement?: PanelOpenPlacement
    }) => {
      if (!panelTargetLeafId) return
      store.dispatch({
        type: 'panel/open',
        fromLeafId: panelTargetLeafId,
        placement: input.placement ?? 'self',
        panelType: 'agent_detail',
        config: {
          agentId: input.agentId,
          agentName: input.agentName?.trim() ?? '',
          activeTab: 'session_detail',
          sessionLimit: 20,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle?.trim() ?? '',
          diffBasis: 'repo_head',
          diffStyle: 'split'
        }
      })
    },
    [panelTargetLeafId, store]
  )

  const openAgentSessionToWindowSplit = useCallback(
    (input: {
      readonly agentId: string
      readonly sessionId: string
      readonly sessionTitle?: string | null
      readonly agentName?: string
      readonly dir: 'row' | 'col'
    }) => {
      const beforeState = store.getState()
      const beforeWindow = beforeState.windowsById[beforeState.activeWindowId]
      if (!beforeWindow) return
      const beforeLeafIds = listLeafIds(beforeWindow.root)

      store.dispatch({
        type: 'window/split-full',
        dir: input.dir,
        insertBefore: false
      })

      const afterState = store.getState()
      const afterWindow = afterState.windowsById[afterState.activeWindowId]
      if (!afterWindow) return
      const afterLeafIds = listLeafIds(afterWindow.root)
      const newLeafId =
        afterLeafIds.find(id => !beforeLeafIds.includes(id)) ??
        afterWindow.focusedLeafId ??
        null
      if (!newLeafId) return

      store.dispatch({
        type: 'panel/open',
        fromLeafId: newLeafId,
        placement: 'self',
        panelType: 'agent_detail',
        config: {
          agentId: input.agentId,
          agentName: input.agentName?.trim() ?? '',
          activeTab: 'session_detail',
          sessionLimit: 20,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle?.trim() ?? '',
          diffBasis: 'repo_head',
          diffStyle: 'split'
        }
      })
    },
    [store]
  )

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const promptText = `can you create a new session for `

      globalThis.window.dispatchEvent(
        new Event('agent-manager-web:open-coordinator')
      )

      let dialogController = getDialogRuntimeController()
      if (!dialogController) {
        await new Promise<void>(resolve => {
          globalThis.window.setTimeout(resolve, 0)
        })
        dialogController = getDialogRuntimeController()
      }
      if (!dialogController) {
        throw new Error('Coordinator dialog is not ready')
      }

      await dialogController.createSession()
      await new Promise<void>(resolve => {
        globalThis.window.requestAnimationFrame(() => {
          globalThis.window.requestAnimationFrame(() => resolve())
        })
      })

      globalThis.window.dispatchEvent(
        new CustomEvent(COORDINATOR_COMPOSE_EVENT, {
          detail: {
            text: promptText,
            replace: true,
            focus: true,
            send: false
          }
        })
      )
    },
    onSuccess: async () => {
      toast.success('Coordinator session ready')
    },
    onError: error => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to open coordinator session'
      )
    }
  })
  const archiveSessionMutation = useMutation({
    mutationFn: async (session: SessionListItem) => {
      if (session.isArchived) return
      await putSessionId(session.id, {
        agentId: session.agentId,
        isArchived: true,
        status: session.status,
        harness: session.harness
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['workspace', 'session-side-panel', 'sessions']
      })
      await queryClient.invalidateQueries({
        queryKey: ['workspace', 'session-side-panel', 'session-groups']
      })
    },
    onError: error => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to archive session'
      )
    }
  })

  const sessions = sessionsQuery.data?.data ?? []
  const statusOptions = useMemo<
    ReadonlyArray<{ readonly value: string; readonly label: string }>
  >(() => {
    const values = new Set<string>([
      'initial',
      'processing',
      'blocked',
      'completed'
    ])
    for (const session of sessions) {
      const status = session.status.trim()
      if (status.length > 0) values.add(status)
    }
    if (sessionFilters.status !== 'all') values.add(sessionFilters.status)
    const options = Array.from(values).sort((a, b) => a.localeCompare(b))
    return [
      { value: 'all', label: 'All' },
      ...options.map(value => ({ value, label: formatStatusLabel(value) }))
    ]
  }, [sessions, sessionFilters.status])
  const hasActiveSessionFilters = useMemo(
    () => isSessionFiltersActive(sessionFilters),
    [sessionFilters]
  )
  const sessionGroups = sessionGroupsQuery.data?.data ?? []
  const resetSessionFilters = useCallback(() => {
    setSessionFilters(DEFAULT_SESSION_FILTERS)
  }, [])
  const clearSessionDetailHideTimeout = useCallback(() => {
    if (sessionDetailHideTimeoutRef.current === null) return
    globalThis.window.clearTimeout(sessionDetailHideTimeoutRef.current)
    sessionDetailHideTimeoutRef.current = null
  }, [])
  const hideSessionDetailCard = useCallback(() => {
    clearSessionDetailHideTimeout()
    setHoveredSessionDetail(null)
  }, [clearSessionDetailHideTimeout])
  const scheduleHideSessionDetailCard = useCallback(() => {
    clearSessionDetailHideTimeout()
    sessionDetailHideTimeoutRef.current = globalThis.window.setTimeout(() => {
      setHoveredSessionDetail(null)
      sessionDetailHideTimeoutRef.current = null
    }, SESSION_DETAIL_HIDE_DELAY_MS)
  }, [clearSessionDetailHideTimeout])
  const isSessionDetailCardTarget = useCallback(
    (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false
      return sessionDetailCardRef.current?.contains(target) ?? false
    },
    []
  )
  const showSessionDetailCard = useCallback(
    (session: SessionListItem, target: HTMLElement) => {
      clearSessionDetailHideTimeout()
      const container = sessionPanelContainerRef.current
      if (!container) return
      const containerRect = container.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const topPx = targetRect.top - containerRect.top + targetRect.height / 2
      setHoveredSessionDetail({ session, topPx })
    },
    [clearSessionDetailHideTimeout]
  )
  useEffect(() => {
    return () => {
      clearSessionDetailHideTimeout()
    }
  }, [clearSessionDetailHideTimeout])

  const renderSessionItem = useCallback(
    (session: SessionListItem) => (
      <div key={session.id} className='group/session relative'>
        <button
          type='button'
          className='w-full text-left p-3 hover:bg-surface-2 transition-colors flex items-center gap-2'
          onMouseEnter={event =>
            showSessionDetailCard(session, event.currentTarget)
          }
          onMouseLeave={event => {
            if (isSessionDetailCardTarget(event.relatedTarget)) return
            scheduleHideSessionDetailCard()
          }}
          onFocus={event => showSessionDetailCard(session, event.currentTarget)}
          onBlur={event => {
            if (isSessionDetailCardTarget(event.relatedTarget)) return
            scheduleHideSessionDetailCard()
          }}
          onClick={() =>
            openAgentSession({
              agentId: session.agentId,
              sessionId: session.id,
              sessionTitle: session.title
            })
          }
        >
          <div className='flex-1 min-w-0 flex flex-col'>
            <div className='flex items-baseline gap-2'>
              <p className='text-sm font-medium text-text-primary truncate flex-1 min-w-0'>
                {session.title?.trim() || 'Untitled session'}
              </p>
            </div>
            <p className='text-[11px] text-text-tertiary mt-0.5'>
              {formatTimestamp(session.updatedAt)}
            </p>
          </div>
          <div className='h-5 w-5 flex-shrink-0 relative'>
            {!session.isArchived ? (
              <>
                <span className='absolute inset-0 flex items-center justify-center group-hover/session:hidden'>
                  <SessionStatusIcon status={session.status} />
                </span>
                <Button
                  variant='icon'
                  size='icon'
                  className='absolute inset-0 hidden group-hover/session:flex items-center justify-center'
                  title='Archive session'
                  aria-label='Archive session'
                  disabled={archiveSessionMutation.isPending}
                  onClick={event => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (archiveSessionMutation.isPending) return
                    void archiveSessionMutation.mutateAsync(session)
                  }}
                >
                  {archiveSessionMutation.isPending &&
                  archiveSessionMutation.variables?.id === session.id ? (
                    <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  ) : (
                    <Archive className='h-3.5 w-3.5' />
                  )}
                </Button>
              </>
            ) : (
              <span className='absolute inset-0 flex items-center justify-center'>
                <SessionStatusIcon status={session.status} />
              </span>
            )}
          </div>
        </button>
      </div>
    ),
    [
      archiveSessionMutation,
      isSessionDetailCardTarget,
      openAgentSession,
      scheduleHideSessionDetailCard,
      showSessionDetailCard
    ]
  )

  const listQueryLoading =
    sessionGroupBy === 'none'
      ? sessionsQuery.isLoading
      : sessionGroupsQuery.isLoading
  const listQueryError =
    sessionGroupBy === 'none' ? sessionsQuery.error : sessionGroupsQuery.error
  const listQueryIsError =
    sessionGroupBy === 'none'
      ? sessionsQuery.isError
      : sessionGroupsQuery.isError
  const hasNoVisibleSessions =
    sessionGroupBy === 'none'
      ? sessions.length === 0
      : sessionGroups.length === 0

  const canCreateSession = !!auth.user && !createSessionMutation.isPending
  const setSessionPanelOpenPersisted = useCallback((open: boolean) => {
    setSessionPanelOpen(open)
    setCookie(SESSIONS_PANEL_OPEN_COOKIE, String(open))
  }, [])
  const focusSessionFilters = useCallback(() => {
    if (!sessionPanelOpenRef.current) {
      setSessionPanelOpenPersisted(true)
    }
    globalThis.window.requestAnimationFrame(() => {
      const trigger =
        sessionFilterTriggerRef.current?.querySelector<HTMLButtonElement>(
          'button'
        )
      if (!trigger) return
      trigger.focus({ preventScroll: true })
      const isExpanded = trigger.getAttribute('aria-expanded') === 'true'
      if (!isExpanded) trigger.click()
    })
  }, [setSessionPanelOpenPersisted])
  const setSessionPanelWidthPersisted = useCallback((nextWidthPx: number) => {
    const width = clampSessionPanelWidth(nextWidthPx)
    setSessionPanelWidthPx(width)
    setCookie(SESSIONS_PANEL_WIDTH_COOKIE, String(width))
  }, [])
  const startSessionPanelResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = sessionPanelWidthPx
      setIsSessionPanelResizing(true)

      const onPointerMove = (event: PointerEvent) => {
        const delta = event.clientX - startX
        setSessionPanelWidthPx(clampSessionPanelWidth(startWidth + delta))
      }

      const onPointerUp = (event: PointerEvent) => {
        const delta = event.clientX - startX
        setSessionPanelWidthPersisted(startWidth + delta)
        setIsSessionPanelResizing(false)
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    },
    [sessionPanelWidthPx, setSessionPanelWidthPersisted]
  )

  useEffect(() => {
    sessionPanelOpenRef.current = sessionPanelOpen
    sessionPanelWidthPxRef.current = sessionPanelWidthPx
    sessionFiltersRef.current = sessionFilters
    sessionGroupByRef.current = sessionGroupBy
  }, [sessionPanelOpen, sessionPanelWidthPx, sessionFilters, sessionGroupBy])
  useEffect(() => {
    if (sessionPanelOpen) return
    setHoveredSessionDetail(null)
  }, [sessionPanelOpen])

  useEffect(() => {
    function getSnapshot (input?: {
      readonly open?: boolean
      readonly widthPx?: number
      readonly filters?: SessionPanelFilters
      readonly groupBy?: SessionGroupBy
    }): SessionsSidePanelSnapshot {
      return buildSessionsSidePanelSnapshot({
        open: input?.open ?? sessionPanelOpenRef.current,
        widthPx: input?.widthPx ?? sessionPanelWidthPxRef.current,
        filters: input?.filters ?? sessionFiltersRef.current,
        groupBy: input?.groupBy ?? sessionGroupByRef.current
      })
    }

    return registerSessionsSidePanelRuntimeController({
      getSnapshot: () => getSnapshot(),
      setOpen: async open => {
        const nextOpen = open === true
        setSessionPanelOpenPersisted(nextOpen)
        sessionPanelOpenRef.current = nextOpen
        return getSnapshot({ open: nextOpen })
      },
      setFilters: async patch => {
        const nextFilters = normalizeSessionFiltersPatch(
          sessionFiltersRef.current,
          patch
        )
        sessionFiltersRef.current = nextFilters
        setSessionFilters(nextFilters)
        return getSnapshot({ filters: nextFilters })
      },
      setGroupBy: async groupBy => {
        const nextGroupBy = SESSION_GROUP_BY_VALUES.has(groupBy)
          ? groupBy
          : 'none'
        sessionGroupByRef.current = nextGroupBy
        setSessionGroupBy(nextGroupBy)
        return getSnapshot({ groupBy: nextGroupBy })
      },
      resetFilters: async () => {
        sessionFiltersRef.current = DEFAULT_SESSION_FILTERS
        setSessionFilters(DEFAULT_SESSION_FILTERS)
        return getSnapshot({ filters: DEFAULT_SESSION_FILTERS })
      }
    })
  }, [setSessionPanelOpenPersisted])

  return (
    <div className='h-dvh w-full flex flex-col bg-bg'>
      <WorkspaceHotkeysLayer
        userId={auth.user?.id}
        accountKeybindings={auth.user?.workspaceKeybindings}
        sessionsPanelOpen={sessionPanelOpen}
        onSetSessionsPanelOpen={setSessionPanelOpenPersisted}
        onFocusSessionsFilter={focusSessionFilters}
      />
      <TooltipProvider delayDuration={250}>
        <div className='h-10 flex items-center gap-1 px-3 border-b bg-surface-1'>
          <TopBarTooltip
            label={
              sessionPanelOpen
                ? 'Close sessions side panel'
                : 'Open sessions side panel'
            }
            shortcut={sessionsPanelToggleShortcut}
          >
            <Button
              variant='icon'
              size='icon'
              aria-label={
                sessionPanelOpen
                  ? 'Close sessions side panel'
                  : 'Open sessions side panel'
              }
              onClick={() => setSessionPanelOpenPersisted(!sessionPanelOpen)}
            >
              {sessionPanelOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </Button>
          </TopBarTooltip>
          <p className='text-sm font-semibold text-text-secondary'>wmux</p>
          <div className='ml-2 flex min-w-0 items-center gap-1'>
            <div className='flex min-w-0 max-w-[32rem] items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
              {windows.map(window => (
                <div
                  key={window.id}
                  className={cn(
                    'group h-6 rounded-md text-xs whitespace-nowrap flex items-center overflow-hidden',
                    window.active
                      ? 'bg-surface-4'
                      : 'bg-surface-1 hover:bg-surface-3'
                  )}
                >
                  <TopBarTooltip
                    label={`Switch to window ${window.index}: ${window.name}`}
                    shortcut={getPrefixShortcut('window.select_index', {
                      args: { index: window.index }
                    })}
                  >
                    <Button
                      variant='ghost'
                      className={cn(
                        'h-full min-w-0 px-2 flex items-center rounded-none bg-transparent hover:bg-transparent',
                        window.active
                          ? 'text-text-primary'
                          : 'text-text-secondary'
                      )}
                      aria-label={`Switch to window ${window.index}: ${window.name}`}
                      onClick={() =>
                        store.dispatch({
                          type: 'window/activate',
                          windowId: window.id
                        })
                      }
                    >
                      <span className='font-mono text-[10px] opacity-75 mr-1'>
                        {window.index}
                      </span>
                      <span className='truncate'>{window.name}</span>
                    </Button>
                  </TopBarTooltip>
                  <TopBarTooltip
                    label={
                      windows.length <= 1
                        ? 'Cannot close the last window'
                        : `Close window ${window.index}: ${window.name}`
                    }
                    shortcut={
                      windows.length <= 1
                        ? null
                        : window.active
                        ? getPrefixShortcut('window.close')
                        : null
                    }
                    disabled={windows.length <= 1}
                  >
                    <Button
                      variant='icon'
                      size='icon'
                      disabled={windows.length <= 1}
                      className={cn(
                        'opacity-0 group-hover:opacity-100 rounded-sm hover:bg-surface-4',
                        window.active && 'opacity-100'
                      )}
                      aria-label={`Close window ${window.index}: ${window.name}`}
                      onClick={event => {
                        event.stopPropagation()
                        store.dispatch({
                          type: 'window/close',
                          windowId: window.id
                        })
                      }}
                    >
                      <X className='!h-3 !w-3' />
                    </Button>
                  </TopBarTooltip>
                </div>
              ))}
            </div>
            <TopBarTooltip
              label='Create window'
              shortcut={createWindowShortcut}
            >
              <Button
                variant='icon'
                size='icon'
                aria-label='Create window'
                onClick={() => {
                  store.dispatch({ type: 'window/create' })
                }}
              >
                <Plus />
              </Button>
            </TopBarTooltip>
          </div>
          <div className='flex-1' />
          <TopBarTooltip
            label='Open key bindings'
            shortcut={openKeyBindingsShortcut}
          >
            <Button
              variant='icon'
              size='icon'
              aria-label='Open key bindings'
              onClick={openKeyBindings}
            >
              <Keyboard />
            </Button>
          </TopBarTooltip>
          <TopBarTooltip
            label='Open coordinator'
            shortcut={openCoordinatorShortcut}
          >
            <Button
              variant='icon'
              size='icon'
              aria-label='Open coordinator'
              onClick={openCoordinator}
            >
              <Bot />
            </Button>
          </TopBarTooltip>
          <TopBarTooltip
            label='Split (side-by-side)'
            shortcut={splitRightShortcut}
            disabled={!focusedLeafId}
          >
            <Button
              variant='icon'
              size='icon'
              disabled={!focusedLeafId}
              aria-label='Split (side-by-side)'
              onClick={() => {
                if (!focusedLeafId) return
                store.dispatch({
                  type: 'leaf/split',
                  leafId: focusedLeafId,
                  dir: 'row'
                })
              }}
            >
              <Columns2 />
            </Button>
          </TopBarTooltip>
          <TopBarTooltip
            label='Stack (top-to-bottom)'
            shortcut={splitDownShortcut}
            disabled={!focusedLeafId}
          >
            <Button
              variant='icon'
              size='icon'
              disabled={!focusedLeafId}
              aria-label='Stack (top-to-bottom)'
              onClick={() => {
                if (!focusedLeafId) return
                store.dispatch({
                  type: 'leaf/split',
                  leafId: focusedLeafId,
                  dir: 'col'
                })
              }}
            >
              <Rows2 />
            </Button>
          </TopBarTooltip>
          <TopBarTooltip
            label='Close focused pane'
            shortcut={closePaneShortcut}
            disabled={!canCloseFocused}
          >
            <Button
              variant='icon'
              size='icon'
              disabled={!canCloseFocused}
              aria-label='Close focused pane'
              onClick={() => {
                if (!focusedLeafId) return
                store.dispatch({ type: 'leaf/close', leafId: focusedLeafId })
              }}
            >
              <X />
            </Button>
          </TopBarTooltip>
        </div>
      </TooltipProvider>

      <div className='flex-1 min-h-0 flex'>
        {sessionPanelOpen ? (
          <div
            className='relative shrink-0 group'
            style={{ width: `${sessionPanelWidthPx}px` }}
            ref={sessionPanelContainerRef}
            onMouseLeave={hideSessionDetailCard}
          >
            <aside className='h-full border-r bg-surface-1 flex flex-col min-h-0'>
              {!auth.user ? (
                <div className='p-3 text-sm text-text-secondary'>
                  Log in to create and view sessions.
                </div>
              ) : (
                <>
                  <div className='p-3 border-b space-y-2'>
                    <Button
                      size='sm'
                      className='w-full justify-center'
                      onClick={() => {
                        void createSessionMutation.mutateAsync()
                      }}
                      disabled={!canCreateSession}
                    >
                      {createSessionMutation.isPending ? (
                        <Loader2 className='animate-spin' />
                      ) : (
                        <Plus />
                      )}
                      {createSessionMutation.isPending
                        ? 'Creating…'
                        : 'Create new session'}
                    </Button>
                    <div className='flex items-center justify-between gap-1'>
                      <div ref={sessionFilterTriggerRef}>
                        <FilterMenu
                          items={[
                            {
                              id: 'imageId',
                              label: 'Image name',
                              kind: 'select',
                              value: sessionFilters.imageId,
                              options: imageFilterOptions,
                              isActive:
                                sessionFilters.imageId.trim().length > 0,
                              searchable: true,
                              multiSelect: true,
                              onChange: value =>
                                setSessionFilters(prev => ({
                                  ...prev,
                                  imageId: value
                                }))
                            },
                            {
                              id: 'agentId',
                              label: 'Agent',
                              kind: 'select',
                              value: sessionFilters.agentId,
                              options: agentFilterOptions,
                              isActive:
                                sessionFilters.agentId.trim().length > 0,
                              searchable: true,
                              multiSelect: true,
                              onChange: value =>
                                setSessionFilters(prev => ({
                                  ...prev,
                                  agentId: value
                                }))
                            },
                            {
                              id: 'createdBy',
                              label: 'Created by',
                              kind: 'select',
                              value: sessionFilters.createdBy,
                              options: createdByFilterOptions,
                              isActive:
                                sessionFilters.createdBy.trim().length > 0,
                              searchable: true,
                              multiSelect: true,
                              onChange: value =>
                                setSessionFilters(prev => ({
                                  ...prev,
                                  createdBy: value
                                }))
                            },
                            {
                              id: 'q',
                              label: 'Session name',
                              kind: 'text',
                              value: sessionFilters.q,
                              placeholder: 'Filter by name…',
                              onChange: value =>
                                setSessionFilters(prev => ({
                                  ...prev,
                                  q: value
                                }))
                            },
                            {
                              id: 'status',
                              label: 'Status',
                              kind: 'select',
                              value: sessionFilters.status,
                              options: statusOptions,
                              multiSelect: true,
                              onChange: value =>
                                setSessionFilters(prev => ({
                                  ...prev,
                                  status: value
                                }))
                            },
                            {
                              id: 'archived',
                              label: 'Archived',
                              kind: 'select',
                              value: sessionFilters.archived,
                              isActive: sessionFilters.archived !== 'false',
                              options: [
                                { value: 'false', label: 'False' },
                                { value: 'true', label: 'True' },
                                { value: 'all', label: 'All' }
                              ],
                              onChange: value =>
                                setSessionFilters(prev => ({
                                  ...prev,
                                  archived: value as SessionArchivedFilter
                                }))
                            },
                            {
                              id: 'updatedAtRange',
                              label: 'Updated',
                              kind: 'select',
                              value: sessionFilters.updatedAtRange,
                              options: SESSION_TIME_RANGE_OPTIONS,
                              onChange: value =>
                                setSessionFilters(prev => ({
                                  ...prev,
                                  updatedAtRange: value as SessionTimeRange
                                }))
                            },
                            {
                              id: 'createdAtRange',
                              label: 'Created',
                              kind: 'select',
                              value: sessionFilters.createdAtRange,
                              options: SESSION_TIME_RANGE_OPTIONS,
                              onChange: value =>
                                setSessionFilters(prev => ({
                                  ...prev,
                                  createdAtRange: value as SessionTimeRange
                                }))
                            }
                          ]}
                          onClearAll={resetSessionFilters}
                          className='h-7 w-7'
                        />
                      </div>
                      <FilterSelect
                        label='Group by'
                        value={sessionGroupBy}
                        mode='icon'
                        icon={<Layers className='h-3.5 w-3.5' />}
                        options={SESSION_GROUP_BY_OPTIONS}
                        onChange={setSessionGroupBy}
                      />
                    </div>
                    {imagesQuery.isError ? (
                      <p className='text-xs text-destructive'>
                        {imagesQuery.error instanceof Error
                          ? imagesQuery.error.message
                          : 'Failed to load images'}
                      </p>
                    ) : null}
                  </div>

                  <div
                    className='min-h-0 flex-1 overflow-y-auto'
                    onScrollCapture={hideSessionDetailCard}
                  >
                    {listQueryLoading ? (
                      <div className='p-3 text-sm text-text-secondary'>
                        Loading sessions…
                      </div>
                    ) : listQueryIsError ? (
                      <div className='p-3 text-sm text-destructive'>
                        {listQueryError instanceof Error
                          ? listQueryError.message
                          : 'Failed to load sessions'}
                      </div>
                    ) : hasNoVisibleSessions ? (
                      <div className='p-3 text-sm text-text-secondary'>
                        {hasActiveSessionFilters
                          ? 'No sessions match the current filters.'
                          : 'No sessions yet.'}
                      </div>
                    ) : (
                      <>
                        {sessionGroupBy === 'none' ? (
                          <div className='divide-y divide-border'>
                            {sessions.map(renderSessionItem)}
                          </div>
                        ) : (
                          <div className='divide-y divide-border'>
                            {sessionGroups.map(group => {
                              const groupLabel =
                                sessionGroupBy === 'imageId'
                                  ? group.key === null
                                    ? 'No image'
                                    : imageNameById.get(group.key) ??
                                      group.label
                                  : group.label
                              return (
                                <div key={group.key ?? '__null__'}>
                                  <div className='px-3 py-1.5 border-b bg-surface-2/40 text-[10px] uppercase tracking-wide text-text-tertiary flex items-center justify-between'>
                                    <span className='truncate'>
                                      {groupLabel}
                                    </span>
                                    <span>{group.sessions.length}</span>
                                  </div>
                                  <div className='divide-y divide-border/60'>
                                    {(
                                      group.sessions as GetSessionGroups200DataItem['sessions']
                                    ).map(renderSessionItem)}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </aside>
            {hoveredSessionDetail ? (
              <div
                ref={sessionDetailCardRef}
                className='absolute left-full -ml-px top-0 z-30 hidden md:block'
                style={{
                  transform: `translateY(${hoveredSessionDetail.topPx}px) translateY(-50%)`
                }}
                onMouseEnter={clearSessionDetailHideTimeout}
                onMouseLeave={scheduleHideSessionDetailCard}
              >
                <div className='w-[320px] border border-border bg-surface-1/95 shadow-xl backdrop-blur-sm p-1'>
                  <div className='p-2 pb-1'>
                    <p className='text-xs font-semibold text-text-primary'>
                      {hoveredSessionDetail.session.title?.trim() ||
                        'Untitled session'}
                    </p>
                    <SessionIdDisplay
                      sessionId={hoveredSessionDetail.session.id}
                    />
                  </div>
                  <TooltipProvider delayDuration={200}>
                    <div className='px-2 text-[11px] leading-4'>
                      <SessionMetaRow
                        label='Image'
                        icon={<Package className='h-3.5 w-3.5' />}
                        value={
                          hoveredSessionDetail.session.imageId
                            ? `${
                                imageNameById.get(
                                  hoveredSessionDetail.session.imageId
                                ) ?? hoveredSessionDetail.session.imageId
                              } (${hoveredSessionDetail.session.imageId})`
                            : 'No image'
                        }
                        copyable={!!hoveredSessionDetail.session.imageId}
                      />
                      <SessionMetaRow
                        label='Agent'
                        icon={<Bot className='h-3.5 w-3.5' />}
                        value={`${
                          agentNameById.get(
                            hoveredSessionDetail.session.agentId
                          ) ?? hoveredSessionDetail.session.agentId
                        } (${hoveredSessionDetail.session.agentId})`}
                        copyable
                      />
                      <SessionMetaRow
                        label='Harness'
                        icon={<PiParachute className='h-3.5 w-3.5' />}
                        value={
                          hoveredSessionDetail.session.harness || 'unknown'
                        }
                      />
                      <SessionMetaRow
                        label='Created by'
                        icon={<User className='h-3.5 w-3.5' />}
                        value={
                          userNameById.get(
                            hoveredSessionDetail.session.createdBy
                          ) ?? hoveredSessionDetail.session.createdBy
                        }
                      />
                      <SessionMetaRow
                        label='Updated'
                        icon={<Calendar className='h-3.5 w-3.5' />}
                        value={
                          formatTimestamp(
                            hoveredSessionDetail.session.updatedAt
                          ) || hoveredSessionDetail.session.updatedAt
                        }
                      />
                    </div>
                  </TooltipProvider>
                  <div className='flex flex-col'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='h-7 justify-start text-xs [&_svg]:size-3.5'
                      title='Open in this pane'
                      aria-label='Open in this pane'
                      onClick={() =>
                        openAgentSession({
                          agentId: hoveredSessionDetail.session.agentId,
                          sessionId: hoveredSessionDetail.session.id,
                          sessionTitle: hoveredSessionDetail.session.title,
                          placement: 'self'
                        })
                      }
                    >
                      <Square />
                      Open on selected pane
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='h-7 justify-start text-xs [&_svg]:size-3.5'
                      title='Open on the right (split)'
                      aria-label='Open on the right (split)'
                      onClick={() =>
                        openAgentSession({
                          agentId: hoveredSessionDetail.session.agentId,
                          sessionId: hoveredSessionDetail.session.id,
                          sessionTitle: hoveredSessionDetail.session.title,
                          placement: 'right'
                        })
                      }
                    >
                      <Columns2 />
                      Open to side
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='h-7 justify-start text-xs [&_svg]:size-3.5'
                      title='Open on the bottom (stack)'
                      aria-label='Open on the bottom (stack)'
                      onClick={() =>
                        openAgentSession({
                          agentId: hoveredSessionDetail.session.agentId,
                          sessionId: hoveredSessionDetail.session.id,
                          sessionTitle: hoveredSessionDetail.session.title,
                          placement: 'bottom'
                        })
                      }
                    >
                      <Rows2 />
                      Open to bottom
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='h-7 justify-start text-xs [&_svg]:size-3.5'
                      title='Open to window side (full height split)'
                      aria-label='Open to window side'
                      onClick={() =>
                        openAgentSessionToWindowSplit({
                          agentId: hoveredSessionDetail.session.agentId,
                          sessionId: hoveredSessionDetail.session.id,
                          sessionTitle: hoveredSessionDetail.session.title,
                          dir: 'row'
                        })
                      }
                    >
                      <TbTableColumn className='-scale-x-100' />
                      Open to window side
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='h-7 justify-start text-xs [&_svg]:size-3.5'
                      title='Open to window bottom (full width split)'
                      aria-label='Open to window bottom'
                      onClick={() =>
                        openAgentSessionToWindowSplit({
                          agentId: hoveredSessionDetail.session.agentId,
                          sessionId: hoveredSessionDetail.session.id,
                          sessionTitle: hoveredSessionDetail.session.title,
                          dir: 'col'
                        })
                      }
                    >
                      <TbTableRow className='-scale-y-100' />
                      Open to window bottom
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
            <div
              role='separator'
              aria-orientation='vertical'
              aria-label='Resize sessions side panel'
              className='absolute top-0 right-0 bottom-0 w-3 translate-x-1/2 cursor-col-resize touch-none z-10'
              onPointerDown={startSessionPanelResize}
            >
              <div
                className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] transition-opacity ${
                  isSessionPanelResizing
                    ? 'bg-border/90 opacity-100'
                    : 'bg-border/80 opacity-0 group-hover:opacity-100'
                }`}
              />
            </div>
          </div>
        ) : null}

        <div className='flex-1 min-h-0 min-w-0'>
          <LayoutNodeView
            node={activeWindowRoot}
            paneExpandShortcut={paneExpandShortcut}
          />
        </div>
      </div>
    </div>
  )
}
