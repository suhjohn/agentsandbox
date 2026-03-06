import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { PickerPopover } from '@/components/ui/picker-popover'
import { Loader } from '@/components/loader'
import { cn } from '@/lib/utils'
import { Archive, Check, Copy, Loader2, Settings } from 'lucide-react'
import { toast } from 'sonner'
import {
  usePostAgentsAgentIdArchive,
  useGetAgentsAgentId,
  useGetAgentsAgentIdAccess,
  useGetSession,
  type GetAgentsAgentId200,
  type GetAgentsAgentIdAccess200,
  type GetSession200DataItem,
  type GetSession200,
  type GetSessionParams
} from '@/api/generated/agent-manager'
import { getHealth, type GetHealth200, type GetSessionId200MessagesItem } from '@/api/generated/agent'
import type { AgentRuntimeRequestInit } from '@/api/orval-agent-fetcher'
import type {
  PanelDefinition,
  PanelHeaderProps,
  PanelProps,
  PanelSettingsProps
} from './types'
import { AgentPicker, SessionPicker } from './agent-pickers'
import {
  AgentSessionPanel,
  getSessionMessages,
  type AgentSessionPanelConfig
} from './agent-session'
import {
  AgentTerminalPanel,
  type AgentTerminalPanelConfig
} from './agent-terminal'
import {
  AgentBrowserPanel,
  type AgentBrowserPanelConfig
} from './agent-browser'
import {
  AgentDiffPanel,
  readAgentDiffStylePreference,
  writeAgentDiffStylePreference,
  type AgentDiffPanelConfig
} from './agent-diff'
import { useWorkspaceStore } from '../store'
import { formatLastMessagePreview } from '@/utils/message-preview'
import { parseBody } from './session-message-utils'

export interface AgentDetailPanelConfig {
  readonly agentId: string
  readonly agentName?: string
  readonly activeTab: AgentDetailTab
  readonly sessionLimit: number
  readonly sessionId: string
  readonly sessionTitle?: string
  readonly sessionModel?: string
  readonly diffStyle?: 'split' | 'unified'
}

type AgentDetailTab =
  | 'session_list'
  | 'session_detail'
  | 'terminal'
  | 'browser'
  | 'diff'

const AGENT_DETAIL_VIEW_ITEMS: ReadonlyArray<{
  readonly id: AgentDetailTab
  readonly label: string
}> = [
  { id: 'session_list', label: 'Session List' },
  { id: 'session_detail', label: 'Session Detail' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'browser', label: 'Browser' },
  { id: 'diff', label: 'Diff' }
]

function getAgentDetailViewLabel (tab: AgentDetailTab): string {
  const option = AGENT_DETAIL_VIEW_ITEMS.find(item => item.id === tab)
  return option?.label ?? 'Session List'
}

function clampLimit (value: number): number {
  if (!Number.isFinite(value)) return 20
  return Math.min(50, Math.max(1, Math.round(value)))
}

function parseDetailTab (value: unknown): AgentDetailTab {
  return value === 'session_detail' ||
    value === 'terminal' ||
    value === 'browser' ||
    value === 'diff'
    ? value
    : 'session_list'
}

function resolveAgentDetailSessionId (input: {
  readonly sessionId: string
}): string {
  const sessionId = input.sessionId.trim()
  if (sessionId.toLowerCase() === 'new') return ''
  return sessionId
}

function deserializeAgentDetailConfig (raw: unknown): AgentDetailPanelConfig {
  if (typeof raw !== 'object' || raw === null) {
    return {
      agentId: '',
      agentName: '',
      activeTab: 'session_list',
      sessionLimit: 20,
      sessionId: '',
      sessionTitle: '',
      sessionModel: undefined
    }
  }
  const v = raw as Record<string, unknown>
  const agentId = typeof v.agentId === 'string' ? v.agentId : ''
  const agentName = typeof v.agentName === 'string' ? v.agentName : ''
  const activeTab = parseDetailTab(v.activeTab)
  const sessionLimit = clampLimit(
    typeof v.sessionLimit === 'number' ? v.sessionLimit : 20
  )
  const rawSessionId = typeof v.sessionId === 'string' ? v.sessionId : ''
  const sessionId = resolveAgentDetailSessionId({
    sessionId: rawSessionId
  })
  const sessionTitle = typeof v.sessionTitle === 'string' ? v.sessionTitle : ''
  const sessionModel =
    typeof v.sessionModel === 'string' ? v.sessionModel : undefined
  const diffStyle =
    v.diffStyle === 'unified' || v.diffStyle === 'split'
      ? v.diffStyle
      : undefined
  return {
    agentId,
    agentName,
    activeTab,
    sessionLimit,
    sessionId,
    sessionTitle,
    sessionModel,
    diffStyle
  }
}

