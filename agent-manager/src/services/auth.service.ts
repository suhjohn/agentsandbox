import { sign, verify } from 'hono/jwt'
import { env, getAllowedDomains } from '../env'
import {
  createUser,
  getUserByEmail,
  getUserByGithubId,
  linkGithubIdToUser,
  updateUser,
} from './user.service'
import {
  buildGithubAvatarUrl,
  isGithubAvatarPath,
  uploadGithubAvatar,
} from './avatar.service'

type PersistedUser = NonNullable<Awaited<ReturnType<typeof getUserByEmail>>>

export function isEmailDomainAllowed(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  return getAllowedDomains().includes(domain)
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'bcrypt', cost: 12 })
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash)
}

export async function generateToken(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return sign(
    { sub: userId, iat: now, exp: now + parseExpiry(env.JWT_EXPIRES_IN) },
    env.USER_JWT_SECRET,
    'HS256',
  )
}

export async function generateRefreshToken(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return sign(
    { sub: userId, type: 'refresh', iat: now, exp: now + 30 * 24 * 60 * 60 },
    env.USER_JWT_SECRET,
    'HS256',
  )
}

export async function verifyRefreshToken(token: string): Promise<string | null> {
  try {
    const payload = await verify(token, env.USER_JWT_SECRET, 'HS256') as { sub?: string; type?: string }
    if (payload.type !== 'refresh' || !payload.sub) return null
    return payload.sub
  } catch {
    return null
  }
}

export async function registerUser(input: { name: string; email: string; password: string }) {
  if (!isEmailDomainAllowed(input.email)) {
    throw new Error('Email domain not allowed')
  }

  const existing = await getUserByEmail(input.email)
  if (existing) {
    throw new Error('User already exists')
  }

  const passwordHash = await hashPassword(input.password)
  const user = await createUser({ name: input.name, email: input.email, passwordHash })

  const [accessToken, refreshToken] = await Promise.all([
    generateToken(user.id),
    generateRefreshToken(user.id),
  ])

  return { user, accessToken, refreshToken }
}

export async function loginUser(input: { email: string; password: string }) {
  const user = await getUserByEmail(input.email)
  if (!user) {
    throw new Error('Invalid credentials')
  }
  if (!user.passwordHash) {
    throw new Error('Invalid credentials')
  }

  const valid = await verifyPassword(input.password, user.passwordHash)
  if (!valid) {
    throw new Error('Invalid credentials')
  }

  const [accessToken, refreshToken] = await Promise.all([
    generateToken(user.id),
    generateRefreshToken(user.id),
  ])

  return { user, accessToken, refreshToken }
}

export async function loginWithGithub(input: {
  githubId: string
  email: string
  name: string
  avatarUrl?: string | null
}) {
  if (!isEmailDomainAllowed(input.email)) {
    throw new Error('Email domain not allowed')
  }

  const byGithub = await getUserByGithubId(input.githubId)
  let user = byGithub

  if (!user) {
    const byEmail = await getUserByEmail(input.email)
    if (byEmail) {
      const existingGithubId = (byEmail as { githubId?: string | null }).githubId ?? null
      if (existingGithubId && existingGithubId !== input.githubId) {
        throw new Error('GitHub account does not match existing user')
      }
      user = existingGithubId ? byEmail : await linkGithubIdToUser(byEmail.id, input.githubId)
      if (!user) throw new Error('Failed to link GitHub account')
    } else {
      user = await createUser({
        name: input.name,
        email: input.email,
        passwordHash: null,
        githubId: input.githubId,
      })
    }
  }

  user = await maybeSyncGithubAvatar(user, input.avatarUrl)

  const [accessToken, refreshToken] = await Promise.all([
    generateToken(user.id),
    generateRefreshToken(user.id),
  ])

  return { user, accessToken, refreshToken }
}

function parseExpiry(value: string): number {
  const match = value.match(/^(\d+)([smhd])$/)
  if (!match) return 7 * 24 * 60 * 60
  const num = parseInt(match[1])
  switch (match[2]) {
    case 's': return num
    case 'm': return num * 60
    case 'h': return num * 60 * 60
    case 'd': return num * 24 * 60 * 60
    default: return 7 * 24 * 60 * 60
  }
}

async function maybeSyncGithubAvatar(
  user: PersistedUser,
  avatarUrl: string | null | undefined,
) {
  const shouldSync = user.avatar == null || isGithubAvatarPath(user.avatar)
  if (!shouldSync) return user

  const sourceUrl =
    typeof avatarUrl === 'string' && avatarUrl.trim().length > 0
      ? avatarUrl
      : buildGithubAvatarUrl(user.githubId ?? '')

  const uploadedAvatar = await uploadGithubAvatar({
    userId: user.id,
    avatarUrl: sourceUrl,
  })

  const updated = await updateUser(user.id, { avatar: uploadedAvatar })
  return updated ?? user
}
