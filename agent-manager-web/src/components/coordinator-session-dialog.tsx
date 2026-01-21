import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { List, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '../lib/auth'
import type { ListCoordinatorSessionsResult } from '../lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { ChatConversationPage } from '../routes/chat-conversation'
import { Button } from './ui/button'
import {
  getActiveChatRuntimeController,
  registerDialogRuntimeController
} from '@/coordinator-actions/runtime-bridge'

type DialogMode = 'conversation' | 'sessions'

export function CoordinatorSessionDialog (props: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<DialogMode>('conversation')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  )
  const [isDraftingNewSession, setIsDraftingNewSession] = useState(false)
  const [conversationViewKey, setConversationViewKey] = useState(0)

  const coordinatorSessionsQuery = useQuery({
    queryKey: ['coordinatorSessions'],
    queryFn: () => auth.api.listCoordinatorSessions({ limit: 20 }),
    enabled: props.open && !!auth.user && !auth.isBootstrapping
  })

  const sessions = coordinatorSessionsQuery.data?.data ?? []

  const coordinatorSessionId = isDraftingNewSession
    ? null
    : selectedSessionId
    ? selectedSessionId
    : sessions[0]?.id ?? null

  const clearMutation = useMutation({
    mutationFn: async (targetCoordinatorSessionId: string) =>
      auth.api.deleteCoordinatorSession(targetCoordinatorSessionId),
    onSuccess: async (_data, targetCoordinatorSessionId) => {
      queryClient.removeQueries({
        queryKey: ['coordinatorSession', targetCoordinatorSessionId],
        exact: true
      })
      queryClient.removeQueries({
        queryKey: ['messages', targetCoordinatorSessionId],
        exact: true
      })
      await queryClient.invalidateQueries({ queryKey: ['coordinatorSessions'] })
      toast.success('Chat cleared')
    },
    onError: e => {
      toast.error(e instanceof Error ? e.message : 'Failed to clear chat')
    }
  })

  const canClearCurrentConversation = useCallback((): boolean => {
    return (
      !!auth.user &&
      typeof coordinatorSessionId === 'string' &&
      coordinatorSessionId.length > 0 &&
      !clearMutation.isPending
    )
  }, [auth.user, clearMutation.isPending, coordinatorSessionId])

  const openSessionsList = useCallback(async () => {
    setMode('sessions')
    return { mode: 'sessions' as const }
  }, [])

  const draftNewSession = useCallback(async () => {
    setMode('conversation')
    setIsDraftingNewSession(true)
    setSelectedSessionId(null)
    setConversationViewKey(prev => prev + 1)
    return { drafted: true as const, mode: 'conversation' as const }
  }, [])

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
      const result = await auth.api.listCoordinatorSessions({ limit, cursor })

      if (!cursor) {
        queryClient.setQueryData<ListCoordinatorSessionsResult>(
          ['coordinatorSessions'],
          result
        )
      }

      const activeSelectedSessionId = isDraftingNewSession
        ? null
        : selectedSessionId ?? result.data[0]?.id ?? null

      return {
        sessions: result.data.map(session => ({
          id: session.id,
          title: session.title,
          createdBy: session.createdBy,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt
        })),
        nextCursor: result.nextCursor,
        selectedSessionId: activeSelectedSessionId,
        mode,
        isDraftingNewSession
      }
    },
    [auth.api, isDraftingNewSession, mode, queryClient, selectedSessionId]
  )

  const selectSession = useCallback(
    async (input: { readonly coordinatorSessionId: string }) => {
      const coordinatorSessionId = input.coordinatorSessionId.trim()
      if (!coordinatorSessionId) {
        throw new Error('coordinatorSessionId is required')
      }

      const session = await auth.api.getCoordinatorSession(coordinatorSessionId)
      queryClient.setQueryData(
        ['coordinatorSession', coordinatorSessionId],
        session
      )

      setSelectedSessionId(coordinatorSessionId)
      setIsDraftingNewSession(false)
      setMode('conversation')
      setConversationViewKey(prev => prev + 1)

      return {
        selected: true as const,
        coordinatorSessionId,
        mode: 'conversation' as const
      }
    },
    [auth.api, queryClient]
  )

  const createSession = useCallback(
    async (input?: { readonly title?: string }) => {
      const title =
        typeof input?.title === 'string' && input.title.trim().length > 0
          ? input.title.trim()
          : undefined
      const created = await auth.api.createCoordinatorSession(
        title ? { title } : undefined
      )

      queryClient.setQueryData(['coordinatorSession', created.id], created)
      queryClient.setQueryData<ListCoordinatorSessionsResult>(
        ['coordinatorSessions'],
        prev => {
          const list = prev?.data ?? []
          if (list.some(session => session.id === created.id)) return prev
          return {
            data: [created, ...list],
            nextCursor: prev?.nextCursor ?? null
          }
        }
      )

      setSelectedSessionId(created.id)
      setIsDraftingNewSession(false)
      setMode('conversation')
      setConversationViewKey(prev => prev + 1)

      return {
        created: true as const,
        coordinatorSessionId: created.id,
        mode: 'conversation' as const
      }
    },
    [auth.api, queryClient]
  )

  const clearCurrentConversation = useCallback(async () => {
    if (!coordinatorSessionId)
      throw new Error('Coordinator session unavailable')
    await clearMutation.mutateAsync(coordinatorSessionId)
    return { cleared: true as const }
  }, [clearMutation, coordinatorSessionId])

  useEffect(() => {
    return registerDialogRuntimeController({
      openSessionsList,
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
        className='max-w-4xl h-[600px] max-h-[calc(100dvh-3rem)] flex flex-col p-0 overflow-hidden gap-0'
        onEscapeKeyDown={event => {
          const shouldHandleInConversation =
            !!auth.user &&
            !coordinatorSessionsQuery.isLoading &&
            !coordinatorSessionsQuery.isError &&
            mode === 'conversation' &&
            !clearMutation.isPending
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
                  disabled={coordinatorSessionsQuery.isLoading}
                >
                  <List className='h-3.5 w-3.5' />
                </Button>
                <Button
                  size='icon'
                  variant='icon'
                  onClick={() => {
                    setMode('conversation')
                    setIsDraftingNewSession(true)
                    setSelectedSessionId(null)
                    setConversationViewKey(prev => prev + 1)
                  }}
                  disabled={coordinatorSessionsQuery.isLoading}
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
          ) : coordinatorSessionsQuery.isLoading ? (
            <div className='h-full grid place-items-center'>
              <p className='text-sm text-text-secondary'>Loading…</p>
            </div>
          ) : coordinatorSessionsQuery.isError ? (
            <div className='h-full grid place-items-center px-6'>
              <p className='text-sm text-destructive text-center'>
                {(coordinatorSessionsQuery.error as Error).message}
              </p>
            </div>
          ) : mode === 'sessions' ? (
            <div className='h-full overflow-y-auto'>
              {sessions.length === 0 ? (
                <div className='h-full grid place-items-center text-center px-6'>
                  <div className='space-y-1'>
                    <p className='text-sm text-text-secondary'>
                      No saved sessions yet.
                    </p>
                    <p className='text-xs text-text-tertiary'>
                      Press + to prepare a new one.
                    </p>
                  </div>
                </div>
              ) : (
                <div className='divide-y divide-border'>
                  {sessions.map(session => {
                    const isCurrent =
                      session.id === coordinatorSessionId &&
                      !isDraftingNewSession
                    return (
                      <button
                        key={session.id}
                        type='button'
                        onClick={() => {
                          setSelectedSessionId(session.id)
                          setIsDraftingNewSession(false)
                          setMode('conversation')
                          setConversationViewKey(prev => prev + 1)
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
          ) : clearMutation.isPending ? (
            <div className='h-full grid place-items-center'>
              <p className='text-sm text-text-secondary'>Clearing…</p>
            </div>
          ) : (
            <ChatConversationPage
              key={conversationViewKey}
              coordinatorSessionId={coordinatorSessionId}
              variant='dialog'
              showDelete={false}
              showTitle={false}
              allowCoordinatorComposeEvents
              onSessionCreated={createdSessionId => {
                setSelectedSessionId(createdSessionId)
                setIsDraftingNewSession(false)
                setMode('conversation')
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