function unwrapAgent (value: unknown): GetAgentsAgentId200 | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.data === 'object' && v.data !== null) {
    const d = v.data as Record<string, unknown>
    if (typeof d.id === 'string') return d as GetAgentsAgentId200
  }
  if (typeof v.id === 'string') return v as GetAgentsAgentId200
  return null
}

function unwrapAccess (value: unknown): GetAgentsAgentIdAccess200 | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.data === 'object' && v.data !== null) {
    const d = v.data as Record<string, unknown>
    if (
      typeof d.agentApiUrl === 'string' &&
      typeof d.agentAuthToken === 'string'
    ) {
      return d as GetAgentsAgentIdAccess200
    }
  }
  if (
    typeof v.agentApiUrl === 'string' &&
    typeof v.agentAuthToken === 'string'
  ) {
    return v as GetAgentsAgentIdAccess200
  }
  return null
}

function unwrapSessions (value: unknown): GetSession200 | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (Array.isArray(v.data)) return v as GetSession200
  if (typeof v.data === 'object' && v.data !== null) {
    const d = v.data as Record<string, unknown>
    if (Array.isArray(d.data)) return d as GetSession200
  }
  return null
}

function unwrapHealth (value: unknown): GetHealth200 | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.data === 'object' && v.data !== null) {
    const d = v.data as Record<string, unknown>
    if (typeof d.status === 'string' && typeof d.timestamp === 'string') {
      return d as GetHealth200
    }
  }
  if (typeof v.status === 'string' && typeof v.timestamp === 'string') {
    return v as GetHealth200
  }
  return null
}

function toErrorMessage (value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'object' && value !== null && 'error' in value) {
    const err = (value as { error?: unknown }).error
    if (typeof err === 'string' && err.trim().length > 0) return err
  }
  if (typeof value === 'string' && value.trim().length > 0) return value
  return 'Something went wrong.'
}

