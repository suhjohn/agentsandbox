import { ModalClient, type Secret, type Sandbox } from 'modal'

const modalClient = new ModalClient()

const SANDBOX_AGENT_HOME = '/home/agent'
const SANDBOX_WORKSPACES_DIR = `${SANDBOX_AGENT_HOME}/workspaces`
const SANDBOX_ROOT_DIR = `${SANDBOX_AGENT_HOME}/runtime`
const SANDBOX_RUNTIME_DIR = `${SANDBOX_ROOT_DIR}/runtime`
const SANDBOX_CODEX_HOME = `${SANDBOX_AGENT_HOME}/.codex`
const SANDBOX_PI_DIR = `${SANDBOX_AGENT_HOME}/.pi`
const SANDBOX_BROWSER_STATE_DIR = `${SANDBOX_ROOT_DIR}/browser`
const SANDBOX_CHROMIUM_USER_DATA_DIR = `${SANDBOX_BROWSER_STATE_DIR}/chromium`
const SANDBOX_XDG_CONFIG_HOME = `${SANDBOX_ROOT_DIR}/xdg/config`
const SANDBOX_XDG_CACHE_HOME = `${SANDBOX_ROOT_DIR}/xdg/cache`
const SANDBOX_XDG_DATA_HOME = `${SANDBOX_ROOT_DIR}/xdg/data`

const BUILD_APP_NAME = 'image-builder'
const DEFAULT_BASE_IMAGE_REF = 'ghcr.io/suhjohn/agent:latest'
const DEFAULT_MODAL_SECRET_NAME = 'openinspect-build-secret'

const CREATE_TIMEOUT_MS = 5 * 60 * 1000
const SETUP_TIMEOUT_MS = 60 * 60 * 1000
const SNAPSHOT_TIMEOUT_MS = 10 * 60 * 1000

const MAX_LOG_CHARS = 12_000

const AGENT_SOURCE_UPDATE_COMMAND = [
  'if command -v agent-go-update-source >/dev/null 2>&1; then',
  '  echo "[agent-go] syncing source checkout..."',
  '  if ! agent-go-update-source; then',
  '    echo "[agent-go] warning: source sync failed; continuing with current checkout" >&2;',
  '  fi;',
  'fi'
].join('\n')

const AGENT_SERVER_BUILD_COMMAND = [
  'if [[ ! -x /opt/agentsandbox/agent-go/scripts/build-agent-server.sh ]]; then',
  '  echo "[agent-go] build script missing: /opt/agentsandbox/agent-go/scripts/build-agent-server.sh" >&2;',
  '  exit 1;',
  'fi',
  '/opt/agentsandbox/agent-go/scripts/build-agent-server.sh --output /app/agent-server'
].join('\n')

export type BuildChunk = {
  readonly source: 'stdout' | 'stderr'
  readonly text: string
}

export type BuildFileSecretBinding = {
  readonly path: string
  readonly modalSecretName: string
}

