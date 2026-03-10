import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { registerUser, loginUser, generateToken, verifyRefreshToken, loginWithGithub } from '../services/auth.service'
import { registerRoute } from '../openapi/registry'
import { getGithubOauthConfig } from '../env'
import { startGithubOAuth, handleGithubCallback } from '../services/oauth/github.service'

const app = new Hono()
const BASE = '/auth'

const registerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8).max(128),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const authResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    avatar: z.string().nullable(),
  }),
  accessToken: z.string(),
})

function parseCookie(header: string | undefined, key: string): string | null {
  if (!header) return null
  const cookies = header.split(';').map(c => c.trim())
  const target = cookies.find(c => c.startsWith(`${key}=`))
  if (!target) return null
  const value = target.slice(key.length + 1)
  return value.length > 0 ? decodeURIComponent(value) : null
}

function buildRefreshTokenCookie (refreshToken: string): string {
  return `refreshToken=${encodeURIComponent(refreshToken)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 60 * 60}`
}

function buildClearRefreshTokenCookie (): string {
  return 'refreshToken=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
}

registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/register`,
    summary: 'Register user',
    tags: ['auth'],
    request: { json: registerSchema },
    responses: {
      201: authResponseSchema,
      400: z.object({ error: z.string() }),
    },
  },
  '/register',
  zValidator('json', registerSchema),
  async (c) => {
    const body = c.req.valid('json' as never) as z.infer<typeof registerSchema>
    try {
      const result = await registerUser(body)

      // Set refresh token as httpOnly cookie
      c.header('Set-Cookie', buildRefreshTokenCookie(result.refreshToken))

      return c.json({
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          avatar: result.user.avatar ?? null,
        },
        accessToken: result.accessToken,
      }, 201)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Registration failed'
      return c.json({ error: message }, 400)
    }
  },
)

registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/login`,
    summary: 'Login user',
    tags: ['auth'],
    request: { json: loginSchema },
    responses: {
      200: authResponseSchema,
      401: z.object({ error: z.string() }),
    },
  },
  '/login',
  zValidator('json', loginSchema),
  async (c) => {
    const body = c.req.valid('json' as never) as z.infer<typeof loginSchema>
    try {
      const result = await loginUser(body)

      // Set refresh token as httpOnly cookie
      c.header('Set-Cookie', buildRefreshTokenCookie(result.refreshToken))

      return c.json({
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          avatar: result.user.avatar ?? null,
        },
        accessToken: result.accessToken,
      })
    } catch {
      return c.json({ error: 'Invalid credentials' }, 401)
    }
  },
)

registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/refresh`,
    summary: 'Refresh access token',
    tags: ['auth'],
    responses: {
      200: z.object({ accessToken: z.string() }),
      401: z.object({ error: z.string() }),
    },
  },
  '/refresh',
  async (c) => {
    const csrfHeader = (c.req.header('X-Refresh-Csrf') ?? '').trim()
    if (csrfHeader !== '1') {
      return c.json({ error: 'Missing refresh CSRF header' }, 401)
    }

    const cookieHeader = c.req.header('Cookie')
    const refreshToken = parseCookie(cookieHeader, 'refreshToken')

    if (!refreshToken) {
      return c.json({ error: 'No refresh token provided' }, 401)
    }

    const userId = await verifyRefreshToken(refreshToken)
    if (!userId) {
      return c.json({ error: 'Invalid refresh token' }, 401)
    }
    const accessToken = await generateToken(userId)
    return c.json({ accessToken })
  },
)

registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/logout`,
    summary: 'Logout user',
    tags: ['auth'],
    responses: {
      200: z.object({ ok: z.boolean() }),
    },
  },
  '/logout',
  async (c) => {
    // Clear the refresh token cookie
    c.header('Set-Cookie', buildClearRefreshTokenCookie())
    return c.json({ ok: true })
  },
)

// Start GitHub OAuth (popup). Redirects to GitHub authorization URL.
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/github/start`,
    summary: 'Start GitHub OAuth login',
    tags: ['auth'],
    request: { query: z.object({ returnTo: z.string().min(1) }) },
    responses: {
      302: z.any(),
      400: z.object({ error: z.string() }),
      501: z.object({ error: z.string() }),
    },
  },
  '/github/start',
  async (c) => {
    const config = getGithubOauthConfig()
    if (!config) return c.json({ error: 'GitHub OAuth is not configured' }, 501)

    const returnTo = c.req.query('returnTo') ?? ''
    let returnOrigin = ''
    try {
      returnOrigin = new URL(returnTo).origin
    } catch {
      return c.json({ error: 'Invalid returnTo' }, 400)
    }

    if (!config.allowedOrigins.includes(returnOrigin)) {
      return c.json({ error: 'returnTo origin is not allowed' }, 400)
    }

    const result = startGithubOAuth({
      clientId: config.clientId,
      redirectUrl: config.redirectUrl,
      returnOrigin,
      requestUrl: c.req.url,
    })

    c.header('Set-Cookie', result.cookies.join(', '))
    return c.redirect(result.authUrl, 302)
  },
)

// GitHub OAuth callback (returns small HTML that postMessages auth to opener).
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/github/callback`,
    summary: 'GitHub OAuth callback',
    tags: ['auth'],
    responses: {
      200: z.any(),
      400: z.object({ error: z.string() }),
      501: z.object({ error: z.string() }),
    },
  },
  '/github/callback',
  async (c) => {
    const config = getGithubOauthConfig()
    if (!config) return c.json({ error: 'GitHub OAuth is not configured' }, 501)

    const cookieHeader = c.req.header('Cookie')
    const cookieState = parseCookie(cookieHeader, 'githubOauthState')
    const returnOrigin = parseCookie(cookieHeader, 'githubOauthReturnTo') ?? ''

    if (!cookieState || !returnOrigin) {
      return c.json({ error: 'Missing OAuth state' }, 400)
    }
    if (!config.allowedOrigins.includes(returnOrigin)) {
      return c.json({ error: 'returnTo origin is not allowed' }, 400)
    }

    const error = c.req.query('error')
    const errorDescription = c.req.query('error_description')
    if (error) {
      const result = await handleGithubCallback({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUrl: config.redirectUrl,
        code: '',
        state: '',
        cookieState,
        returnOrigin,
        requestUrl: c.req.url,
        onSuccess: async () => {
          throw new Error(`${error}: ${errorDescription ?? ''}`)
        },
      })
      c.header('Set-Cookie', result.cookiesToClear.join(', '))
      return c.html(result.html)
    }

    const code = c.req.query('code') ?? ''
    const state = c.req.query('state') ?? ''
    if (!code || !state) {
      return c.json({ error: 'Invalid OAuth state' }, 400)
    }

    let issuedGithubRefreshToken: string | null = null
    const result = await handleGithubCallback({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUrl: config.redirectUrl,
      code,
      state,
      cookieState,
      returnOrigin,
      requestUrl: c.req.url,
      onSuccess: async (profile) => {
        const email = profile.email
        const name = profile.name ?? profile.login
        const auth = await loginWithGithub({
          githubId: profile.githubId,
          email,
          name,
          avatarUrl: profile.avatarUrl,
        })
        issuedGithubRefreshToken = auth.refreshToken
        return auth
      },
    })

    const cookiesToSet = [...result.cookiesToClear]
    if (issuedGithubRefreshToken) {
      cookiesToSet.push(buildRefreshTokenCookie(issuedGithubRefreshToken))
    }
    c.header('Set-Cookie', cookiesToSet.join(', '))
    return c.html(result.html)
  },
)

export { app as authRoutes }
