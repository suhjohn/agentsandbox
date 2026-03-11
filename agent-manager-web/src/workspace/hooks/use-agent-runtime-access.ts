import { useMemo } from 'react'
import {
  useGetAgentsAgentIdAccess,
  type GetAgentsAgentIdAccess200
} from '@/api/generated/agent-manager'

const DEFAULT_ACCESS_STALE_TIME_MS = 60_000

export type AgentRuntimeAccess = GetAgentsAgentIdAccess200

export function unwrapAgentRuntimeAccess (
  value: unknown
): GetAgentsAgentIdAccess200 | null {
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

export function useAgentRuntimeAccess (
  agentId: string,
  options?: {
    readonly caller?: string
    readonly enabled?: boolean
    readonly staleTime?: number
    readonly refetchOnWindowFocus?: boolean
    readonly refetchOnMount?: boolean
    readonly refetchOnReconnect?: boolean
    readonly retry?: boolean | number
  }
) {
  const accessQuery = useGetAgentsAgentIdAccess(agentId, {
    query: {
      enabled: options?.enabled ?? agentId.trim().length > 0,
      staleTime: options?.staleTime ?? DEFAULT_ACCESS_STALE_TIME_MS,
      refetchOnMount: options?.refetchOnMount ?? false,
      refetchOnWindowFocus: options?.refetchOnWindowFocus ?? false,
      refetchOnReconnect: options?.refetchOnReconnect ?? false,
      retry: options?.retry ?? false
    }
  })

  const access = useMemo(
    () => unwrapAgentRuntimeAccess(accessQuery.data),
    [accessQuery.data]
  )

  return { accessQuery, access } as const
}
