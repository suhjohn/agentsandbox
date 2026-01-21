import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../db/schema'
import type { Region } from '../utils/region'
import { serializeRegion } from '../utils/region'

export async function getUserById(id: string) {
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1)
  return result[0] ?? null
}

export async function getUserByEmail(email: string) {
  const result = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1)
  return result[0] ?? null
}

export async function getUserByGithubId(githubId: string) {
  const result = await db.select().from(users).where(eq(users.githubId, githubId)).limit(1)
  return result[0] ?? null
}

export async function createUser(input: { name: string; email: string; passwordHash: string; githubId?: string | null }) {
  const result = await db.insert(users).values({
    name: input.name,
    email: input.email.toLowerCase(),
    passwordHash: input.passwordHash,
    githubId: input.githubId ?? null,
  }).returning()
  return result[0]
}

export async function linkGithubIdToUser(userId: string, githubId: string) {
  const result = await db.update(users)
    .set({ githubId, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning()
  return result[0] ?? null
}

export async function updateUser(id: string, input: {
  name?: string
  email?: string
  defaultRegion?: Region
  workspaceKeybindings?: Record<string, unknown> | null
}) {
  const serializedDefaultRegion = serializeRegion(input.defaultRegion)
  const result = await db.update(users)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(serializedDefaultRegion != null ? { defaultRegion: serializedDefaultRegion } : {}),
      ...(input.workspaceKeybindings !== undefined
        ? { workspaceKeybindings: input.workspaceKeybindings }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning()
  return result[0] ?? null
}
