import { SandboxLoader } from '@/components/loader'
import { WorkspaceDiffPanel } from '@/components/workspace-diff-panel'
import { useAuth } from '@/lib/auth'
import { useQuery } from '@tanstack/react-query'
import { useAgentRuntimeAccess } from '../hooks/use-agent-runtime-access'
import type { PanelProps } from './types'

export interface AgentDiffPanelConfig {
  readonly agentId: string
  readonly agentName?: string
  readonly diffStyle?: 'split' | 'unified'
}

const AGENT_DIFF_STYLE_COOKIE = 'agentManagerWeb.agentDiffStyle'

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

export function readAgentDiffStylePreference (): 'split' | 'unified' {
  const raw = getCookie(AGENT_DIFF_STYLE_COOKIE)
  return raw === 'unified' ? 'unified' : 'split'
}

export function writeAgentDiffStylePreference (
  style: 'split' | 'unified'
): void {
  setCookie(AGENT_DIFF_STYLE_COOKIE, style)
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

function parseDiffignoreFromSettings (value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null) return []
  const raw = (value as { diffignore?: unknown }).diffignore
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const normalized = item.trim().replaceAll('\\', '/')
    if (normalized.length === 0 || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

export function AgentDiffPanel (props: PanelProps<AgentDiffPanelConfig>) {
  const auth = useAuth()
  const config =
    typeof props.config === 'object' && props.config !== null
      ? (props.config as Partial<AgentDiffPanelConfig>)
      : {}
  const agentId =
    typeof config.agentId === 'string' ? config.agentId.trim() : ''
  const diffStyle =
    config.diffStyle === 'split' || config.diffStyle === 'unified'
      ? config.diffStyle
      : readAgentDiffStylePreference()
  const { accessQuery, access } = useAgentRuntimeAccess(agentId, {
    enabled: agentId.length > 0,
    staleTime: 10_000
  })
  const globalSettingsQuery = useQuery({
    queryKey: ['settings', 'global'],
    enabled: Boolean(auth.user),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await auth.fetchAuthed('/settings/global')
      const text = await res.text()
      const body = text.trim().length > 0 ? (JSON.parse(text) as unknown) : null
      if (!res.ok) throw new Error(toErrorMessage(body))
      return parseDiffignoreFromSettings(body)
    }
  })

  const setDiffStyle = (next: 'split' | 'unified') => {
    writeAgentDiffStylePreference(next)
    props.setConfig(prev => ({ ...prev, diffStyle: next }))
  }

  if (agentId.length === 0) {
    return (
      <div className='text-sm text-text-secondary'>
        Select an agent to view workspace diffs.
      </div>
    )
  }

  if (accessQuery.isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center text-sm text-text-secondary'>
        <SandboxLoader label='starting up the sandbox' />
      </div>
    )
  }

  if (accessQuery.isError) {
    return (
      <div className='text-sm text-destructive'>
        {toErrorMessage(accessQuery.error)}
      </div>
    )
  }

  if (!access) {
    return (
      <div className='text-sm text-text-secondary'>Missing runtime access.</div>
    )
  }

  return (
    <div className='h-full w-full overflow-hidden'>
      <WorkspaceDiffPanel
        agentApiUrl={access.agentApiUrl}
        agentAuthToken={access.agentAuthToken}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
        showInlineControls={false}
        diffIgnorePatterns={globalSettingsQuery.data ?? []}
      />
    </div>
  )
}
