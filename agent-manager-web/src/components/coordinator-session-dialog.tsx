import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { List, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '../lib/auth'
import type { Agent, AgentManagerApiClient } from '../lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import {
  getChatRuntimeController,
  getActiveChatRuntimeController,
  registerDialogRuntimeController
} from '@/coordinator-actions/runtime-bridge'
import {
  AgentSessionPanel,
  type AgentSessionPanelConfig
} from '@/workspace/panels/agent-session'
import type { PanelRuntime } from '@/workspace/panels/types'

type DialogMode = 'conversation' | 'sessions'
type ManagerSessionRecord = Awaited<
  ReturnType<AgentManagerApiClient['listSessions']>
>['data'][number]

const DIALOG_RUNTIME: PanelRuntime = {
  leafId: 'coordinator-dialog',
  now: () => Date.now(),
  replaceSelf: () => {},
  openPanel: () => {}
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

export function CoordinatorSessionDialog (props: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<DialogMode>('conversation')
  const [isDraftingNewSession, setIsDraftingNewSession] = useState(false)
  const [conversationViewKey, setConversationViewKey] = useState(0)
  const [sessionConfig, setSessionConfig] = useState<AgentSessionPanelConfig>({
    agentId: '',
    agentName: '',
    sessionId: '',
    sessionTitle: '',
    sessionModel: undefined,
    sessionModelReasoningEffort: undefined,
    sessionHarness: undefined
  })

  const coordinatorAgentsQuery = useQuery({
    queryKey: ['coordinatorAgents', auth.user?.id ?? null],
    queryFn: () =>
      auth.api.listAgents({
        createdBy: auth.user?.id,
        type: 'coordinator',
        archived: false,
        limit: 50
      }),
    enabled: props.open && !!auth.user && !auth.isBootstrapping
  })

  const coordinatorAgents = coordinatorAgentsQuery.data?.data ?? []
  const selectedAgent = useMemo(
    () => selectCoordinatorAgent(coordinatorAgents, sessionConfig.agentId),
    [coordinatorAgents, sessionConfig.agentId]
  )
  const selectedAgentId = selectedAgent?.id ?? ''

  const sessionsQuery = useQuery({
    queryKey: ['/session', 'coordinator-dialog', selectedAgentId, 'false'],
    queryFn: () =>
      auth.api.listSessions({
        agentId: selectedAgentId,
        archived: 'false',
        limit: 50
      }),
    enabled:
      props.open &&
      !!auth.user &&
      !auth.isBootstrapping &&
      selectedAgentId.length > 0
  })

  const sessions = sessionsQuery.data?.data ?? []
  const selectedSessionId = sessionConfig.sessionId.trim()
  const selectedSession = useMemo(
    () => sessions.find(session => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions]
  )
  const activeSessionId =
    selectedSessionId.length > 0
      ? selectedSessionId
      : isDraftingNewSession
      ? ''
      : sessions[0]?.id ?? ''

  const startDraftSession = useCallback((title?: string): void => {
    setSessionConfig(prev => ({
      ...prev,
      sessionId: '',
      sessionTitle: title?.trim() ?? ''
    }))
    setIsDraftingNewSession(true)
    setMode('conversation')
    setConversationViewKey(prev => prev + 1)
  }, [])

  const setConfig = useCallback(
    (
      updater: (prev: AgentSessionPanelConfig) => AgentSessionPanelConfig
    ): void => {
      setSessionConfig(prev => {
        const next = updater(prev)
        const prevSessionId = prev.sessionId.trim()
        const nextSessionId = next.sessionId.trim()

        if (nextSessionId !== prevSessionId) {
          setIsDraftingNewSession(nextSessionId.length === 0)
          if (!(prevSessionId.length === 0 && nextSessionId.length > 0)) {
            setConversationViewKey(current => current + 1)
          }
          if (prevSessionId.length === 0 && nextSessionId.length > 0) {
            void queryClient.invalidateQueries({ queryKey: ['/session'] })
          }
        }

        return next
      })
    },
    [queryClient]
  )

  useEffect(() => {
    if (!props.open) return

    const nextAgent = selectedAgent
    setSessionConfig(prev => {
      const prevAgentId = prev.agentId.trim()
      const nextAgentId = nextAgent?.id ?? ''
      const nextAgentName = nextAgent?.name?.trim() ?? ''

      if (
        prevAgentId === nextAgentId &&
        (prev.agentName?.trim() ?? '') === nextAgentName
      ) {
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
  }, [props.open, selectedAgent])

  useEffect(() => {
    if (!props.open || selectedAgentId.length === 0 || isDraftingNewSession)
      return
    if (sessionsQuery.isLoading) return

    const nextSession =
      selectedSessionId.length > 0
        ? sessions.find(session => session.id === selectedSessionId) ?? null
        : sessions[0] ?? null

    if (selectedSessionId.length > 0 && !nextSession) {
      return
    }

    setSessionConfig(prev => {
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
    props.open,
    selectedAgentId,
    selectedSessionId,
    sessions,
    sessionsQuery.isLoading
  ])

  useEffect(() => {
    if (sessionConfig.sessionId.trim().length === 0) return
    setIsDraftingNewSession(false)
  }, [sessionConfig.sessionId])

  const archiveSessionMutation = useMutation({
    mutationFn: async (session: ManagerSessionRecord) =>
      auth.api.updateSession(session.id, {
        agentId: session.agentId,
        isArchived: true
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['/session'] })
      toast.success('Session archived')
    },
    onError: error => {
      toast.error(toErrorMessage(error))
    }
  })

  const canClearCurrentConversation = useCallback((): boolean => {
    return (
      !!auth.user &&
      activeSessionId.length > 0 &&
      !archiveSessionMutation.isPending
    )
  }, [activeSessionId, archiveSessionMutation.isPending, auth.user])

  const openSessionsList = useCallback(async () => {
    setMode('sessions')
    return { mode: 'sessions' as const }
  }, [])

  const focusComposer = useCallback(async () => {
    setMode('conversation')
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise<void>(resolve => window.setTimeout(resolve, 0))
      const chatController = getChatRuntimeController('dialog')
      if (!chatController) continue
      try {
        return await chatController.focusInput()
      } catch {
        // Wait for the conversation surface to finish mounting.
      }
    }
    return { focused: false }
  }, [])

  const draftNewSession = useCallback(async () => {
    if (selectedAgentId.length === 0) {
      throw new Error('Create a coordinator agent first.')
    }

    startDraftSession()
    return { drafted: true as const, mode: 'conversation' as const }
  }, [selectedAgentId, startDraftSession])

  const listSessions = useCallback(
    async (input?: { readonly limit?: number; readonly cursor?: string }) => {
      const limit =
        typeof input?.limit === 'number' && Number.isFinite(input.limit)
          ? Math.max(1, Math.min(100, Math.floor(input.limit)))
          : 20
      const cursor =
        typeof input?.cursor === 'string' && input.cursor.trim().length > 0
          ? input.cursor.trim()
          : undefined

      if (selectedAgentId.length === 0) {
        return {
          sessions: [],
          nextCursor: null,
          selectedSessionId: null,
          mode,
          isDraftingNewSession
        }
      }

      const result = await auth.api.listSessions({
        agentId: selectedAgentId,
        archived: 'false',
        limit,
        cursor
      })

      if (!cursor) {
        queryClient.setQueryData(
          ['/session', 'coordinator-dialog', selectedAgentId, 'false'],
          result
        )
      }

      const fallbackSelectedSessionId =
        selectedSessionId.length > 0
          ? selectedSessionId
          : result.data[0]?.id ?? null

      return {
        sessions: result.data.map(session => ({
          id: session.id,
          title: session.title,
          createdBy: session.createdBy,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt
        })),
        nextCursor: result.nextCursor,
        selectedSessionId: isDraftingNewSession
          ? null
          : fallbackSelectedSessionId,
        mode,
        isDraftingNewSession
      }
    },
    [
      auth.api,
      isDraftingNewSession,
      mode,
      queryClient,
      selectedAgentId,
      selectedSessionId
    ]
  )

  const selectSession = useCallback(
    async (input: { readonly coordinatorSessionId: string }) => {
      const nextSessionId = input.coordinatorSessionId.trim()
      if (!nextSessionId) {
        throw new Error('coordinatorSessionId is required')
      }

      const matchingSession =
        sessions.find(session => session.id === nextSessionId) ?? null

      setSessionConfig(prev => ({
        ...prev,
        sessionId: nextSessionId,
        sessionTitle: matchingSession?.title?.trim() ?? ''
      }))
      setIsDraftingNewSession(false)
      setMode('conversation')
      setConversationViewKey(prev => prev + 1)

      return {
        selected: true as const,
        coordinatorSessionId: nextSessionId,
        mode: 'conversation' as const
      }
    },
    [sessions]
  )

  const createSession = useCallback(
    async (_input?: { readonly title?: string }) => {
      if (selectedAgentId.length === 0) {
        throw new Error('Create a coordinator agent first.')
      }

      startDraftSession()

      return {
        created: true as const,
        coordinatorSessionId: '',
        mode: 'conversation' as const
      }
    },
    [selectedAgentId, startDraftSession]
  )

  const clearCurrentConversation = useCallback(async () => {
    const currentSession =
      sessions.find(session => session.id === activeSessionId) ?? null
    if (!currentSession) {
      startDraftSession()
      return { cleared: true as const }
    }

    await archiveSessionMutation.mutateAsync(currentSession)
    startDraftSession()
    return { cleared: true as const }
  }, [activeSessionId, archiveSessionMutation, sessions, startDraftSession])

  useEffect(() => {
    return registerDialogRuntimeController({
      openSessionsList,
      focusComposer,
      draftNewSession,
      listSessions,
      selectSession,
      createSession,
      clearConversation: clearCurrentConversation,
      canClearConversation: canClearCurrentConversation
    })
  }, [
    canClearCurrentConversation,
    clearCurrentConversation,
    createSession,
    draftNewSession,
    focusComposer,
    listSessions,
    openSessionsList,
    selectSession
  ])

  const formatSessionDate = useCallback((isoDate: string): string => {
    const parsed = new Date(isoDate)
    if (Number.isNaN(parsed.getTime())) return isoDate
    return parsed.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }, [])

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        data-coordinator-dialog='true'
        className='max-w-6xl min-h-[80%] max-h-[calc(100dvh-3rem)] grid-rows-[auto_minmax(0,1fr)] p-0 overflow-hidden gap-0'
        onEscapeKeyDown={event => {
          const shouldHandleInConversation =
            !!auth.user &&
            !coordinatorAgentsQuery.isLoading &&
            !coordinatorAgentsQuery.isError &&
            mode === 'conversation' &&
            !archiveSessionMutation.isPending
          if (!shouldHandleInConversation) return

          const chatController = getActiveChatRuntimeController()
          if (!chatController?.isStreaming()) return

          event.preventDefault()
          void chatController.stopStream()
        }}
      >
        <DialogHeader className='shrink-0 px-4 py-3 border-b border-border space-y-0'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <span className='relative flex h-2 w-2'>
                <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75' />
                <span className='relative inline-flex rounded-full h-2 w-2 bg-green-500' />
              </span>
              <DialogTitle className='text-sm font-medium'>
                Coordinator
              </DialogTitle>
              <DialogDescription className='sr-only'>
                Coordinator conversation dialog. Hold Command or Control plus
                period to record and release to transcribe into the composer.
              </DialogDescription>
            </div>
            {auth.user ? (
              <div className='flex items-center gap-1'>
                <Button
                  size='icon'
                  variant='icon'
                  onClick={() => {
                    setMode(prev =>
                      prev === 'sessions' ? 'conversation' : 'sessions'
                    )
                  }}
                  disabled={coordinatorAgentsQuery.isLoading}
                >
                  <List className='h-3.5 w-3.5' />
                </Button>
                <Button
                  size='icon'
                  variant='icon'
                  onClick={() => {
                    void draftNewSession()
                  }}
                  disabled={coordinatorAgentsQuery.isLoading}
                  title='Prepare new coordinator session'
                >
                  <Plus className='h-3.5 w-3.5' />
                </Button>
              </div>
            ) : null}
          </div>
        </DialogHeader>

        <div className='min-h-0 flex-1 overflow-hidden h-full'>
          {!auth.user ? (
            <div className='h-full grid place-items-center text-center px-6'>
              <div className='space-y-1'>
                <p className='text-sm font-medium text-text-primary'>
                  Not logged in
                </p>
                <p className='text-xs text-text-tertiary font-mono'>
                  Use /auth/login on {auth.baseUrl}
                </p>
              </div>
            </div>
          ) : auth.isBootstrapping || coordinatorAgentsQuery.isLoading ? (
            <div className='h-full grid place-items-center'>
              <p className='text-sm text-text-secondary'>Loading…</p>
            </div>
          ) : coordinatorAgentsQuery.isError ? (
            <div className='h-full grid place-items-center px-6'>
              <p className='text-sm text-destructive text-center'>
                {toErrorMessage(coordinatorAgentsQuery.error)}
              </p>
            </div>
          ) : coordinatorAgents.length === 0 ? (
            <div className='h-full grid place-items-center text-center px-6'>
              <div className='space-y-1'>
                <p className='text-sm font-medium text-text-primary'>
                  No coordinator agents yet.
                </p>
                <p className='text-xs text-text-tertiary'>
                  Create an agent with type{' '}
                  <span className='font-mono'>coordinator</span> from the
                  workspace first.
                </p>
              </div>
            </div>
          ) : mode === 'sessions' ? (
            <div className='h-full flex flex-col'>
              <div className='h-full overflow-y-auto'>
                {selectedAgentId.length === 0 || sessionsQuery.isLoading ? (
                  <div className='h-full grid place-items-center'>
                    <p className='text-sm text-text-secondary'>
                      Loading sessions…
                    </p>
                  </div>
                ) : sessionsQuery.isError ? (
                  <div className='h-full grid place-items-center px-6'>
                    <p className='text-sm text-destructive text-center'>
                      {toErrorMessage(sessionsQuery.error)}
                    </p>
                  </div>
                ) : sessions.length === 0 ? (
                  <div className='h-full grid place-items-center text-center px-6'>
                    <div className='space-y-1'>
                      <p className='text-sm text-text-secondary'>
                        No saved sessions yet.
                      </p>
                      <p className='text-xs text-text-tertiary'>
                        Press + to start a new one.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className='divide-y divide-border'>
                    {sessions.map(session => {
                      const isCurrent =
                        session.id === activeSessionId && !isDraftingNewSession
                      return (
                        <button
                          key={session.id}
                          type='button'
                          onClick={() => {
                            setSessionConfig(prev => ({
                              ...prev,
                              sessionId: session.id,
                              sessionTitle: session.title?.trim() ?? ''
                            }))
                            setIsDraftingNewSession(false)
                            setMode('conversation')
                          }}
                          className={[
                            'w-full text-left px-4 py-3 transition-colors',
                            isCurrent ? 'bg-surface-2' : 'hover:bg-surface-2'
                          ].join(' ')}
                        >
                          <p className='text-sm font-medium text-text-primary truncate'>
                            {session.title?.trim().length
                              ? session.title
                              : 'Untitled session'}
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
            </div>
          ) : (
            <div className='h-full flex flex-col flex-1'>
              <AgentSessionPanel
                key={`${selectedAgentId}:${conversationViewKey}`}
                config={{
                  ...sessionConfig,
                  agentId: selectedAgentId,
                  agentName: selectedAgent?.name?.trim() ?? '',
                  sessionId: activeSessionId
                }}
                setConfig={setConfig}
                runtime={DIALOG_RUNTIME}
                showToolOpenControls={false}
                chatControllerKind='dialog'
                allowCoordinatorComposeEvents
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
