import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import type { Agent } from '@/lib/api'
import {
  AgentSessionPanel,
  type AgentSessionPanelConfig
} from './agent-session'
import type { PanelDefinition, PanelProps } from './types'

export interface CoordinatorPanelConfig extends AgentSessionPanelConfig {}

function deserializeCoordinatorConfig (
  raw: unknown
): CoordinatorPanelConfig {
  if (typeof raw !== 'object' || raw === null) {
    return {
      agentId: '',
      agentName: '',
      sessionId: '',
      sessionTitle: '',
      sessionModel: undefined,
      sessionModelReasoningEffort: undefined,
      sessionHarness: undefined
    }
  }

  const value = raw as Record<string, unknown>
  return {
    agentId: typeof value.agentId === 'string' ? value.agentId : '',
    agentName:
      typeof value.agentName === 'string' ? value.agentName : '',
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : '',
    sessionTitle:
      typeof value.sessionTitle === 'string' ? value.sessionTitle : '',
    sessionModel:
      typeof value.sessionModel === 'string'
        ? value.sessionModel
        : undefined,
    sessionModelReasoningEffort:
      typeof value.sessionModelReasoningEffort === 'string'
        ? value.sessionModelReasoningEffort
        : undefined,
    sessionHarness:
      typeof value.sessionHarness === 'string'
        ? value.sessionHarness
        : undefined
  }
}

function toErrorMessage (value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string' && value.trim().length > 0) return value
  return 'Something went wrong.'
}

function selectCoordinatorAgent (
  agents: readonly Agent[],
  agentId: string
): Agent | null {
  const targetAgentId = agentId.trim()
  if (targetAgentId.length > 0) {
    const selected = agents.find(agent => agent.id === targetAgentId)
    if (selected) return selected
  }
  return agents[0] ?? null
}

