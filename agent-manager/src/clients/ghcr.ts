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

export async function resolveGhcrDigest (
  imageRef: string
): Promise<string | null> {
  const ref = imageRef.trim()
  if (ref.length === 0 || ref.includes('@')) return ref || null

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

export async function resolveBaseImageRefForRegistry (
  baseImageRef: string
): Promise<string> {
  try {
    const resolved = await resolveGhcrDigest(baseImageRef)
    if (resolved && resolved !== baseImageRef) return resolved
  } catch (err) {
    console.warn(
      '[image-setup] failed to resolve GHCR digest',
      { baseImageRef },
      err
    )
  }
  return baseImageRef
}
