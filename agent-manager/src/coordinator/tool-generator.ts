import type { Tool } from 'ai'
import { createBashTool } from 'bash-tool'
import { Bash } from 'just-bash'
import { existsSync } from 'node:fs'
import path from 'node:path'

function getManagerOrigin(baseUrl: string): string {
  return new URL(baseUrl).origin
}

function getBearerTokenFromHeader(authHeader: string): string {
  const trimmed = authHeader.trim()
  if (!trimmed.toLowerCase().startsWith('bearer ')) return ''
  return trimmed.slice('bearer '.length).trim()
}

function hasMonorepoShape(rootDir: string): boolean {
  return (
    existsSync(path.join(rootDir, 'agent')) &&
    existsSync(path.join(rootDir, 'agent-manager')) &&
    existsSync(path.join(rootDir, 'agent-manager-web'))
  )
}

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd()
  if (hasMonorepoShape(cwd)) return cwd

  const parent = path.dirname(cwd)
  if (hasMonorepoShape(parent)) return parent

  if (path.basename(cwd) === 'agent-manager') {
    const maybeRoot = path.dirname(cwd)
    if (hasMonorepoShape(maybeRoot)) return maybeRoot
  }

  return cwd
}

export async function createCoordinatorBashTools(input: {
  readonly baseUrl: string
  readonly userAuthHeader: string
}): Promise<Record<string, Tool>> {
  const origin = getManagerOrigin(input.baseUrl)
  const userAuthHeader = input.userAuthHeader.trim()
  const userAuthToken = getBearerTokenFromHeader(userAuthHeader)
  const userAuthorizationHeader =
    userAuthHeader.length > 0 ? `Authorization: ${userAuthHeader}` : ''
  const workspaceRoot = resolveWorkspaceRoot()
  const managerDir = path.join(workspaceRoot, 'agent-manager')
  const webDir = path.join(workspaceRoot, 'agent-manager-web')
  const agentDir = path.join(workspaceRoot, 'agent')
  const sandbox = new Bash({
    cwd: workspaceRoot,
    env: {
      AGENT_MANAGER_BASE_URL: origin,
      USER_AUTH_HEADER: userAuthHeader,
      USER_AUTHORIZATION_HEADER: userAuthorizationHeader,
      USER_AUTH_TOKEN: userAuthToken,
      COORDINATOR_WORKSPACE_ROOT: workspaceRoot,
      COORDINATOR_MANAGER_DIR: managerDir,
      COORDINATOR_WEB_DIR: webDir,
      COORDINATOR_AGENT_DIR: agentDir,
    },
    network: {
      allowedUrlPrefixes: [origin, `${origin}/`],
      allowedMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      timeoutMs: 30_000
    }
  })

  const { tools } = await createBashTool({
    sandbox,
    destination: workspaceRoot,
    maxOutputLength: 40_000,
    extraInstructions: [
      'Use curl for manager API calls with AGENT_MANAGER_BASE_URL and USER_AUTHORIZATION_HEADER.',
      'OpenAPI spec is available at "$AGENT_MANAGER_BASE_URL/openapi.json".',
      'Repository root is "$COORDINATOR_WORKSPACE_ROOT" and contains: "$COORDINATOR_AGENT_DIR", "$COORDINATOR_MANAGER_DIR", "$COORDINATOR_WEB_DIR".',
      'Run commands from root by default, then cd into specific subprojects as needed.'
    ].join('\n')
  })

  return {
    coordinator_bash: tools.bash as unknown as Tool,
    coordinator_read_file: tools.readFile as unknown as Tool,
    coordinator_write_file: tools.writeFile as unknown as Tool
  }
}