export function AgentDetailPanel (props: PanelProps<AgentDetailPanelConfig>) {
  const resolvedSessionId = useMemo(
    () =>
      resolveAgentDetailSessionId({
        sessionId: props.config.sessionId
      }),
    [props.config.activeTab, props.config.agentId, props.config.sessionId]
  )

  const sessionConfig: AgentSessionPanelConfig = useMemo(
    () => ({
      agentId: props.config.agentId,
      agentName: props.config.agentName,
      sessionId: resolvedSessionId,
      sessionTitle: props.config.sessionTitle,
      sessionModel: props.config.sessionModel
    }),
    [
      props.config.agentId,
      props.config.agentName,
      resolvedSessionId,
      props.config.sessionTitle,
      props.config.sessionModel
    ]
  )
  const terminalConfig: AgentTerminalPanelConfig = useMemo(
    () => ({
      agentId: props.config.agentId,
      agentName: props.config.agentName
    }),
    [props.config.agentId, props.config.agentName]
  )
  const browserConfig: AgentBrowserPanelConfig = useMemo(
    () => ({
      agentId: props.config.agentId,
      agentName: props.config.agentName
    }),
    [props.config.agentId, props.config.agentName]
  )
  const diffConfig: AgentDiffPanelConfig = useMemo(
    () => ({
      agentId: props.config.agentId,
      agentName: props.config.agentName,
      diffStyle: props.config.diffStyle
    }),
    [props.config.agentId, props.config.agentName, props.config.diffStyle]
  )

  const setSessionConfig = useCallback(
    (updater: (prev: AgentSessionPanelConfig) => AgentSessionPanelConfig) => {
      props.setConfig(prev => {
        const next = updater({
          agentId: prev.agentId,
          agentName: prev.agentName,
          sessionId: prev.sessionId,
          sessionTitle: prev.sessionTitle,
          sessionModel: prev.sessionModel
        })
        return {
          ...prev,
          agentId: next.agentId,
          agentName: next.agentName,
          sessionId: next.sessionId,
          sessionTitle: next.sessionTitle,
          sessionModel: next.sessionModel
        }
      })
    },
    [props.setConfig]
  )
  const setTerminalConfig = useCallback(
    (updater: (prev: AgentTerminalPanelConfig) => AgentTerminalPanelConfig) => {
      props.setConfig(prev => {
        const next = updater({
          agentId: prev.agentId,
          agentName: prev.agentName
        })
        return {
          ...prev,
          agentId: next.agentId,
          agentName: next.agentName
        }
      })
    },
    [props.setConfig]
  )
  const setBrowserConfig = useCallback(
    (updater: (prev: AgentBrowserPanelConfig) => AgentBrowserPanelConfig) => {
      props.setConfig(prev => {
        const next = updater({
          agentId: prev.agentId,
          agentName: prev.agentName
        })
        return {
          ...prev,
          agentId: next.agentId,
          agentName: next.agentName
        }
      })
    },
    [props.setConfig]
  )
  const setDiffConfig = useCallback(
    (updater: (prev: AgentDiffPanelConfig) => AgentDiffPanelConfig) => {
      props.setConfig(prev => {
        const next = updater({
          agentId: prev.agentId,
          agentName: prev.agentName,
          diffStyle: prev.diffStyle
        })
        return {
          ...prev,
          agentId: next.agentId,
          agentName: next.agentName,
          diffStyle: next.diffStyle
        }
      })
    },
    [props.setConfig]
  )

  return (
    <div className='h-full min-h-0 flex flex-col'>
      <div className='flex-1 min-h-0 overflow-hidden'>
        {props.config.activeTab === 'session_list' ? (
          <div
            className='h-full min-h-0 overflow-y-auto p-3'
            data-workspace-panel-scroller='true'
          >
            <AgentDetailSessionListView
              config={props.config}
              setConfig={props.setConfig}
            />
          </div>
        ) : props.config.activeTab === 'session_detail' ? (
          <div
            className='h-full min-h-0 overflow-y-auto p-3'
            data-workspace-panel-scroller='true'
          >
            <AgentSessionPanel
              config={sessionConfig}
              setConfig={setSessionConfig}
              runtime={props.runtime}
            />
          </div>
        ) : props.config.activeTab === 'terminal' ? (
          <div className='h-full min-h-0 overflow-hidden'>
            <AgentTerminalPanel
              config={terminalConfig}
              setConfig={setTerminalConfig}
              runtime={props.runtime}
            />
          </div>
        ) : props.config.activeTab === 'browser' ? (
          <div className='h-full min-h-0 overflow-hidden'>
            <AgentBrowserPanel
              config={browserConfig}
              setConfig={setBrowserConfig}
              runtime={props.runtime}
            />
          </div>
        ) : (
          <div className='h-full min-h-0 overflow-hidden'>
            <AgentDiffPanel
              config={diffConfig}
              setConfig={setDiffConfig}
              runtime={props.runtime}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function AgentDetailSessionListView (props: {
  readonly config: AgentDetailPanelConfig
  readonly setConfig: (
    updater: (prev: AgentDetailPanelConfig) => AgentDetailPanelConfig
  ) => void
}) {
  const workspaceStore = useWorkspaceStore()
  const agentId =
    typeof props.config.agentId === 'string' ? props.config.agentId.trim() : ''

  const agentQuery = useGetAgentsAgentId(agentId, {
    query: { enabled: agentId.length > 0 }
  })
  const accessQuery = useGetAgentsAgentIdAccess(agentId, {
    query: {
      enabled: agentId.length > 0,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: false
    }
  })

  const agent = unwrapAgent(agentQuery.data)
  const access = unwrapAccess(accessQuery.data)

  useEffect(() => {
    if (agentId.length === 0) {
      props.setConfig(prev => {
        if ((prev.agentName?.trim() ?? '') === '') return prev
        return { ...prev, agentName: '' }
      })
      return
    }
    const nextName = agent?.name?.trim() ?? ''
    if (nextName.length === 0) return
    props.setConfig(prev => {
      if ((prev.agentName?.trim() ?? '') === nextName) return prev
      return { ...prev, agentName: nextName }
    })
  }, [agent?.name, agentId, props.setConfig])

  const sessionsParams: GetSessionParams = useMemo(
    () => ({
      limit: clampLimit(props.config.sessionLimit),
      agentId: agentId.length > 0 ? agentId : undefined
    }),
    [agentId, props.config.sessionLimit]
  )

  const sessionsQuery = useGetSession<GetSession200>(sessionsParams, {
    query: {
      enabled: agentId.length > 0,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      select: response => {
        const parsed = unwrapSessions(response)
        if (!parsed) throw new Error('Unexpected response shape (getSession).')
        return parsed
      }
    }
  })

  const sessions = sessionsQuery.data?.data ?? []

  const archiveMutation = usePostAgentsAgentIdArchive({
    mutation: {
      onSuccess: (_data, vars) => {
        toast.success('Agent archived')
        workspaceStore.dispatch({
          type: 'agent/archive',
          agentId: vars.agentId
        })
      },
      onError: (err: unknown) => {
        toast.error(
          err instanceof Error ? err.message : 'Failed to archive agent'
        )
      }
    }
  })

  return agentId.length === 0 ? (
    <div className='text-sm text-text-secondary'>
      Select an agent to view details.
    </div>
  ) : agentQuery.isLoading ? (
    <div className='text-sm text-text-secondary'>Loading agent…</div>
  ) : agentQuery.isError ? (
    <div className='text-sm text-destructive'>
      {toErrorMessage(agentQuery.error)}
    </div>
  ) : agent ? (
    <div className='flex flex-col gap-4 min-w-0'>
      <AgentSummary
        agent={agent}
        access={access}
        isArchiving={
          archiveMutation.isPending &&
          archiveMutation.variables?.agentId === agent.id
        }
        onArchive={() => archiveMutation.mutate({ agentId: agent.id })}
      />

      <div className='flex items-center gap-2'>
        <div className='px-2 text-xs font-medium text-text-secondary'>
          Sessions ({sessions.length})
        </div>
        <div className='flex-1' />
        <Button
          size='sm'
          className='h-8'
          onClick={() =>
            props.setConfig(prev => ({
              ...prev,
              activeTab: 'session_detail',
              sessionId: 'new',
              sessionTitle: '',
              sessionModel: undefined
            }))
          }
        >
          New
        </Button>
      </div>

      {sessionsQuery.isLoading ? (
        <div className='text-sm text-text-secondary'>Loading sessions…</div>
      ) : sessionsQuery.isError ? (
        <div className='text-sm text-destructive'>
          {toErrorMessage(sessionsQuery.error)}
        </div>
      ) : sessions.length > 0 ? (
        <div className='flex flex-col gap-0 divide-y divide-border min-w-0 overflow-hidden'>
          {sessions.map(s => (
            <SessionRow
              key={s.id}
              session={s}
              parentAgentId={agent.parentAgentId ?? null}
              onOpen={() =>
                props.setConfig(prev => ({
                  ...prev,
                  activeTab: 'session_detail',
                  sessionId: s.id,
                  sessionTitle: s.title?.trim() || '',
                  sessionModel: s.model?.trim() || undefined
                }))
              }
            />
          ))}
        </div>
      ) : (
        <div className='text-xs text-text-tertiary'>No sessions yet.</div>
      )}
    </div>
  ) : (
    <div className='text-sm text-text-secondary'>Agent not found.</div>
  )
}

function AgentDetailHeader (props: PanelHeaderProps<AgentDetailPanelConfig>) {
  const agentId =
    typeof props.config.agentId === 'string' ? props.config.agentId.trim() : ''
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  const [viewPickerOpen, setViewPickerOpen] = useState(false)
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false)
  const [diffSettingsOpen, setDiffSettingsOpen] = useState(false)
  const agentQuery = useGetAgentsAgentId(agentId, {
    query: { enabled: agentId.length > 0 }
  })
  const accessQuery = useGetAgentsAgentIdAccess(agentId, {
    query: {
      enabled: agentId.length > 0,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: false
    }
  })
  const agent = unwrapAgent(agentQuery.data)
  const access = unwrapAccess(accessQuery.data)
  const viewItems = AGENT_DETAIL_VIEW_ITEMS.map(item => ({
    id: item.id,
    title: item.label
  }))
  const handleAgentPickerOpenChange = useCallback(
    (open: boolean) => {
      setAgentPickerOpen(open)
      props.onPopoverOpenChange?.(
        open || viewPickerOpen || sessionPickerOpen || diffSettingsOpen
      )
    },
    [
      diffSettingsOpen,
      props.onPopoverOpenChange,
      sessionPickerOpen,
      viewPickerOpen
    ]
  )
  const handleViewPickerOpenChange = useCallback(
    (open: boolean) => {
      setViewPickerOpen(open)
      props.onPopoverOpenChange?.(
        agentPickerOpen || open || sessionPickerOpen || diffSettingsOpen
      )
    },
    [
      agentPickerOpen,
      diffSettingsOpen,
      props.onPopoverOpenChange,
      sessionPickerOpen
    ]
  )
  const handleSessionPickerOpenChange = useCallback(
    (open: boolean) => {
      setSessionPickerOpen(open)
      props.onPopoverOpenChange?.(
        agentPickerOpen || viewPickerOpen || open || diffSettingsOpen
      )
    },
    [
      agentPickerOpen,
      diffSettingsOpen,
      props.onPopoverOpenChange,
      viewPickerOpen
    ]
  )
  const handleDiffSettingsOpenChange = useCallback(
    (open: boolean) => {
      setDiffSettingsOpen(open)
      props.onPopoverOpenChange?.(
        agentPickerOpen || viewPickerOpen || sessionPickerOpen || open
      )
    },
    [
      agentPickerOpen,
      props.onPopoverOpenChange,
      sessionPickerOpen,
      viewPickerOpen
    ]
  )
  const resolvedDiffStyle =
    props.config.diffStyle ?? readAgentDiffStylePreference()

  return (
    <div className='flex w-full min-w-0 items-center gap-2'>
      <AgentPicker
        value={agentId}
        selectedAgent={
          agent
            ? {
                id: agent.id,
                name: agent.name ?? null,
                status: agent.status
              }
            : undefined
        }
        onChange={next =>
          props.setConfig(prev => ({
            ...prev,
            agentId: next.agentId,
            agentName: next.agentName?.trim() || '',
            activeTab: 'session_list',
            sessionId: '',
            sessionTitle: '',
            sessionModel: undefined
          }))
        }
        onOpenChange={handleAgentPickerOpenChange}
      />
      <span className='text-text-tertiary text-xs select-none'>/</span>
      <PickerPopover
        valueId={props.config.activeTab}
        valueLabel={getAgentDetailViewLabel(props.config.activeTab)}
        placeholder='Select view'
        queryPlaceholder='Search views…'
        query=''
        onQueryChange={() => {}}
        open={viewPickerOpen}
        onOpenChange={handleViewPickerOpenChange}
        items={viewItems}
        sectionLabel='Views'
        loading={false}
        loadingMore={false}
        error={null}
        hasMore={false}
        onLoadMore={() => {}}
        onSelect={nextTab => {
          const parsedTab = parseDetailTab(nextTab)
          if (parsedTab !== 'diff') {
            setDiffSettingsOpen(false)
          }
          props.setConfig(prev =>
            prev.activeTab === parsedTab
              ? prev
              : {
                  ...prev,
                  activeTab: parsedTab,
                  sessionId: resolveAgentDetailSessionId({
                    sessionId: prev.sessionId
                  })
                }
          )
        }}
        emptyLabel='No views available.'
        showSearch={false}
        showFooter={false}
      />
      {props.config.activeTab === 'diff' ? (
        <>
          <span className='text-text-tertiary text-xs select-none'>/</span>
          <DropdownMenu onOpenChange={handleDiffSettingsOpenChange}>
            <DropdownMenuTrigger asChild>
              <Button
                type='button'
                size='icon'
                variant='icon'
                className='ml-auto'
                title='Diff settings'
                aria-label='Diff settings'
              >
                <Settings className='h-4 w-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='end'
              sideOffset={6}
              className='w-[220px]'
            >
              <DropdownMenuLabel>View</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={resolvedDiffStyle}
                onValueChange={value => {
                  const next = value === 'unified' ? 'unified' : 'split'
                  writeAgentDiffStylePreference(next)
                  props.setConfig(prev =>
                    prev.diffStyle === next
                      ? prev
                      : { ...prev, diffStyle: next }
                  )
                }}
              >
                <DropdownMenuRadioItem value='split'>
                  Split
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value='unified'>
                  Unified
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
      {props.config.activeTab === 'session_detail' ? (
        <>
          <span className='text-text-tertiary text-xs select-none'>/</span>
          <SessionPicker
            agentId={agentId}
            value={props.config.sessionId}
            access={
              access
                ? {
                    agentApiUrl: access.agentApiUrl,
                    agentAuthToken: access.agentAuthToken
                  }
                : null
            }
            disabled={agentId.length === 0}
            onOpenChange={handleSessionPickerOpenChange}
            onChange={next =>
              props.setConfig(prev => ({
                ...prev,
                activeTab: 'session_detail',
                sessionId: next.sessionId,
                sessionTitle: next.sessionTitle?.trim() || '',
                sessionModel: undefined
              }))
            }
          />
        </>
      ) : null}
    </div>
  )
}

function AgentSummary (props: {
  readonly agent: GetAgentsAgentId200
  readonly access: GetAgentsAgentIdAccess200 | null
  readonly isArchiving: boolean
  readonly onArchive: () => void
}) {
  const a = props.agent
  const healthQuery = useQuery({
    queryKey: [
      'agentRuntime',
      a.id,
      'health',
      props.access?.agentApiUrl ?? null
    ],
    enabled: Boolean(props.access?.agentApiUrl),
    refetchInterval: props.access?.agentApiUrl ? 10_000 : false,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!props.access?.agentApiUrl) {
        throw new Error('Missing agent API URL')
      }

      const request: AgentRuntimeRequestInit = {
        signal,
        cache: 'no-store',
        baseUrl: props.access.agentApiUrl,
        agentAuthToken: props.access.agentAuthToken || null
      }
      const res = await getHealth(request)
      const health = unwrapHealth(res)
      if (!health) throw new Error('Unexpected response shape (health).')
      return { ok: health.status === 'ok' } as const
    }
  })

  const healthState: 'alive' | 'offline' | 'unknown' = !props.access
    ?.agentApiUrl
    ? 'unknown'
    : healthQuery.data?.ok
    ? 'alive'
    : healthQuery.isError
    ? 'offline'
    : 'unknown'

  const tooltipContent = [
    `ID: ${a.id}`,
    `Image: ${a.image?.name ?? a.imageId ?? 'None'}`,
    `Region: ${a.region ?? 'Unknown'}`,
    `Status: ${a.status}`,
    `Updated: ${new Date(a.updatedAt).toLocaleString()}`,
    a.createdByUser?.name ? `Created by: ${a.createdByUser.name}` : null
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div className='pb-3 border-b border-border'>
      <div className='flex items-start justify-between gap-4'>
        <div className='min-w-0 cursor-help' title={tooltipContent}>
          <h2
            className='text-lg font-semibold text-text-primary truncate'
            title={a.name || a.id}
          >
            {a.name || a.id}
          </h2>
        </div>
        <div className='flex items-center gap-2 shrink-0'>
          {a.status !== 'archived' && (
            <Button
              size='sm'
              variant='ghost'
              disabled={props.isArchiving}
              onClick={props.onArchive}
              title='Archive agent'
            >
              {props.isArchiving ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <Archive className='h-4 w-4' />
              )}
            </Button>
          )}
          <SandboxLivenessIcon
            state={healthState}
            title={[
              `Agent status: ${a.status}`,
              healthState === 'alive'
                ? 'Sandbox reachable (/health OK)'
                : healthState === 'offline'
                ? 'Sandbox not reachable (/health failed)'
                : 'Sandbox status unknown (no runtime URL or not checked yet)'
            ].join('\n')}
          />
        </div>
      </div>
    </div>
  )
}

function SandboxLivenessIcon (props: {
  readonly state: 'alive' | 'offline' | 'unknown'
  readonly title: string
}) {
  const colorClass =
    props.state === 'alive'
      ? 'bg-emerald-500'
      : props.state === 'offline'
      ? 'bg-rose-500'
      : 'bg-zinc-500'

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center h-6 w-6 rounded-full',
        'bg-surface-2 border border-border'
      )}
      title={props.title}
      aria-label={`Sandbox ${props.state}`}
    >
      <span className={cn('h-2.5 w-2.5 rounded-full', colorClass)} />
    </span>
  )
}

