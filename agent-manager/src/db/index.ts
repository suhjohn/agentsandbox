import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { env } from '../env'

const queryClient = postgres(env.DATABASE_URL)

export const db = drizzle(queryClient, { schema })

// Expose the underlying postgres-js client for cases that need connection-level
// primitives (e.g. advisory locks). Prefer `db` for normal queries.
export const pg = queryClient

export async function closeDb() {
  await queryClient.end()
}