export async function runModalImageBuild (input: {
  readonly imageId: string
  readonly setupScript: string
  readonly fileSecrets: readonly BuildFileSecretBinding[]
  readonly environmentSecretNames?: readonly string[]
  readonly baseImageId?: string | null
  readonly modalSecretName?: string
  readonly onChunk?: (chunk: BuildChunk) => void
}): Promise<{ readonly builtImageId: string }> {
  const stderrParts: string[] = []
  const stdoutParts: string[] = []

  const emit = (chunk: BuildChunk): void => {
    if (chunk.text.length === 0) return
    if (chunk.source === 'stderr') stderrParts.push(chunk.text)
    else stdoutParts.push(chunk.text)
    input.onChunk?.(chunk)
  }

  const logStep = (message: string): void => {
    emit({ source: 'stderr', text: `${message}\n` })
  }

  const app = await modalClient.apps.fromName(BUILD_APP_NAME, {
    createIfMissing: true
  })

  let baseImage = normalizeNullableText(input.baseImageId)
  let imageForSandbox:
    | Awaited<ReturnType<typeof modalClient.images.fromId>>
    | ReturnType<typeof modalClient.images.fromRegistry>
  let baseImageKey = ''

  if (baseImage) {
    if (isLikelyModalImageId(baseImage)) {
      logStep(`Using explicit base image id: ${baseImage}`)
      imageForSandbox = await modalClient.images.fromId(baseImage)
      baseImageKey = baseImage
    } else {
      let baseImageRef = baseImage
      try {
        const resolved = await resolveGhcrDigest(baseImageRef)
        if (resolved && resolved !== baseImageRef) {
          logStep(`Resolved explicit base image ref to digest: ${resolved}`)
          baseImageRef = resolved
        }
      } catch (err) {
        logStep(
          `Warning: failed to resolve GHCR digest for ${baseImageRef}: ${
            err instanceof Error ? err.message : String(err)
          }; continuing with tag ref`
        )
      }
      logStep(`Using explicit base image ref: ${baseImageRef}`)
      imageForSandbox = modalClient.images.fromRegistry(baseImageRef)
      baseImageKey = baseImageRef
    }
  } else {
    let baseImageRef = (
      process.env.AGENT_BASE_IMAGE_REF ?? DEFAULT_BASE_IMAGE_REF
    ).trim()
    if (!baseImageRef) {
      throw new Error(
        'Missing AGENT_BASE_IMAGE_REF. Set it to a public GHCR image reference.'
      )
    }
    try {
      const resolved = await resolveGhcrDigest(baseImageRef)
      if (resolved && resolved !== baseImageRef) {
        logStep(`Resolved base image ref to digest: ${resolved}`)
        baseImageRef = resolved
      }
    } catch (err) {
      logStep(
        `Warning: failed to resolve GHCR digest for ${baseImageRef}: ${
          err instanceof Error ? err.message : String(err)
        }; continuing with tag ref`
      )
    }
    logStep(`Building base image from registry: ${baseImageRef}`)
    imageForSandbox = modalClient.images.fromRegistry(baseImageRef)
    baseImageKey = baseImageRef
  }

  const defaultSecretName =
    normalizeNullableText(input.modalSecretName) ?? DEFAULT_MODAL_SECRET_NAME
  const secretNames = normalizeSecretNames([
    defaultSecretName,
    ...(input.environmentSecretNames ?? [])
  ])
  const modalSecrets: Secret[] = []
  for (const secretName of secretNames) {
    try {
      modalSecrets.push(await modalClient.secrets.fromName(secretName))
    } catch {
      logStep(
        `Warning: Modal secret not found: ${secretName}; continuing without it`
      )
    }
  }

  logStep('Creating sandbox...')
  const sandbox = await modalClient.sandboxes.create(app, imageForSandbox, {
    command: [
      'bash',
      '-lc',
      'mkdir -p "${WORKSPACES_DIR}" && cd "${WORKSPACES_DIR}" && sleep infinity'
    ],
    env: {
      AGENT_HOME: SANDBOX_AGENT_HOME,
      AGENT_ID: input.imageId,
      WORKSPACES_DIR: SANDBOX_WORKSPACES_DIR,
      ROOT_DIR: SANDBOX_ROOT_DIR,
      RUNTIME_DIR: SANDBOX_RUNTIME_DIR,
      DATABASE_PATH: `${SANDBOX_ROOT_DIR}/app/agent.db`,
      CODEX_HOME: SANDBOX_CODEX_HOME,
      PI_DIR: SANDBOX_PI_DIR,
      BROWSER_STATE_DIR: SANDBOX_BROWSER_STATE_DIR,
      CHROMIUM_USER_DATA_DIR: SANDBOX_CHROMIUM_USER_DATA_DIR,
      XDG_CONFIG_HOME: SANDBOX_XDG_CONFIG_HOME,
      XDG_CACHE_HOME: SANDBOX_XDG_CACHE_HOME,
      XDG_DATA_HOME: SANDBOX_XDG_DATA_HOME,
      DOCKERD_DATA_ROOT: `${SANDBOX_ROOT_DIR}/docker`,
      HOME: SANDBOX_AGENT_HOME,
      AGENT_RUNTIME_MODE: 'server',
      SECRET_SEED: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    },
    ...(modalSecrets.length > 0 ? { secrets: modalSecrets } : {}),
    timeoutMs: CREATE_TIMEOUT_MS
  })
  logStep('Sandbox created.')

  try {
    await writeFileIfMissing(
      sandbox,
      '/etc/agent-base-image-ref',
      `${baseImageKey}\n`
    )
    await writeFileIfMissing(sandbox, '/etc/agent-image-version', 'unknown\n')

    const setupSteps: Array<{
      readonly label: string
      readonly command: string
      readonly errorPrefix: string
    }> = [
      {
        label: 'source sync',
        command: AGENT_SOURCE_UPDATE_COMMAND,
        errorPrefix: 'setup preamble'
      }
    ]

    if (input.setupScript.trim().length > 0) {
      const setupScriptPath = '/tmp/image-setup.sh'
      await writeFile(sandbox, setupScriptPath, input.setupScript)
      setupSteps.push({
        label: 'user setup script',
        command: `chmod 700 ${shellQuote(setupScriptPath)} && ${shellQuote(
          setupScriptPath
        )}`,
        errorPrefix: 'setup script'
      })
    }

    setupSteps.push({
      label: 'agent-go binary build',
      command: AGENT_SERVER_BUILD_COMMAND,
      errorPrefix: 'agent-go build step'
    })

    for (const step of setupSteps) {
      logStep(`Running ${step.label}...`)
      const setupStdout = createLineBuffer(line => {
        emit({ source: 'stderr', text: `[setup:${step.label}][stdout] ${line}\n` })
      })
      const setupStderr = createLineBuffer(line => {
        emit({ source: 'stderr', text: `[setup:${step.label}][stderr] ${line}\n` })
      })
      const { exitCode, stderr } = await execText(
        sandbox,
        ['bash', '-lc', step.command],
        {
          timeoutMs: SETUP_TIMEOUT_MS,
          onStdoutChunk: chunk => {
            setupStdout.push(chunk)
          },
          onStderrChunk: chunk => {
            setupStderr.push(chunk)
          }
        }
      )
      setupStdout.flush()
      setupStderr.flush()
      if (exitCode !== 0) {
        throw new Error(
          `${step.errorPrefix} failed (exit ${exitCode}).${
            stderr.trim().length > 0 ? `\n--- stderr ---\n${stderr}` : ''
          }`
        )
      }
    }

    const fileSecrets = parseFileSecrets(input.fileSecrets)
    if (fileSecrets.length > 0) {
      logStep(`Materializing ${fileSecrets.length} file secret binding(s)...`)
      const cache = new Map<string, Record<string, string>>()
      for (const binding of fileSecrets) {
        const secret = binding.modalSecretName.trim()
        if (!cache.has(secret)) {
          const items = await inspectModalSecretItemsInSandbox(sandbox, secret)
          cache.set(secret, items)
        }
        const targetEnvPath = resolveSandboxEnvFilePath(binding.path)
        const dotenvContents = renderDotenv(cache.get(secret) ?? {})
        await writeDotenvFile(sandbox, targetEnvPath, dotenvContents)
        logStep(
          `Wrote ${
            Object.keys(cache.get(secret) ?? {}).length
          } item(s) to ${targetEnvPath}`
        )
      }
    }

    logStep('Snapshotting filesystem...')
    const image = await sandbox.snapshotFilesystem(SNAPSHOT_TIMEOUT_MS)
    logStep('Snapshot complete.')

    const builtImageId = normalizeNullableText(image.imageId)
    if (!builtImageId) {
      throw new Error('Snapshot did not return an image id.')
    }
    emit({ source: 'stdout', text: `BUILT_IMAGE_ID=${builtImageId}\n` })
    return { builtImageId }
  } catch (err) {
    const stdout = stdoutParts.join('')
    const stderr = stderrParts.join('')
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      [
        message,
        `--- stderr ---\n${truncateTail(stderr)}`,
        `--- stdout ---\n${truncateTail(stdout)}`
      ].join('\n')
    )
  } finally {
    try {
      await sandbox.terminate()
    } catch (err) {
      logStep(
        `Warning: failed to terminate sandbox cleanly: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }
}

async function resolveGhcrDigest (imageRef: string): Promise<string | null> {
  const ref = imageRef.trim()
  if (!ref) return null
  if (ref.includes('@')) return ref

  const slash = ref.indexOf('/')
  if (slash <= 0 || slash === ref.length - 1) return null
  const registry = ref.slice(0, slash)
  const remainder = ref.slice(slash + 1)
  if (registry !== 'ghcr.io') return null

  const colon = remainder.lastIndexOf(':')
  const repo = colon > 0 ? remainder.slice(0, colon) : remainder
  const tag = colon > 0 ? remainder.slice(colon + 1) : 'latest'
  if (!repo || !tag) return null

  const tokenUrl = new URL('https://ghcr.io/token')
  tokenUrl.searchParams.set('service', 'ghcr.io')
  tokenUrl.searchParams.set('scope', `repository:${repo}:pull`)
  const tokenResp = await fetchWithTimeout(tokenUrl.toString(), {}, 10_000)
  if (!tokenResp.ok) return null
  const tokenPayload = (await tokenResp.json()) as { token?: unknown }
  const token =
    typeof tokenPayload.token === 'string' ? tokenPayload.token.trim() : ''
  if (!token) return null

  const manifestResp = await fetchWithTimeout(
    `https://ghcr.io/v2/${repo}/manifests/${encodeURIComponent(tag)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: [
          'application/vnd.oci.image.index.v1+json',
          'application/vnd.docker.distribution.manifest.list.v2+json',
          'application/vnd.oci.image.manifest.v1+json',
          'application/vnd.docker.distribution.manifest.v2+json'
        ].join(', ')
      }
    },
    10_000
  )
  if (!manifestResp.ok) return null
  const digest = (
    manifestResp.headers.get('Docker-Content-Digest') ?? ''
  ).trim()
  if (!digest.startsWith('sha256:')) return null
  return `${registry}/${repo}@${digest}`
}