function SessionRow (props: {
  readonly session: GetSession200DataItem
  readonly parentAgentId: string | null
  readonly onOpen: () => void
}) {
  const s = props.session
  const title = s.title?.trim() || 'Untitled session'
  const lastMessagePreview = formatLastMessagePreview(
    s.lastMessageBody,
    renderActivityPlaceholder
  )
  const updatedLabel = formatSessionUpdatedAt(s.updatedAt)

  const tooltipParts = [
    updatedLabel ? `Updated: ${updatedLabel}` : null,
    `Harness: ${s.harness}`,
    props.parentAgentId ? `Parent: ${props.parentAgentId}` : null
  ].filter((part): part is string => Boolean(part))

  return (
    <div
      role='button'
      tabIndex={0}
      className={cn(
        'rounded-none px-2 py-2 cursor-pointer transition-colors min-w-0',
        'hover:bg-surface-3 focus:outline-none focus:ring-2 focus:ring-ring/60'
      )}
      onClick={props.onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          props.onOpen()
        }
      }}
    >
      <div className='flex items-center justify-between gap-2'>
        <div className='min-w-0'>
          <div className='text-sm font-medium text-text-primary truncate'>
            {title}
          </div>
        </div>
      </div>
      {updatedLabel && (
        <div
          className='mt-0.5 text-[11px] text-text-tertiary truncate cursor-help'
          title={tooltipParts.join('\n')}
        >
          {updatedLabel}
        </div>
      )}
      <div className='mt-1 text-xs text-text-secondary truncate'>
        {lastMessagePreview}
      </div>
    </div>
  )
}