function CoordinatorPanel (props: PanelProps<CoordinatorPanelConfig>) {
  const auth = useAuth()
  const [isDraftingNewSession, setIsDraftingNewSession] = useState(false)

  const coordinatorAgentsQuery = useQuery({
    queryKey: ['coordinatorAgents', auth.user?.id ?? null],
    queryFn: () =>
      auth.api.listAgents({
        createdBy: auth.user?.id,
        type: 'coordinator',
        archived: false,
        limit: 50
      }),
    enabled: !!auth.user && !auth.isBootstrapping
  })

  const coordinatorAgents = coordinatorAgentsQuery.data?.data ?? []
  const selectedAgent = useMemo(
    () => selectCoordinatorAgent(coordinatorAgents, props.config.agentId),
    [coordinatorAgents, props.config.agentId]
  )
  const selectedAgentId = selectedAgent?.id ?? ''

  const sessionsQuery = useQuery({
    queryKey: ['/session', 'coordinator-panel', selectedAgentId, 'false'],
    queryFn: () =>
      auth.api.listSessions({
        agentId: selectedAgentId,
        archived: 'false',
        limit: 50
      }),
    enabled:
      !!auth.user &&
      !auth.isBootstrapping &&
      selectedAgentId.length > 0
  })

  const sessions = sessionsQuery.data?.data ?? []
  const selectedSessionId = props.config.sessionId.trim()
  const activeSessionId =
    selectedSessionId.length > 0
      ? selectedSessionId
      : isDraftingNewSession
        ? ''
        : sessions[0]?.id ?? ''

  useEffect(() => {
    const nextAgent = selectedAgent
    props.setConfig(prev => {
      const prevAgentId = prev.agentId.trim()
      const nextAgentId = nextAgent?.id ?? ''
      const nextAgentName = nextAgent?.name?.trim() ?? ''

      if (prevAgentId === nextAgentId && (prev.agentName?.trim() ?? '') === nextAgentName) {
        return prev
      }

      if (nextAgentId.length === 0) {
        if (
          prevAgentId.length === 0 &&
          (prev.agentName?.trim() ?? '').length === 0 &&
          prev.sessionId.trim().length === 0
        ) {
          return prev
        }
        return {
          ...prev,
          agentId: '',
          agentName: '',
          sessionId: '',
          sessionTitle: ''
        }
      }

      return {
        ...prev,
        agentId: nextAgentId,
        agentName: nextAgentName,
        ...(prevAgentId === nextAgentId
          ? {}
          : { sessionId: '', sessionTitle: '' })
      }
    })
  }, [props.setConfig, selectedAgent])

  useEffect(() => {
    if (selectedAgentId.length === 0 || isDraftingNewSession) return
    if (sessionsQuery.isLoading) return

    const nextSession =
      selectedSessionId.length > 0
        ? sessions.find(session => session.id === selectedSessionId) ?? null
        : sessions[0] ?? null

    if (selectedSessionId.length > 0 && !nextSession) {
      return
    }

    props.setConfig(prev => {
      const nextSessionId = nextSession?.id ?? ''
      const nextSessionTitle = nextSession?.title?.trim() ?? ''
      if (
        prev.sessionId.trim() === nextSessionId &&
        (prev.sessionTitle?.trim() ?? '') === nextSessionTitle
      ) {
        return prev
      }
      return {
        ...prev,
        sessionId: nextSessionId,
        sessionTitle: nextSessionTitle
      }
    })
  }, [
    isDraftingNewSession,
    props.config.sessionId,
    props.setConfig,
    selectedAgentId,
    sessions,
    sessionsQuery.isLoading
  ])

  useEffect(() => {
    if (props.config.sessionId.trim().length === 0) return
    setIsDraftingNewSession(false)
  }, [props.config.sessionId])

  if (auth.isBootstrapping) {
    return (
      <div className='h-full w-full grid place-items-center text-sm text-text-secondary'>
        Loading coordinator…
      </div>
    )
  }

  if (!auth.user) {
    return (
      <div className='h-full w-full grid place-items-center text-sm text-text-secondary'>
        Please log in to use coordinator.
      </div>
    )
  }

  if (coordinatorAgentsQuery.isLoading) {
    return (
      <div className='h-full w-full grid place-items-center text-sm text-text-secondary'>
        Loading coordinator…
      </div>
    )
  }

  if (coordinatorAgentsQuery.isError) {
    return (
      <div className='h-full w-full grid place-items-center text-sm text-destructive'>
        {toErrorMessage(coordinatorAgentsQuery.error)}
      </div>
    )
  }

  if (coordinatorAgents.length === 0) {
    return (
      <div className='h-full w-full grid place-items-center text-center px-6'>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <p className='text-sm font-medium text-text-primary'>
              No coordinator agents yet.
            </p>
            <p className='text-xs text-text-tertiary'>
              Create an agent with type <span className='font-mono'>coordinator</span>{' '}
              to use this panel.
            </p>
          </div>
          <Button
            size='sm'
            onClick={() => {
              props.runtime.replaceSelf('agent_create', {
                imageId: '',
                region: '',
                parentAgentId: '',
                type: 'coordinator',
                visibility: 'private'
              })
            }}
          >
            Create coordinator agent
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className='h-full min-h-0 flex'>
      <aside className='w-[280px] shrink-0 border-r border-border bg-surface-1/60'>
        <div className='border-b border-border px-3 py-3 space-y-3'>
          <label className='flex flex-col gap-1'>
            <span className='text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary'>
              Coordinator Agent
            </span>
            <select
              className='h-9 rounded-md border border-border bg-surface-1 px-3 text-sm'
              value={selectedAgentId}
              onChange={event => {
                const nextAgent =
                  coordinatorAgents.find(
                    agent => agent.id === event.target.value
                  ) ?? null
                setIsDraftingNewSession(false)
                props.setConfig(prev => ({
                  ...prev,
                  agentId: nextAgent?.id ?? '',
                  agentName: nextAgent?.name?.trim() ?? '',
                  sessionId: '',
                  sessionTitle: ''
                }))
              }}
            >
              {coordinatorAgents.map(agent => (
                <option key={agent.id} value={agent.id}>
                  {agent.name?.trim() || agent.id}
                </option>
              ))}
            </select>
          </label>
          <Button
            size='sm'
            className='w-full'
            disabled={selectedAgentId.length === 0}
            onClick={() => {
              setIsDraftingNewSession(true)
              props.setConfig(prev => ({
                ...prev,
                sessionId: '',
                sessionTitle: ''
              }))
            }}
          >
            New session
          </Button>
        </div>
        <div className='min-h-0 h-[calc(100%-106px)] overflow-y-auto'>
          {selectedAgentId.length === 0 || sessionsQuery.isLoading ? (
            <div className='h-full grid place-items-center text-sm text-text-secondary'>
              Loading sessions…
            </div>
          ) : sessionsQuery.isError ? (
            <div className='h-full grid place-items-center px-4 text-sm text-destructive text-center'>
              {toErrorMessage(sessionsQuery.error)}
            </div>
          ) : sessions.length === 0 ? (
            <div className='h-full grid place-items-center px-4 text-center'>
              <div className='space-y-1'>
                <p className='text-sm text-text-secondary'>
                  No saved sessions yet.
                </p>
                <p className='text-xs text-text-tertiary'>
                  Start a new one from this coordinator.
                </p>
              </div>
            </div>
          ) : (
            <div className='divide-y divide-border'>
              {sessions.map(session => {
                const isCurrent =
                  session.id === activeSessionId &&
                  !isDraftingNewSession
                return (
                  <button
                    key={session.id}
                    type='button'
                    onClick={() => {
                      setIsDraftingNewSession(false)
                      props.setConfig(prev => ({
                        ...prev,
                        sessionId: session.id,
                        sessionTitle: session.title?.trim() ?? ''
                      }))
                    }}
                    className={[
                      'w-full px-3 py-3 text-left transition-colors',
                      isCurrent ? 'bg-surface-2' : 'hover:bg-surface-2'
                    ].join(' ')}
                  >
                    <p className='truncate text-sm font-medium text-text-primary'>
                      {session.title?.trim().length
                        ? session.title
                        : 'Untitled session'}
                    </p>
                    <p className='mt-0.5 text-xs text-text-tertiary'>
                      {new Date(session.updatedAt).toLocaleString()}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </aside>
      <div className='min-h-0 flex-1 overflow-hidden'>
        <AgentSessionPanel
          config={{
            ...props.config,
            agentId: selectedAgentId,
            agentName: selectedAgent?.name?.trim() ?? '',
            sessionId: activeSessionId
          }}
          setConfig={props.setConfig}
          runtime={props.runtime}
          showToolOpenControls
          chatControllerKind='page'
          allowCoordinatorComposeEvents
        />
      </div>
    </div>
  )
}

export const coordinatorPanelDefinition: PanelDefinition<CoordinatorPanelConfig> = {
  type: 'coordinator',
  title: 'Coordinator',
  configVersion: 2,
  defaultConfig: {
    agentId: '',
    agentName: '',
    sessionId: '',
    sessionTitle: '',
    sessionModel: undefined,
    sessionModelReasoningEffort: undefined,
    sessionHarness: undefined
  },
  deserializeConfig: raw => deserializeCoordinatorConfig(raw),
  bodyPadding: 'none',
  Component: CoordinatorPanel
}
