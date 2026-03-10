import type { Env } from 'hono'

export type AuthUser = {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly avatar: string | null
  readonly defaultRegion: string | readonly string[]
  readonly workspaceKeybindings: Record<string, unknown> | null
}

export type AppEnv = Env & {
  Variables: {
    user: AuthUser
    authMode?: 'jwt' | 'runtime-internal'
    runtimeAgentId?: string
  }
}
