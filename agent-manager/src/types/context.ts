import type { Env } from 'hono'

export type AuthUser = {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly defaultRegion: string | readonly string[]
  readonly workspaceKeybindings: Record<string, unknown> | null
}

export type AppEnv = Env & {
  Variables: {
    user: AuthUser
    authMode?: 'jwt' | 'api-key'
  }
}