async function fetchWithTimeout (
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function writeFileIfMissing (
  sandbox: Sandbox,
  path: string,
  contents: string
): Promise<void> {
  try {
    const file = await sandbox.open(path, 'r')
    await file.close()
    return
  } catch {
    // ignore; file does not exist
  }
  try {
    await writeFile(sandbox, path, contents)
  } catch {
    // Keep parity with Python behavior: best-effort write.
  }
}

async function writeFile (
  sandbox: Sandbox,
  path: string,
  contents: string
): Promise<void> {
  const file = await sandbox.open(path, 'w')
  try {
    await file.write(new TextEncoder().encode(contents))
    await file.flush()
  } finally {
    await file.close()
  }
}

function envDiffKeys (
  a: Record<string, string>,
  b: Record<string, string>
): Set<string> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const out = new Set<string>()
  for (const key of keys) {
    if ((a[key] ?? null) !== (b[key] ?? null)) out.add(key)
  }
  return out
}

async function sandboxExecJson (input: {
  readonly sandbox: Sandbox
  readonly args: readonly string[]
  readonly secrets?: readonly Secret[]
  readonly timeoutMs?: number
}): Promise<Record<string, unknown>> {
  const { exitCode, stdout, stderr } = await execText(
    input.sandbox,
    [...input.args],
    {
      timeoutMs: input.timeoutMs,
      secrets: input.secrets ? [...input.secrets] : undefined
    }
  )
  if (exitCode !== 0) {
    throw new Error(
      `Sandbox exec failed (exit ${exitCode}).${
        stderr.trim().length > 0 ? ` (stderr: ${stderr.trim()})` : ''
      }`
    )
  }
  const trimmed = stdout.trim()
  if (trimmed.length === 0) {
    throw new Error('Sandbox exec produced no stdout.')
  }
  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('expected JSON object')
  }
  return parsed as Record<string, unknown>
}

