import { useCallback, useMemo, useState } from 'react'
import { Archive, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilterMenu } from '@/components/ui/filter-menu'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  GetAgentsArchived,
  GetAgentsNoImage,
  GetAgentsStatus,
  useGetAgents,
  usePostAgentsAgentIdArchive,
  type GetAgents200,
  type GetAgents200DataItem,
  type GetAgents200DataItemSubAgentsItem,
  type GetAgentsParams
} from '@/api/generated/agent-manager'
import type { PanelDefinition, PanelProps, PanelSettingsProps } from './types'
import { useWorkspaceStore } from '../store'

type GroupBy = 'none' | 'imageId' | 'createdBy' | 'status'

export interface ListAgentsPanelConfig {
  readonly status: GetAgentsStatus | 'all'
  readonly archived: GetAgentsArchived | 'all'
  readonly noImage: GetAgentsNoImage | 'all'
  readonly imageId: string
  readonly limit: number
  readonly groupBy: GroupBy
}

function clampLimit (value: number): number {
  if (!Number.isFinite(value)) return 20
  return Math.min(50, Math.max(1, Math.round(value)))
}

function deserializeListAgentsConfig (
  raw: unknown,
  _version: number | undefined
): ListAgentsPanelConfig {
  if (typeof raw !== 'object' || raw === null) {
    return {
      status: 'all',
      archived: 'all',
      noImage: 'all',
      imageId: '',
      limit: 20,
      groupBy: 'none'
    }
  }
  const v = raw as Record<string, unknown>
  const status =
    v.status === 'all' ||
    v.status === GetAgentsStatus.active ||
    v.status === GetAgentsStatus.completed ||
    v.status === GetAgentsStatus.archived
      ? (v.status as ListAgentsPanelConfig['status'])
      : 'all'
  const archived =
    v.archived === 'all' ||
    v.archived === GetAgentsArchived.true ||
    v.archived === GetAgentsArchived.false
      ? (v.archived as ListAgentsPanelConfig['archived'])
      : 'all'
  const noImage =
    v.noImage === 'all' ||
    v.noImage === GetAgentsNoImage.true ||
    v.noImage === GetAgentsNoImage.false
      ? (v.noImage as ListAgentsPanelConfig['noImage'])
      : 'all'
  const imageId = typeof v.imageId === 'string' ? v.imageId : ''
  const limit = clampLimit(typeof v.limit === 'number' ? v.limit : 20)
  const groupBy: GroupBy =
    v.groupBy === 'none' ||
    v.groupBy === 'imageId' ||
    v.groupBy === 'createdBy' ||
    v.groupBy === 'status'
      ? (v.groupBy as GroupBy)
      : 'none'
  return { status, archived, noImage, imageId, limit, groupBy }
}

function toParams (config: ListAgentsPanelConfig): GetAgentsParams {
  const params: GetAgentsParams = { limit: clampLimit(config.limit) }
  if (config.status !== 'all') params.status = config.status
  if (config.archived !== 'all') params.archived = config.archived
  if (config.noImage !== 'all') params.noImage = config.noImage
  if (config.imageId.trim()) params.imageId = config.imageId.trim()
  return params
}

function unwrapGetAgents200 (value: unknown): GetAgents200 | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (Array.isArray(v.data)) return v as GetAgents200
  if (Array.isArray(v.agents)) return v as GetAgents200
  return null
}

type AgentGroup = {
  readonly key: string
  readonly label: string
  readonly latestUpdatedAtMs: number
  readonly agents: readonly GetAgents200DataItem[]
}

function getGroupKey (agent: GetAgents200DataItem, groupBy: GroupBy): string {
  switch (groupBy) {
    case 'imageId':
      return agent.imageId ?? ''
    case 'createdBy':
      return agent.createdBy ?? ''
    case 'status':
      return agent.status
    case 'none':
    default:
      return ''
  }
}

function getGroupLabel (
  agent: GetAgents200DataItem,
  groupBy: GroupBy
): string {
  switch (groupBy) {
    case 'imageId':
      return agent.image?.name ?? agent.imageId ?? 'No image'
    case 'createdBy':
      return agent.createdByUser?.name ?? agent.createdBy ?? '—'
    case 'status':
      return agent.status
    case 'none':
    default:
      return '—'
  }
}