function renderActivityPlaceholder (): ReactNode {
  return <Loader label='Working…' />
}

function formatSessionUpdatedAt (value: string): string | null {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  return new Date(time).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function AgentDetailSettings (
  props: PanelSettingsProps<AgentDetailPanelConfig>
) {
  return (
    <div className='space-y-2'>
      <div className='text-xs text-text-tertiary'>Session list limit</div>
      <Input
        value={String(props.config.sessionLimit)}
        onChange={e =>
          props.setConfig(prev => ({
            ...prev,
            sessionLimit: clampLimit(Number(e.target.value))
          }))
        }
        type='number'
        min={1}
        max={50}
      />
    </div>
  )
}

type CopyFormat = 'json' | 'plaintext' | 'markdown'

function extractTextContent (body: unknown): { role: string; text: string } | null {
  const parsed = parseBody(body)
  if (typeof parsed !== 'object' || parsed === null) {
    if (typeof parsed === 'string') return { role: 'message', text: parsed }
    return null
  }
  const rec = parsed as Record<string, unknown>
  const role = typeof rec.role === 'string' ? rec.role : 'message'

  if (typeof rec.content === 'string') return { role, text: rec.content }
  if (Array.isArray(rec.content)) {
    const textParts = rec.content
      .filter(
        (c: unknown) =>
          typeof c === 'object' &&
          c !== null &&
          (c as Record<string, unknown>).type === 'text'
      )
      .map((c: unknown) => String((c as Record<string, unknown>).text ?? ''))
    if (textParts.length > 0) return { role, text: textParts.join('\n') }
  }

  if (typeof rec.type === 'string') {
    if (typeof rec.text === 'string') return { role: rec.type, text: rec.text }
    return { role: rec.type, text: JSON.stringify(parsed) }
  }

  return null
}

function formatMessagesAsPlainText (
  messages: readonly GetSessionId200MessagesItem[]
): string {
  return messages
    .map(m => {
      const extracted = extractTextContent(m.body)
      if (!extracted) return null
      return `[${extracted.role}]: ${extracted.text}`
    })
    .filter(Boolean)
    .join('\n\n')
}

function formatMessagesAsMarkdown (
  messages: readonly GetSessionId200MessagesItem[]
): string {
  return messages
    .map(m => {
      const extracted = extractTextContent(m.body)
      if (!extracted) return null
      return `**${extracted.role}**\n\n${extracted.text}`
    })
    .filter(Boolean)
    .join('\n\n---\n\n')
}

function formatMessages (
  messages: readonly GetSessionId200MessagesItem[],
  format: CopyFormat
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(messages, null, 2)
    case 'plaintext':
      return formatMessagesAsPlainText(messages)
    case 'markdown':
      return formatMessagesAsMarkdown(messages)
  }
}