async function sandboxDumpEnv (input: {
  readonly sandbox: Sandbox
  readonly secrets?: readonly Secret[]
  readonly timeoutMs?: number
}): Promise<Record<string, string>> {
  const payload = await sandboxExecJson({
    sandbox: input.sandbox,
    args: [
      'python3',
      '-c',
      'import json, os; print(json.dumps(dict(os.environ)))'
    ],
    secrets: input.secrets,
    timeoutMs: input.timeoutMs
  })
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (typeof key === 'string' && typeof value === 'string') {
      env[key] = value
    }
  }
  return env
}

async function inspectModalSecretItemsInSandbox (
  sandbox: Sandbox,
  secretName: string
): Promise<Record<string, string>> {
  const name = secretName.trim()
  if (name.length === 0) throw new Error('secret name must be non-empty')

  const env0 = await sandboxDumpEnv({ sandbox, timeoutMs: 60_000 })
  const env1 = await sandboxDumpEnv({ sandbox, timeoutMs: 60_000 })
  const noise = envDiffKeys(env0, env1)

  const secret = await modalClient.secrets.fromName(name)
  const envSecret = await sandboxDumpEnv({
    sandbox,
    timeoutMs: 60_000,
    secrets: [secret]
  })

  const candidates = envDiffKeys(env1, envSecret)
  const out: Record<string, string> = {}
  for (const key of [...candidates].sort()) {
    if (noise.has(key)) continue
    if (key.startsWith('MODAL_')) continue
    if (typeof envSecret[key] === 'string') out[key] = envSecret[key]!
  }
  return out
}

