import { resolveGhcrDigest } from '@/clients/ghcr'
import { env } from '@/env'
import { ModalClient, type Secret, type Sandbox } from 'modal'
import {
  getImageHooksVolume,
  IMAGE_BUILD_HOOK_PATH,
  IMAGE_HOOKS_ENV_VAR,
  IMAGE_HOOKS_MOUNT_PATH
} from './image-hooks'
import {
  isLikelyModalImageId,
  normalizeHeadImageId
} from '../utils/image-source'

const modalClient = new ModalClient()

const SANDBOX_AGENT_HOME = '/home/agent'
const SANDBOX_WORKSPACES_DIR = `${SANDBOX_AGENT_HOME}/workspaces`
const SANDBOX_ROOT_DIR = `${SANDBOX_AGENT_HOME}/runtime`
const SANDBOX_CODEX_HOME = `${SANDBOX_AGENT_HOME}/.codex`
const SANDBOX_PI_DIR = `${SANDBOX_AGENT_HOME}/.pi`

const BUILD_APP_NAME = 'image-builder'
const DEFAULT_MODAL_SECRET_NAME = 'openinspect-build-secret'

const CREATE_TIMEOUT_MS = 5 * 60 * 1000
const SETUP_TIMEOUT_MS = 60 * 60 * 1000
const SNAPSHOT_TIMEOUT_MS = 10 * 60 * 1000

const MAX_LOG_CHARS = 12_000

const AGENT_SOURCE_UPDATE_COMMAND = [
  'if [[ -x "${AGENT_DOCKER_DIR:-/opt/agentsandbox/agent-go/docker}/update-agent-go-source.sh" ]]; then',
  '  echo "[agent-go] syncing source checkout..."',
  '  "${AGENT_DOCKER_DIR:-/opt/agentsandbox/agent-go/docker}/update-agent-go-source.sh"',
  'fi'
].join('\n')

const AGENT_SERVER_VERIFY_COMMAND = [
  'if [[ ! -x "${AGENT_SERVER_BIN:-/opt/agentsandbox/agent-go/build-artifacts/agent-server}" ]]; then',
  '  echo "[agent-go] binary missing: ${AGENT_SERVER_BIN:-/opt/agentsandbox/agent-go/build-artifacts/agent-server}" >&2;',
  '  exit 1;',
  'fi',
  'chmod +x "${AGENT_SERVER_BIN:-/opt/agentsandbox/agent-go/build-artifacts/agent-server}"'
].join('\n')

function buildHookCommand (hookPath: string): string {
  const quotedHookPath = shellQuote(hookPath)
  return [
    `if [[ -r ${quotedHookPath} ]]; then`,
    `  if [[ -x ${quotedHookPath} ]]; then`,
    `    bash ${quotedHookPath}`,
    '  else',
    '    (',
    '      staged_hook="$(mktemp)"',
    '      trap \'rm -f "$staged_hook"\' EXIT',
    `      cp ${quotedHookPath} "$staged_hook"`,
    '      chmod +x "$staged_hook"',
    '      bash "$staged_hook"',
    '    )',
    '  fi',
    'fi'
  ].join('\n')
}

export type BuildChunk = {
  readonly source: 'stdout' | 'stderr'
  readonly text: string
}

export async function runModalImageBuild (input: {
  readonly imageId: string
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

  const baseImage = normalizeHeadImageId(input.baseImageId)
  let imageForSandbox:
    | Awaited<ReturnType<typeof modalClient.images.fromId>>
    | ReturnType<typeof modalClient.images.fromRegistry>
  let baseImageKey = ''

  if (isLikelyModalImageId(baseImage)) {
    logStep(`Using base image id: ${baseImage}`)
    imageForSandbox = await modalClient.images.fromId(baseImage)
    baseImageKey = baseImage
  } else {
    let baseImageRef = baseImage
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
  const hooksVolume = await getImageHooksVolume({
    imageId: input.imageId,
    readOnly: true
  })

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
      CODEX_HOME: SANDBOX_CODEX_HOME,
      PI_CODING_AGENT_DIR: SANDBOX_PI_DIR,
      HOME: SANDBOX_AGENT_HOME,
      [IMAGE_HOOKS_ENV_VAR]: IMAGE_HOOKS_MOUNT_PATH,
      SECRET_SEED: env.SANDBOX_SIGNING_SECRET
    },
    volumes: {
      [IMAGE_HOOKS_MOUNT_PATH]: hooksVolume
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

    setupSteps.push({
      label: 'shared image build hook',
      command: buildHookCommand(IMAGE_BUILD_HOOK_PATH),
      errorPrefix: 'build hook'
    })

    setupSteps.push({
      label: 'agent-go binary verify',
      command: AGENT_SERVER_VERIFY_COMMAND,
      errorPrefix: 'agent-go binary verify step'
    })

    for (const step of setupSteps) {
      logStep(`Running ${step.label}...`)
      const setupStdout = createLineBuffer(line => {
        emit({
          source: 'stderr',
          text: `[setup:${step.label}][stdout] ${line}\n`
        })
      })
      const setupStderr = createLineBuffer(line => {
        emit({
          source: 'stderr',
          text: `[setup:${step.label}][stderr] ${line}\n`
        })
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

function truncateTail (text: string): string {
  if (text.length <= MAX_LOG_CHARS) return text
  return `... (truncated, showing last ${MAX_LOG_CHARS} chars)\n${text.slice(
    -MAX_LOG_CHARS
  )}`
}