function AgentDetailActions (props: PanelHeaderProps<AgentDetailPanelConfig>) {
  const [copied, setCopied] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const agentId = props.config.agentId?.trim() ?? ''
  const sessionId = props.config.sessionId?.trim() ?? ''

  const accessQuery = useGetAgentsAgentIdAccess(agentId, {
    query: {
      enabled: agentId.length > 0,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: false
    }
  })
  const access = unwrapAccess(accessQuery.data)

  const isVisible =
    props.config.activeTab === 'session_detail' && sessionId.length > 0

  const setOpen = useCallback(
    (open: boolean) => {
      setDropdownOpen(open)
      props.onPopoverOpenChange?.(open)
    },
    [props.onPopoverOpenChange]
  )

  const doCopy = useCallback(
    async (format: CopyFormat) => {
      if (!access?.agentApiUrl) return
      const messages = getSessionMessages(agentId, sessionId, access.agentApiUrl)
      if (messages.length === 0) {
        toast.error('No messages to copy')
        return
      }
      const text = formatMessages(messages, format)
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success('Copied!')
      setTimeout(() => setCopied(false), 2000)
    },
    [agentId, sessionId, access?.agentApiUrl]
  )

  if (!isVisible) return null

  return (
    <DropdownMenu open={dropdownOpen} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          variant='icon'
          size='icon'
          className='h-6 w-6 shrink-0'
          title='Copy thread'
          aria-label='Copy thread'
          onClick={e => {
            e.preventDefault()
            setOpen(false)
            void doCopy('json')
          }}
          onPointerEnter={() => {
            hoverTimeoutRef.current = setTimeout(() => {
              setOpen(true)
            }, 300)
          }}
          onPointerLeave={() => {
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current)
              hoverTimeoutRef.current = null
            }
          }}
        >
          {copied ? (
            <Check className='h-3.5 w-3.5' />
          ) : (
            <Copy className='h-3.5 w-3.5' />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' sideOffset={4}>
        <DropdownMenuLabel>Copy as</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => void doCopy('plaintext')}>
          Plain text
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void doCopy('markdown')}>
          Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void doCopy('json')}>
          JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const agentDetailPanelDefinition: PanelDefinition<AgentDetailPanelConfig> =
  {
    type: 'agent_detail',
    title: 'Agent Detail',
    configVersion: 1,
    defaultConfig: {
      agentId: '',
      agentName: '',
      activeTab: 'session_list',
      sessionLimit: 20,
      sessionId: '',
      sessionTitle: '',
      sessionModel: undefined
    },
    deserializeConfig: raw => deserializeAgentDetailConfig(raw),
    getTitle: config => {
      const agentName = config.agentName?.trim() || ''
      const agentId = config.agentId?.trim() || ''
      const agentLabel = agentName || (agentId.length > 0 ? agentId.slice(0, 8) : '')
      const sessionTitle = config.sessionTitle?.trim() || ''
      if (agentLabel.length > 0 && sessionTitle.length > 0) {
        return `${agentLabel} - ${sessionTitle}`
      }
      if (agentLabel.length > 0) return agentLabel
      if (sessionTitle.length > 0) return sessionTitle
      return 'Agent Detail'
    },
    bodyPadding: 'none',
    getAutoFocusSelector: config =>
      config.activeTab === 'session_detail'
        ? '[data-agent-session-composer-input="true"]'
        : null,
    Component: AgentDetailPanel,
    HeaderComponent: AgentDetailHeader,
    ActionsComponent: AgentDetailActions,
    SettingsComponent: AgentDetailSettings
  }
