export const DEFAULT_HEAD_IMAGE_ID = 'suhjohn/agentdesktop'

export function normalizeHeadImageId (
  value: string | null | undefined
): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : DEFAULT_HEAD_IMAGE_ID
}

export function isLikelyModalImageId (value: string): boolean {
  return /^im-[a-z0-9]+$/i.test(value.trim())
}