function ListAgentsPanel (props: PanelProps<ListAgentsPanelConfig>) {
  const workspaceStore = useWorkspaceStore()
  const params = useMemo(() => toParams(props.config), [props.config])

  const query = useGetAgents(params, {
    query: {
      staleTime: 5_000,
      refetchOnWindowFocus: false
    }
  })

  const archiveMutation = usePostAgentsAgentIdArchive({
    mutation: {
      onSuccess: (_data, vars) => {
        toast.success('Agent archived')
        workspaceStore.dispatch({
          type: 'agent/archive',
          agentId: vars.agentId
        })
        void query.refetch()
      },
      onError: (err: unknown) => {
        toast.error(
          err instanceof Error ? err.message : 'Failed to archive agent'
        )
      }
    }
  })

  const result = unwrapGetAgents200(query.data)
  const agents = result?.data ?? []

  const [collapsedGroupsState, setCollapsedGroupsState] = useState<{
    readonly groupBy: GroupBy
    readonly map: Record<string, boolean>
  }>({ groupBy: props.config.groupBy, map: {} })
  const collapsedGroups =
    collapsedGroupsState.groupBy === props.config.groupBy
      ? collapsedGroupsState.map
      : {}

  const toggleGroup = useCallback(
    (key: string) => {
      setCollapsedGroupsState(prev => {
        const base =
          prev.groupBy === props.config.groupBy ? prev.map : {}
        return {
          groupBy: props.config.groupBy,
          map: { ...base, [key]: !(base[key] ?? false) }
        }
      })
    },
    [props.config.groupBy]
  )

  const resetFilters = useCallback(() => {
    props.setConfig(prev => ({
      ...prev,
      status: 'all',
      archived: 'all',
      noImage: 'all',
      imageId: '',
      groupBy: 'none'
    }))
  }, [props.setConfig])

  const groups: readonly AgentGroup[] = useMemo(() => {
    if (props.config.groupBy === 'none') return []

    const byKey = new Map<
      string,
      {
        label: string
        agents: GetAgents200DataItem[]
        latestUpdatedAtMs: number
      }
    >()
    for (const agent of agents) {
      const key = getGroupKey(agent, props.config.groupBy)
      const existing = byKey.get(key)
      const agentUpdatedAtMs = Date.parse(agent.updatedAt)
      const updatedAtMs = Number.isFinite(agentUpdatedAtMs)
        ? agentUpdatedAtMs
        : 0

      if (existing) {
        existing.agents.push(agent)
        existing.latestUpdatedAtMs = Math.max(
          existing.latestUpdatedAtMs,
          updatedAtMs
        )
      } else {
        byKey.set(key, {
          label: getGroupLabel(agent, props.config.groupBy),
          agents: [agent],
          latestUpdatedAtMs: updatedAtMs
        })
      }
    }

    const out: AgentGroup[] = []
    for (const [key, value] of byKey.entries()) {
      out.push({
        key,
        label: value.label,
        latestUpdatedAtMs: value.latestUpdatedAtMs,
        agents: value.agents
      })
    }
    out.sort((a, b) => b.latestUpdatedAtMs - a.latestUpdatedAtMs)
    return out
  }, [agents, props.config.groupBy])

  return (
    <div className='space-y-3 min-w-0'>
      <div className='flex flex-wrap items-center gap-2'>
        <FilterMenu
          items={[
            {
              id: 'status',
              label: 'Status',
              kind: 'select',
              value: props.config.status,
              options: [
                { value: 'all', label: 'All' },
                { value: GetAgentsStatus.active, label: 'Active' },
                { value: GetAgentsStatus.completed, label: 'Completed' },
                { value: GetAgentsStatus.archived, label: 'Archived' }
              ],
              onChange: value =>
                props.setConfig(prev => ({
                  ...prev,
                  status: value as ListAgentsPanelConfig['status']
                }))
            },
            {
              id: 'archived',
              label: 'Archived',
              kind: 'select',
              value: props.config.archived,
              options: [
                { value: 'all', label: 'All' },
                { value: GetAgentsArchived.true, label: 'True' },
                { value: GetAgentsArchived.false, label: 'False' }
              ],
              onChange: value =>
                props.setConfig(prev => ({
                  ...prev,
                  archived: value as ListAgentsPanelConfig['archived']
                }))
            },
            {
              id: 'noImage',
              label: 'No image',
              kind: 'select',
              value: props.config.noImage,
              options: [
                { value: 'all', label: 'All' },
                { value: GetAgentsNoImage.true, label: 'True' },
                { value: GetAgentsNoImage.false, label: 'False' }
              ],
              onChange: value =>
                props.setConfig(prev => ({
                  ...prev,
                  noImage: value as ListAgentsPanelConfig['noImage']
                }))
            },
            {
              id: 'imageId',
              label: 'Image',
              kind: 'text',
              value: props.config.imageId,
              placeholder: 'imageId',
              onChange: value =>
                props.setConfig(prev => ({ ...prev, imageId: value }))
            },
            {
              id: 'groupBy',
              label: 'Group by',
              kind: 'select',
              value: props.config.groupBy,
              options: [
                { value: 'none', label: 'None' },
                { value: 'imageId', label: 'Image' },
                { value: 'createdBy', label: 'Creator' },
                { value: 'status', label: 'Status' }
              ],
              onChange: value =>
                props.setConfig(prev => ({
                  ...prev,
                  groupBy: value as ListAgentsPanelConfig['groupBy']
                }))
            }
          ]}
          onClearAll={resetFilters}
        />

        <div className='flex-1' />

        <Button
          size='sm'
          className='h-8'
          onClick={() => props.runtime.replaceSelf('agent_create')}
        >
          Create
        </Button>
      </div>

      {query.isLoading ? (
        <div className='text-sm text-text-secondary'>Loading agents…</div>
      ) : query.isError ? (
        <div className='text-sm text-destructive'>
          {(query.error as Error).message}
        </div>
      ) : (
        <div className='space-y-2'>
          <div className='px-2 text-xs text-text-tertiary'>
            {agents.length} agents
          </div>
          {props.config.groupBy === 'none' ? (
            <div className='grid gap-2'>
              {agents.map(agent => {
                const subAgents = agent.subAgents ?? []
                return (
                  <div key={agent.id}>
                    <AgentRow
                      agent={agent}
                      subAgentCount={subAgents.length}
                      isArchiving={
                        archiveMutation.isPending &&
                        archiveMutation.variables?.agentId === agent.id
                      }
                      onOpen={() =>
                        props.runtime.openPanel(
                          'agent_detail',
                          {
                            agentId: agent.id,
                            agentName: agent.name?.trim() || '',
                            activeTab: 'session_list',
                            sessionLimit: 20,
                            sessionId: '',
                            sessionTitle: '',
                            diffBasis: 'repo_head',
                            diffStyle: 'split'
                          },
                          { placement: 'right' }
                        )
                      }
                      onArchive={() =>
                        archiveMutation.mutate({ agentId: agent.id })
                      }
                    />
                    {subAgents.length > 0 && (
                      <div className='ml-4 border-l border-border'>
                        {subAgents.map(child => (
                          <AgentRow
                            key={child.id}
                            agent={child}
                            depth={1}
                            isArchiving={
                              archiveMutation.isPending &&
                              archiveMutation.variables?.agentId === child.id
                            }
                            onOpen={() =>
                              props.runtime.openPanel(
                                'agent_detail',
                                {
                                  agentId: child.id,
                                  agentName: child.name?.trim() || '',
                                  activeTab: 'session_list',
                                  sessionLimit: 20,
                                  sessionId: '',
                                  sessionTitle: '',
                                  diffBasis: 'repo_head',
                                  diffStyle: 'split'
                                },
                                { placement: 'right' }
                              )
                            }
                            onArchive={() =>
                              archiveMutation.mutate({ agentId: child.id })
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className='space-y-2'>
              {groups.map(group => {
                const keyStr = group.key.length > 0 ? group.key : '__empty__'
                const isCollapsed = collapsedGroups[keyStr] ?? false
                return (
                  <div
                    key={keyStr}
                    className='rounded-none border border-border bg-surface-2'
                  >
                    <div
                      role='button'
                      tabIndex={0}
                      className={cn(
                        'flex items-center justify-between gap-2 px-3 py-2 cursor-pointer',
                        'hover:bg-surface-2/80 focus:outline-none focus:ring-2 focus:ring-ring/60'
                      )}
                      onClick={() => toggleGroup(keyStr)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleGroup(keyStr)
                        }
                      }}
                      title={isCollapsed ? 'Expand group' : 'Collapse group'}
                    >
                      <div className='flex items-center gap-2 min-w-0'>
                        {isCollapsed ? (
                          <ChevronRight className='h-4 w-4 text-text-tertiary' />
                        ) : (
                          <ChevronDown className='h-4 w-4 text-text-tertiary' />
                        )}
                        <div className='text-sm font-medium text-text-secondary truncate'>
                          {group.label}
                        </div>
                      </div>
                      <div className='text-xs text-text-tertiary'>
                        {group.agents.length}
                      </div>
                    </div>

                    {!isCollapsed ? (
                      <div className='grid gap-2 p-3 pt-0'>
                        {group.agents.map(agent => (
                          <AgentRow
                            key={agent.id}
                            agent={agent}
                            isArchiving={
                              archiveMutation.isPending &&
                              archiveMutation.variables?.agentId === agent.id
                            }
                            onOpen={() =>
                              props.runtime.openPanel(
                                'agent_detail',
                                {
                                  agentId: agent.id,
                                  agentName: agent.name?.trim() || '',
                                  activeTab: 'session_list',
                                  sessionLimit: 20,
                                  sessionId: '',
                                  sessionTitle: '',
                                  diffBasis: 'repo_head',
                                  diffStyle: 'split'
                                },
                                { placement: 'right' }
                              )
                            }
                            onArchive={() =>
                              archiveMutation.mutate({ agentId: agent.id })
                            }
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
          {!result ? (
            <div className='text-xs text-text-tertiary'>
              Unexpected response shape.
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

type AgentLike = GetAgents200DataItem | GetAgents200DataItemSubAgentsItem

interface AgentRowProps {
  readonly agent: AgentLike
  readonly onOpen: () => void
  readonly onArchive: () => void
  readonly isArchiving: boolean
  readonly depth?: number
  readonly subAgentCount?: number
}

function AgentRow ({ agent, onOpen, onArchive, isArchiving, depth = 0, subAgentCount = 0 }: AgentRowProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }

  const handleArchiveClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onArchive()
  }

  return (
    <div
      role='button'
      tabIndex={0}
      className={cn(
        'group px-2 py-2 cursor-pointer transition-colors',
        'hover:bg-surface-3 focus:outline-none focus:ring-2 focus:ring-ring/60',
        depth > 0 && 'pl-4'
      )}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
    >
      <div className='flex items-center justify-between gap-3'>
        <div className='flex-1 min-w-0 space-y-1.5'>
          <div className='flex items-baseline gap-2'>
            <span className='font-medium text-sm text-text-primary truncate'>
              {agent.name}
            </span>
            <span
              className='font-mono text-[10px] text-text-tertiary truncate'
              title={agent.id}
            >
              {agent.id.slice(0, 8)}
            </span>
            {subAgentCount > 0 && (
              <span className='text-[10px] text-text-tertiary'>
                ({subAgentCount})
              </span>
            )}
          </div>
          <div className='flex items-center gap-3 text-[11px] text-text-tertiary'>
            <span>{`${new Date(
              agent.updatedAt
            ).toLocaleTimeString()} · ${new Date(
              agent.updatedAt
            ).toLocaleDateString()}`}</span>
          </div>
        </div>

        {agent.status !== 'archived' && (
          <Button
            size='icon'
            variant='icon'
            className='h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary'
            disabled={isArchiving}
            onClick={handleArchiveClick}
            title='Archive agent'
          >
            {isArchiving ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <Archive className='h-4 w-4' />
            )}
          </Button>
        )}
      </div>
    </div>
  )
}

function ListAgentsSettings (props: PanelSettingsProps<ListAgentsPanelConfig>) {
  return (
    <div className='space-y-3'>
      <div className='text-sm text-text-secondary'>
        Filters persist with the window preset.
      </div>
      <div className='grid grid-cols-2 gap-3'>
        <div className='space-y-1.5'>
          <div className='text-xs text-text-tertiary'>Default limit</div>
          <Input
            value={String(props.config.limit)}
            onChange={e =>
              props.setConfig(prev => ({
                ...prev,
                limit: clampLimit(Number(e.target.value))
              }))
            }
            type='number'
            min={1}
            max={50}
          />
        </div>
        <div className='space-y-1.5'>
          <div className='text-xs text-text-tertiary'>Default imageId</div>
          <Input
            value={props.config.imageId}
            onChange={e =>
              props.setConfig(prev => ({ ...prev, imageId: e.target.value }))
            }
            placeholder='(optional)'
          />
        </div>
        <div className='space-y-1.5 col-span-2'>
          <div className='text-xs text-text-tertiary'>Default group by</div>
          <Select
            className='h-9 bg-surface-2 border border-border'
            value={props.config.groupBy}
            onChange={e =>
              props.setConfig(prev => ({
                ...prev,
                groupBy: e.target.value as ListAgentsPanelConfig['groupBy']
              }))
            }
          >
            <option value='none'>None</option>
            <option value='imageId'>Image</option>
            <option value='createdBy'>Creator</option>
            <option value='status'>Status</option>
          </Select>
        </div>
      </div>
    </div>
  )
}

export const listAgentsPanelDefinition: PanelDefinition<ListAgentsPanelConfig> =
  {
    type: 'agent_list',
    title: 'List Agents',
    configVersion: 2,
    defaultConfig: {
      status: 'all',
      archived: 'all',
      noImage: 'all',
      imageId: '',
      limit: 20,
      groupBy: 'none'
    },
    deserializeConfig: deserializeListAgentsConfig,
    getTitle: () => 'List Agents',
    Component: ListAgentsPanel,
    SettingsComponent: ListAgentsSettings
  }
