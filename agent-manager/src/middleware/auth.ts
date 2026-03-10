import { createMiddleware } from 'hono/factory'
import { jwt } from 'hono/jwt'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../types/context'
import { env } from '../env'
import { getUserById } from '../services/user.service'
import { DEFAULT_REGION, parseRegionText } from '../utils/region'
import { parseWorkspaceKeybindings } from '../utils/workspace-keybindings'

export const verifyJwt = jwt({ secret: env.USER_JWT_SECRET, alg: 'HS256' })

export const loadUser = createMiddleware<AppEnv>(async (c, next) => {
  const payload = c.get('jwtPayload') as { sub?: string } | undefined
  if (!payload?.sub) {
    throw new HTTPException(401, { message: 'Invalid token payload' })
  }

  const user = await getUserById(payload.sub)
  if (!user) {
    throw new HTTPException(401, { message: 'User not found' })
  }

  c.set('user', {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar ?? null,
    defaultRegion: parseRegionText(user.defaultRegion) ?? DEFAULT_REGION,
    workspaceKeybindings: parseWorkspaceKeybindings(user.workspaceKeybindings),
  })
  await next()
})
