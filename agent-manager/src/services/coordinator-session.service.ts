import { and, eq, desc, asc, lt } from 'drizzle-orm'
import { db } from '../db'
import { coordinatorSessions, messages } from '../db/schema'
import type { MessageRole } from '../db/enums'

export async function createCoordinatorSession(input: {
  title?: string
  createdBy: string
}) {
  const [coordinatorSession] = await db.insert(coordinatorSessions).values({
    title: input.title,
    createdBy: input.createdBy,
  }).returning()
  return coordinatorSession
}

export async function getCoordinatorSessionById(id: string) {
  const result = await db.select().from(coordinatorSessions)
    .where(eq(coordinatorSessions.id, id))
    .limit(1)
  return result[0] ?? null
}

export async function updateCoordinatorSessionTitle(id: string, title: string) {
  const [updated] = await db.update(coordinatorSessions)
    .set({ title, updatedAt: new Date() })
    .where(eq(coordinatorSessions.id, id))
    .returning()
  return updated ?? null
}

export async function deleteCoordinatorSession(id: string) {
  const result = await db
    .delete(coordinatorSessions)
    .where(eq(coordinatorSessions.id, id))
    .returning()
  return result.length > 0
}

export async function listCoordinatorSessions(input: {
  userId: string
  limit: number
  cursor?: string
}) {
  const conditions = [eq(coordinatorSessions.createdBy, input.userId)]
  if (input.cursor) {
    const parsedCursor = new Date(input.cursor)
    if (!Number.isNaN(parsedCursor.getTime())) {
      conditions.push(lt(coordinatorSessions.updatedAt, parsedCursor))
    }
  }

  const result = await db
    .select()
    .from(coordinatorSessions)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .orderBy(desc(coordinatorSessions.updatedAt))
    .limit(input.limit + 1)

  const hasMore = result.length > input.limit
  if (hasMore) result.pop()

  return {
    coordinatorSessions: result,
    nextCursor: hasMore ? result[result.length - 1].updatedAt.toISOString() : null,
  }
}

export async function addMessage(input: {
  coordinatorSessionId: string
  role: MessageRole
  content: string
  toolCalls?: unknown
  toolResults?: unknown
}) {
  const [message] = await db.insert(messages).values({
    coordinatorSessionId: input.coordinatorSessionId,
    role: input.role,
    content: input.content,
    toolCalls: input.toolCalls,
    toolResults: input.toolResults,
  }).returning()

  await db.update(coordinatorSessions)
    .set({ updatedAt: new Date() })
    .where(eq(coordinatorSessions.id, input.coordinatorSessionId))

  return message
}

export async function getMessagesByCoordinatorSessionId(coordinatorSessionId: string) {
  return db.select().from(messages)
    .where(eq(messages.coordinatorSessionId, coordinatorSessionId))
    .orderBy(asc(messages.createdAt))
}

export async function getCoordinatorSessionWithMessages(coordinatorSessionId: string) {
  const coordinatorSession = await getCoordinatorSessionById(coordinatorSessionId)
  if (!coordinatorSession) return null

  const msgs = await getMessagesByCoordinatorSessionId(coordinatorSessionId)
  return { ...coordinatorSession, messages: msgs }
}
