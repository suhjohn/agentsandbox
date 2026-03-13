import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { List, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { useAuth } from '../lib/auth'
import {
  getChatRuntimeController,
  registerDialogRuntimeController
} from '@/coordinator-actions/runtime-bridge'
import { AgentSessionPanel, type AgentSessionPanelConfig } from '@/workspace/panels/agent-session'
import type { PanelRuntime } from '@/workspace/panels/types'

type DialogMode = 'conversation' | 'sessions'
type CoordinatorSessionRecord = {
  readonly id: string
  readonly agentId: string
  readonly imageId: string | null
  readonly createdBy: string
  readonly status: string
  readonly isArchived: boolean
  readonly harness: string
  readonly externalSessionId: string | null
  readonly title: string | null
  readonly firstUserMessageBody: string | null
  readonly lastMessageBody: string | null
  readonly model: string | null
  readonly modelReasoningEffort: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

const SESSION_LIST_LIMIT = 50

function formatSessionDate (isoDate: string): string {
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) return isoDate
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function createDialogRuntime (): PanelRuntime {
  return {
    leafId: 'coordinator-dialog',
    now: () => Date.now(),
    replaceSelf: () => {},
    openPanel: () => {}
  }
}

export function CoordinatorAgentShell (props: {
  readonly variant: 'dialog' | 'workspace' | 'page'
  readonly runtime?: PanelRuntime
  readonly initialAgentId?: string
  readonly initialSessionId?: string
  readonly initialAgentName?: string
  readonly initialSessionTitle?: string
  readonly initialSessionModel?: string
  readonly initialSessionModelReasoningEffort?: string
  readonly initialSessionHarness?: string
  readonly onSelectionChange?: (next: {
    readonly agentId: string
    readonly agentName?: string
    readonly sessionId: string
    readonly sessionTitle?: string
    readonly sessionModel?: string
    readonly sessionModelReasoningEffort?: string
    readonly sessionHarness?: string
  }) => void
}) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const runtime = useMemo(
    () => props.runtime ?? createDialogRuntime(),
    [props.runtime]
  )
  const [mode, setMode] = useState<DialogMode>('conversation')
  const [selectedAgentId, setSelectedAgentId] = useState(
    props.initialAgentId?.trim() ?? ''
  )
  const [selectedAgentName, setSelectedAgentName] = useState(
    props.initialAgentName?.trim() ?? ''
  )
  const [selectedSessionId, setSelectedSessionId] = useState(
    props.initialSessionId?.trim() ?? ''
  )
  const [selectedSessionTitle, setSelectedSessionTitle] = useState(
    props.initialSessionTitle?.trim() ?? ''
  )
  const [selectedSessionModel, setSelectedSessionModel] = useState<string | undefined>(
    props.initialSessionModel
  )
  const [selectedSessionModelReasoningEffort, setSelectedSessionModelReasoningEffort] =
    useState<string | undefined>(props.initialSessionModelReasoningEffort)
  const [selectedSessionHarness, setSelectedSessionHarness] = useState<
    string | undefined
  >(props.initialSessionHarness)
  const [isDraftingNewSession, setIsDraftingNewSession] = useState(
    selectedSessionId.length === 0
  )
  const [conversationViewKey, setConversationViewKey] = useState(0)

  const coordinatorAgentsQuery = useQuery({
    queryKey: ['coordinatorAgents', auth.user?.id ?? null],
    queryFn: () =>
      auth.api.listAgents({
        createdBy: auth.user?.id,
        type: 'coordinator',
        limit: 50
      }),
    enabled: !!auth.user && !auth.isBootstrapping
  })

  const coordinatorAgents = coordinatorAgentsQuery.data?.data ?? []

  useEffect(() => {
    if (selectedAgentId.length > 0) {
      const selected = coordinatorAgents.find(agent => agent.id === selectedAgentId)
      if (!selected) return
      const nextName = selected.name?.trim() ?? ''
      if (nextName !== selectedAgentName) {
        setSelectedAgentName(nextName)
      }
      return
    }
    const first = coordinatorAgents[0]
    if (!first) return
    setSelectedAgentId(first.id)
    setSelectedAgentName(first.name?.trim() ?? '')
  }, [coordinatorAgents, selectedAgentId, selectedAgentName])

  const sessionsQuery = useQuery({
    queryKey: [
      '/session',
      {
        agentId: selectedAgentId,
        archived: 'false',
        limit: SESSION_LIST_LIMIT
      }
    ],
    queryFn: () =>
      auth.api.listSessions({
        agentId: selectedAgentId,
        archived: 'false',
        limit: SESSION_LIST_LIMIT
      }),
    enabled:
      !!auth.user &&
      !auth.isBootstrapping &&
      selectedAgentId.trim().length > 0
  })

  const sessions = sessionsQuery.data?.data ?? []

  const resolvedSession =
    !isDraftingNewSession && selectedSessionId.length > 0
      ? sessions.find(session => session.id === selectedSessionId) ?? null
      : null
  const fallbackSession =
    !isDraftingNewSession && selectedSessionId.length === 0 ? sessions[0] ?? null : null
  const activeSession = resolvedSession ?? fallbackSession
  const currentSessionId =
    selectedSessionId.length > 0
      ? selectedSessionId
      : isDraftingNewSession
        ? ''
        : fallbackSession?.id ?? ''
  const currentSessionTitle =
    resolvedSession?.title?.trim() ??
    (selectedSessionId.length > 0
      ? selectedSessionTitle.trim()
      : fallbackSession?.title?.trim() ?? selectedSessionTitle.trim() ?? '')

  useEffect(() => {
    props.onSelectionChange?.({
      agentId: selectedAgentId,
      agentName: selectedAgentName,
      sessionId: currentSessionId,
      sessionTitle: currentSessionTitle,
      sessionModel: selectedSessionModel,
      sessionModelReasoningEffort: selectedSessionModelReasoningEffort,
      sessionHarness: selectedSessionHarness
    })
  }, [
    currentSessionId,
    currentSessionTitle,
    props.onSelectionChange,
    selectedAgentId,
    selectedAgentName,
    selectedSessionHarness,
    selectedSessionModel,
    selectedSessionModelReasoningEffort
  ])

  const archiveSessionMutation = useMutation({
    mutationFn: async (session: CoordinatorSessionRecord) =>
      auth.api.updateSession(session.id, {
        agentId: session.agentId,
        isArchived: true
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['/session'] })
    }
  })

  const startDraftSession = (title?: string) => {
    setSelectedSessionId('')
    setSelectedSessionTitle(title?.trim() ?? '')
    setSelectedSessionModel(undefined)
    setSelectedSessionModelReasoningEffort(undefined)
    setSelectedSessionHarness(undefined)
    setIsDraftingNewSession(true)
    setMode('conversation')
    setConversationViewKey(prev => prev + 1)
  }

  const selectSession = (session: CoordinatorSessionRecord) => {
    setSelectedSessionId(session.id)
    setSelectedSessionTitle(session.title?.trim() ?? '')
    setIsDraftingNewSession(false)
    setMode('conversation')
    setConversationViewKey(prev => prev + 1)
  }

  useEffect(() => {
    if (props.variant !== 'dialog') return

    return registerDialogRuntimeController({
      openSessionsList: async () => {
        setMode('sessions')
        return { mode: 'sessions' as const }
      },
      focusComposer: async () => {
        setMode('conversation')
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await new Promise<void>(resolve => window.setTimeout(resolve, 0))
          const chatController = getChatRuntimeController('dialog')
          if (!chatController) continue
          try {
            return await chatController.focusInput()
          } catch {
            // Wait for the dialog conversation surface to finish mounting.
          }
        }
        return { focused: false }
      },
      draftNewSession: async () => {
        startDraftSession()
        return {
          drafted: true as const,
          mode: 'conversation' as const
        }
      },
      listSessions: async input => {
        const limit =
          typeof input?.limit === 'number' && Number.isFinite(input.limit)
            ? Math.max(1, Math.min(100, Math.floor(input.limit)))
            : SESSION_LIST_LIMIT
        const cursor =
          typeof input?.cursor === 'string' && input.cursor.trim().length > 0
            ? input.cursor.trim()
            : undefined
        const result =
          selectedAgentId.length > 0
            ? await auth.api.listSessions({
                agentId: selectedAgentId,
                archived: 'false',
                limit,
                cursor
              })
            : { data: [], nextCursor: null }

        if (!cursor) {
          queryClient.setQueryData(
            [
              '/session',
              {
                agentId: selectedAgentId,
                archived: 'false',
                limit: SESSION_LIST_LIMIT
              }
            ],
            result
          )
        }

        return {
          sessions: result.data.map(session => ({
            id: session.id,
            title: session.title,
            createdBy: session.createdBy,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt
          })),
          nextCursor: result.nextCursor,
          selectedSessionId:
            isDraftingNewSession || currentSessionId.length === 0
              ? null
              : currentSessionId,
          mode,
          isDraftingNewSession
        }
      },
      selectSession: async input => {
        const session = sessions.find(
          current => current.id === input.sessionId.trim()
        )
        if (!session) {
          throw new Error('Session not found')
        }
        selectSession(session)
        return {
          selected: true as const,
          sessionId: session.id,
          mode: 'conversation' as const
        }
      },
      createSession: async input => {
        startDraftSession(input?.title)
        return {
          created: true as const,
          sessionId: '',
          mode: 'conversation' as const
        }
      },
      clearConversation: async () => {
        if (!activeSession) {
          startDraftSession()
          return { cleared: true as const }
        }
        await archiveSessionMutation.mutateAsync(activeSession)
        startDraftSession()
        return { cleared: true as const }
      },
      canClearConversation: () =>
        selectedAgentId.length > 0 &&
        currentSessionId.length > 0 &&
        !archiveSessionMutation.isPending
    })
  }, [
    activeSession,
    archiveSessionMutation,
    auth.api,
    currentSessionId,
    isDraftingNewSession,
    mode,
    props.variant,
    queryClient,
    selectedAgentId,
    sessions
  ])

  const panelConfig: AgentSessionPanelConfig = useMemo(
    () => ({
      agentId: selectedAgentId,
      agentName: selectedAgentName,
      sessionId: currentSessionId,
      sessionTitle: currentSessionTitle,
      sessionModel: selectedSessionModel,
      sessionModelReasoningEffort: selectedSessionModelReasoningEffort,
      sessionHarness: selectedSessionHarness
    }),
    [
      currentSessionId,
      currentSessionTitle,
      selectedAgentId,
      selectedAgentName,
      selectedSessionHarness,
      selectedSessionModel,
      selectedSessionModelReasoningEffort
    ]
  )

  const setPanelConfig = (
    updater: (prev: AgentSessionPanelConfig) => AgentSessionPanelConfig
  ) => {
    const next = updater(panelConfig)
    const nextAgentId = next.agentId.trim()
    const nextSessionId = next.sessionId.trim()

    if (nextAgentId !== selectedAgentId) {
      setSelectedAgentId(nextAgentId)
      setSelectedAgentName(next.agentName?.trim() ?? '')
    }
    if (nextSessionId !== currentSessionId) {
      setSelectedSessionId(nextSessionId)
      setSelectedSessionTitle(next.sessionTitle?.trim() ?? '')
      setIsDraftingNewSession(nextSessionId.length === 0)
      if (!(currentSessionId.length === 0 && nextSessionId.length > 0)) {
        setConversationViewKey(prev => prev + 1)
      }
      if (currentSessionId.length === 0 && nextSessionId.length > 0) {
        void queryClient.invalidateQueries({ queryKey: ['/session'] })
      }
    } else {
      setSelectedSessionTitle(next.sessionTitle?.trim() ?? '')
    }
    setSelectedSessionModel(next.sessionModel)
    setSelectedSessionModelReasoningEffort(next.sessionModelReasoningEffort)
    setSelectedSessionHarness(next.sessionHarness)
  }

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
        Loading coordinators…
      </div>
    )
  }

  if (coordinatorAgentsQuery.isError) {
    return (
      <div className='h-full w-full grid place-items-center text-sm text-destructive'>
        {(coordinatorAgentsQuery.error as Error).message}
      </div>
    )
  }

  if (coordinatorAgents.length === 0) {
    return (
      <div className='h-full w-full grid place-items-center px-6 text-center'>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <p className='text-sm font-medium text-text-primary'>
              No coordinator agents yet.
            </p>
            <p className='text-xs text-text-tertiary'>
              Create an agent with type <span className='font-mono'>coordinator</span>{' '}
              to use this surface.
            </p>
          </div>
          {props.runtime ? (
            <Button
              size='sm'
              onClick={() => {
                props.runtime?.replaceSelf('agent_create', {
                  type: 'coordinator',
                  visibility: 'private'
                })
              }}
            >
              Create coordinator agent
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  const toolbar = (
    <div className='flex items-center gap-2 border-b border-border px-3 py-2'>
      <select
        className='h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-1 px-3 text-sm'
        value={selectedAgentId}
        onChange={event => {
          const nextAgentId = event.target.value
          const agent = coordinatorAgents.find(current => current.id === nextAgentId)
          setSelectedAgentId(nextAgentId)
          setSelectedAgentName(agent?.name?.trim() ?? '')
          setSelectedSessionId('')
          setSelectedSessionTitle('')
          setSelectedSessionModel(undefined)
          setSelectedSessionModelReasoningEffort(undefined)
          setSelectedSessionHarness(undefined)
          setIsDraftingNewSession(false)
          setConversationViewKey(prev => prev + 1)
        }}
      >
        {coordinatorAgents.map(agent => (
          <option key={agent.id} value={agent.id}>
            {agent.name?.trim() || agent.id}
            {agent.visibility === 'shared' ? ' · shared' : ''}
          </option>
        ))}
      </select>
      {props.variant === 'dialog' ? (
        <Button
          size='icon'
          variant='icon'
          onClick={() => {
            setMode(prev => (prev === 'sessions' ? 'conversation' : 'sessions'))
          }}
          disabled={sessionsQuery.isLoading}
        >
          <List className='h-3.5 w-3.5' />
        </Button>
      ) : null}
      <Button
        size='icon'
        variant='icon'
        onClick={() => {
          startDraftSession()
        }}
        disabled={sessionsQuery.isLoading}
        title='Prepare new session'
      >
        <Plus className='h-3.5 w-3.5' />
      </Button>
      {currentSessionId.length > 0 ? (
        <Button
          size='sm'
          variant='secondary'
          disabled={archiveSessionMutation.isPending}
          onClick={async () => {
            if (!activeSession) return
            try {
              await archiveSessionMutation.mutateAsync(activeSession)
              startDraftSession()
              toast.success('Session archived')
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : 'Failed to archive session'
              )
            }
          }}
        >
          {archiveSessionMutation.isPending ? 'Archiving…' : 'Archive'}
        </Button>
      ) : null}
    </div>
  )

  const sessionList = (
    <div className='h-full overflow-y-auto'>
      {sessionsQuery.isLoading ? (
        <div className='h-full grid place-items-center text-sm text-text-secondary'>
          Loading sessions…
        </div>
      ) : sessionsQuery.isError ? (
        <div className='h-full grid place-items-center px-6 text-sm text-destructive'>
          {(sessionsQuery.error as Error).message}
        </div>
      ) : sessions.length === 0 ? (
        <div className='h-full grid place-items-center px-6 text-center'>
          <div className='space-y-1'>
            <p className='text-sm text-text-secondary'>No saved sessions yet.</p>
            <p className='text-xs text-text-tertiary'>
              Press + to prepare a new one.
            </p>
          </div>
        </div>
      ) : (
        <div className='divide-y divide-border'>
          {sessions.map(session => {
            const isCurrent =
              !isDraftingNewSession && session.id === currentSessionId
            return (
              <button
                key={session.id}
                type='button'
                onClick={() => {
                  selectSession(session)
                }}
                className={[
                  'w-full text-left px-4 py-3 transition-colors',
                  isCurrent ? 'bg-surface-2' : 'hover:bg-surface-2'
                ].join(' ')}
              >
                <p className='text-sm font-medium text-text-primary truncate'>
                  {session.title?.trim().length ? session.title : 'Untitled session'}
                </p>
                <p className='text-xs text-text-tertiary mt-0.5'>
                  Updated {formatSessionDate(session.updatedAt)}
                </p>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )

  const conversation = (
    <div className='h-full min-h-0'>
      <AgentSessionPanel
        key={`${selectedAgentId}:${conversationViewKey}`}
        config={panelConfig}
        setConfig={setPanelConfig}
        runtime={runtime}
        showToolOpenControls={props.variant === 'workspace'}
        chatControllerKind={props.variant === 'dialog' ? 'dialog' : 'page'}
        allowCoordinatorComposeEvents
      />
    </div>
  )

  if (props.variant === 'dialog') {
    return (
      <div className='flex h-full min-h-0 flex-col'>
        {toolbar}
        <div className='min-h-0 flex-1 overflow-hidden'>
          {mode === 'sessions' ? sessionList : conversation}
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {toolbar}
      <div className='grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] divide-x divide-border'>
        <div className='min-h-0'>{sessionList}</div>
        <div className='min-h-0'>{conversation}</div>
      </div>
    </div>
  )
}