function parseFileSecrets (
  input: readonly BuildFileSecretBinding[]
): readonly BuildFileSecretBinding[] {
  return input
    .map(item => ({
      path: item.path,
      modalSecretName: item.modalSecretName
    }))
    .filter(
      item =>
        item.path.trim().length > 0 && item.modalSecretName.trim().length > 0
    )
}

function normalizeSecretNames (input: readonly string[]): readonly string[] {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const value of input) {
    const name = normalizeNullableText(value)
    if (!name) continue
    if (seen.has(name)) continue
    seen.add(name)
    normalized.push(name)
  }
  return normalized
}

function dotenvEscapeValue (value: string): string {
  if (value === '') return ''
  const safe = /^[a-zA-Z0-9_./:@+-]+$/
  if (safe.test(value)) return value
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`
}

function renderDotenv (items: Record<string, string>): string {
  const lines: string[] = []
  const keys = Object.keys(items).sort()
  for (const key of keys) {
    if (!key.trim()) continue
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(
        `Invalid env var key in Modal secret: ${JSON.stringify(
          key
        )} (expected [A-Za-z_][A-Za-z0-9_]*).`
      )
    }
    const value = items[key]
    if (typeof value !== 'string') continue
    lines.push(`${key}=${dotenvEscapeValue(value)}`)
  }
  return `${lines.join('\n')}\n`
}

function resolveSandboxEnvFilePath (bindingPath: string): string {
  const raw = bindingPath.trim()
  let base: string
  if (raw === '.' || raw === './') {
    base = SANDBOX_WORKSPACES_DIR
  } else if (raw === '~') {
    base = SANDBOX_AGENT_HOME
  } else if (raw.startsWith('~/')) {
    base = normalizePosixPath(`${SANDBOX_AGENT_HOME}/${raw.slice(2)}`)
    if (
      base !== SANDBOX_AGENT_HOME &&
      !base.startsWith(`${SANDBOX_AGENT_HOME}/`)
    ) {
      throw new Error('~ paths must stay within the sandbox home')
    }
  } else if (raw.startsWith('/')) {
    base = normalizePosixPath(raw)
  } else {
    let rel = raw
    while (rel.startsWith('./')) rel = rel.slice(2)
    base = normalizePosixPath(`${SANDBOX_WORKSPACES_DIR}/${rel}`)
    if (
      base !== SANDBOX_WORKSPACES_DIR &&
      !base.startsWith(`${SANDBOX_WORKSPACES_DIR}/`)
    ) {
      throw new Error(
        'Relative paths must stay within the sandbox workspaces directory'
      )
    }
  }

  if (base.endsWith('/.env') || basenamePosix(base) === '.env') return base
  return `${trimTrailingSlash(base)}/.env`
}

async function writeDotenvFile (
  sandbox: Sandbox,
  targetPath: string,
  contents: string
): Promise<void> {
  const parent = dirnamePosix(targetPath) || '/'
  const mkdir = await execText(sandbox, [
    'bash',
    '-lc',
    `mkdir -p ${shellQuote(parent)} && chmod 700 ${shellQuote(parent)}`
  ])
  if (mkdir.exitCode !== 0) {
    throw new Error(`Failed to create directory for: ${targetPath}`)
  }
  await writeFile(sandbox, targetPath, contents)
  await execText(sandbox, [
    'bash',
    '-lc',
    `chmod 600 ${shellQuote(targetPath)}`
  ])
}

async function execText (
  sandbox: Sandbox,
  command: readonly string[],
  options?: {
    readonly timeoutMs?: number
    readonly secrets?: readonly Secret[]
    readonly onStdoutChunk?: (chunk: string) => void
    readonly onStderrChunk?: (chunk: string) => void
  }
): Promise<{
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}> {
  const proc = await sandbox.exec([...command], {
    mode: 'text',
    ...(typeof options?.timeoutMs === 'number'
      ? { timeoutMs: options.timeoutMs }
      : {}),
    ...(options?.secrets ? { secrets: [...options.secrets] } : {})
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    readProcessText(proc.stdout as StreamWithTextRead, options?.onStdoutChunk),
    readProcessText(proc.stderr as StreamWithTextRead, options?.onStderrChunk),
    proc.wait()
  ])
  return { exitCode, stdout, stderr }
}

type StreamWithTextRead = {
  readonly readText: () => Promise<string>
  readonly [Symbol.asyncIterator]?: () => AsyncIterator<string>
}

async function readProcessText (
  stream: StreamWithTextRead,
  onChunk?: (chunk: string) => void
): Promise<string> {
  if (!onChunk || typeof stream[Symbol.asyncIterator] !== 'function') {
    const text = await stream.readText()
    if (onChunk && text.length > 0) onChunk(text)
    return text
  }

  let output = ''
  for await (const rawChunk of stream as AsyncIterable<string>) {
    const chunk = typeof rawChunk === 'string' ? rawChunk : String(rawChunk)
    if (chunk.length === 0) continue
    onChunk(chunk)
    output += chunk
  }
  return output
}

function createLineBuffer (onLine: (line: string) => void): {
  readonly push: (chunk: string) => void
  readonly flush: () => void
} {
  let buffer = ''
  return {
    push: (chunk: string) => {
      if (chunk.length === 0) return
      buffer += chunk
      const parts = buffer.split(/\r?\n/)
      buffer = parts.pop() ?? ''
      for (const line of parts) onLine(line)
    },
    flush: () => {
      if (buffer.length === 0) return
      onLine(buffer)
      buffer = ''
    }
  }
}

function shellQuote (value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function normalizeNullableText (
  value: string | null | undefined
): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isLikelyModalImageId (value: string): boolean {
  return /^im-[a-z0-9]+$/i.test(value.trim())
}

function truncateTail (text: string): string {
  if (text.length <= MAX_LOG_CHARS) return text
  return `... (truncated, showing last ${MAX_LOG_CHARS} chars)\n${text.slice(
    -MAX_LOG_CHARS
  )}`
}

function normalizePosixPath (value: string): string {
  const input = value.trim()
  const absolute = input.startsWith('/')
  const parts = input.split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (stack.length > 0) stack.pop()
      continue
    }
    stack.push(part)
  }
  return `${absolute ? '/' : ''}${stack.join('/')}` || (absolute ? '/' : '.')
}

function dirnamePosix (value: string): string {
  if (value === '/') return '/'
  const trimmed = trimTrailingSlash(value)
  const idx = trimmed.lastIndexOf('/')
  if (idx < 0) return '.'
  if (idx === 0) return '/'
  return trimmed.slice(0, idx)
}

function basenamePosix (value: string): string {
  if (value === '/') return '/'
  const trimmed = trimTrailingSlash(value)
  const idx = trimmed.lastIndexOf('/')
  return idx < 0 ? trimmed : trimmed.slice(idx + 1)
}

function trimTrailingSlash (value: string): string {
  if (value === '/') return '/'
  return value.replace(/\/+$/, '')
}
