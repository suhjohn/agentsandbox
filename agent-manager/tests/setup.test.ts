import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db } from '../src/db'

const basePath = process.cwd()
const envFile = existsSync(resolve(basePath, '.env.test'))
  ? '.env.test'
  : '.env'

if (!existsSync(resolve(basePath, envFile))) {
  throw new Error(`Environment file not found: ${envFile}`)
}

const raw = readFileSync(resolve(basePath, envFile), 'utf-8')
const forceOverrideInTestEnv = new Set([
  'AGENT_BASE_IMAGE_REF',
  'SANDBOX_USE_PYTHON',
  'AGENT_SANDBOX_COMMAND_JSON'
])
const pinnedIntegrationEnv = {
  AGENT_BASE_IMAGE_REF: 'ghcr.io/suhjohn/agentsandbox:latest',
  SANDBOX_USE_PYTHON: '1',
  AGENT_SANDBOX_COMMAND_JSON: '["bun","run","src/index.ts"]'
} as const

for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.split('#')[0].trim()
  if (!trimmed) continue
  const [key, ...rest] = trimmed.split('=')
  if (!key) continue
  const value = rest.join('=').trim()
  if (value === '') continue
  if (
    process.env[key] === undefined ||
    (envFile === '.env.test' && forceOverrideInTestEnv.has(key))
  ) {
    process.env[key] = value
  }
}

if (process.env.AGENT_MANAGER_INTEGRATION_ALLOW_ENV_OVERRIDE !== '1') {
  for (const [key, value] of Object.entries(pinnedIntegrationEnv)) {
    process.env[key] = value
  }
}

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test'
}

const databaseUrl = process.env.DATABASE_URL
if (databaseUrl) {
  const url = new URL(databaseUrl)
  const dbName = url.pathname.replace(/^\//, '')
  if (dbName) {
    url.pathname = '/postgres'
    const sql = postgres(url.toString(), { max: 1 })
    try {
      const rows = await sql<
        { datname: string }[]
      >`SELECT datname FROM pg_database WHERE datname = ${dbName}`
      if (rows.length === 0) {
        const escaped = `"${dbName.replace(/"/g, '""')}"`
        await sql.unsafe(`CREATE DATABASE ${escaped}`)
      }
    } finally {
      await sql.end({ timeout: 1 })
    }
  }
}

await migrate(db, { migrationsFolder: 'drizzle' })
