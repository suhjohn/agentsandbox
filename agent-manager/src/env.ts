import { z } from 'zod'

const rawEnvSchema = z.object({
  PORT: z.coerce.number().int().default(3132),
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error', 'silent'])
    .default('info'),
  // Optional URLs for local/dev configuration:
  // - FRONTEND_URL is used for sandbox websocket Origin allowlisting.
  // - BACKEND_URL is intended for client config; the backend primarily uses SERVER_PUBLIC_URL.
  FRONTEND_URL: z.string().url().optional(),
  BACKEND_URL: z.string().url().optional(),
  // Optional public base URL to pass into Modal Function so they can call back into agent-manager.
  // For local, it'll be a Tailscale Funnel URL.
  SERVER_PUBLIC_URL: z.string().url().optional(),
  AGENT_BASE_IMAGE_REF: z
    .string()
    .default('ghcr.io/suhjohn/agentsandbox:latest'),
  // Comma-separated origins allowed to embed the proxied VS Code UI.
  // Example: "http://localhost:5174,https://manager.example.com"
  VSCODE_PROXY_FRAME_ANCESTORS: z.string().optional(),
  // Comma-separated origins allowed to access sandbox runtimes directly from the browser
  // (agent-go CORS + /terminal, and openvscode-proxy websocket origin checks).
  // Example: "http://localhost:5174,https://app.example.com"
  AGENT_ALLOWED_ORIGINS: z.string().optional(),
  // Bun defaults to 10s, which is too short for long-running endpoints like image builds.
  IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(255),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:5680'),
  // Required secrets (32+ chars each):
  // - USER_JWT_SECRET: user/session JWT signing.
  // - SANDBOX_SIGNING_SECRET: sandbox auth token signing seed.
  // - SANDBOX_TOKEN_ENCRYPTION_SECRET: sandbox access token encryption.
  USER_JWT_SECRET: z.string().min(32),
  SANDBOX_SIGNING_SECRET: z.string().min(32),
  SANDBOX_TOKEN_ENCRYPTION_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('30d'),
  ALLOWED_DOMAINS: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  STATIC_FILES_S3_ENDPOINT: z.string().url().optional(),
  STATIC_FILES_S3_REGION: z.string().default('us-east-1'),
  STATIC_FILES_S3_BUCKET: z.string().optional(),
  STATIC_FILES_S3_ACCESS_KEY_ID: z.string().optional(),
  STATIC_FILES_S3_SECRET_ACCESS_KEY: z.string().optional(),
  STATIC_FILES_S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true'),
  STATIC_FILES_LOCAL_DIR: z.string().default('.data/static-files')
})

const raw = rawEnvSchema.parse(process.env)

export const env = {
  ...raw
} as const

export function getAllowedDomains (): string[] {
  return env.ALLOWED_DOMAINS.split(',').map(d => d.trim().toLowerCase())
}

export type GithubOauthConfig = {
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUrl: string
  readonly allowedOrigins: readonly string[]
}

function normalizeOrigin (value: string): string | null {
  try {
    const url = new URL(value)
    return url.origin
  } catch {
    return null
  }
}

export function getGithubOauthConfig (): GithubOauthConfig | null {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim() ?? ''
  const redirectUrl = process.env.GITHUB_OAUTH_REDIRECT_URL?.trim() ?? ''
  const allowedOriginsRaw =
    process.env.GITHUB_OAUTH_ALLOWED_ORIGINS?.trim() ?? ''

  if (!clientId || !clientSecret || !redirectUrl || !allowedOriginsRaw)
    return null
  if (!normalizeOrigin(redirectUrl)) return null

  const allowedOrigins = allowedOriginsRaw
    .split(',')
    .map(v => v.trim())
    .map(v => normalizeOrigin(v))
    .filter((v): v is string => typeof v === 'string' && v.length > 0)

  if (allowedOrigins.length === 0) return null

  return { clientId, clientSecret, redirectUrl, allowedOrigins }
}
