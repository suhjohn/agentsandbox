import type { ReactNode } from 'react'
import { isCodexMessageBody } from '@/components/messages/codex-message'
import {
  isPiMessageBody,
  parsePiStoredMessage,
  parsePiStreamEvent
} from '@/components/messages/pi-message'
import type { UserInput } from '@openai/codex-sdk'

export function formatLastMessagePreview (
  value: unknown,
  renderActivityPlaceholder: () => ReactNode,
  emptyFallback: ReactNode = 'No messages yet.'
): ReactNode {
  const parsed = parseMaybeJson(value)
  if (isCodexMessageBody(parsed)) {
    const text = extractCodexMessageText(parsed)
    return text ? normalizePreview(text) : renderActivityPlaceholder()
  }
  if (isPiMessageBody(parsed)) {
    const text = extractPiMessageText(parsed)
    return text ? normalizePreview(text) : renderActivityPlaceholder()
  }
  const text = extractGenericText(parsed)
  return text ? normalizePreview(text) : emptyFallback
}

export function normalizePreview (value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function parseMaybeJson (value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractCodexMessageText (value: unknown): string | null {
  if (!isCodexMessageBody(value)) return null
  const record = value as Record<string, unknown>

  if (record.type === 'user_input') {
    const input = record.input
    if (Array.isArray(input)) return formatCodexUserInput(input)
  }

  if (
    record.type === 'assistant.message' ||
    record.type === 'assistant.delta'
  ) {
    const text =
      typeof record.text === 'string'
        ? record.text
        : typeof record.delta === 'string'
        ? record.delta
        : null
    return text && text.trim().length > 0 ? text : null
  }

  const item = record.item
  if (!isRecord(item)) return null
  const itemType = item.type
  if (itemType === 'agent_message' || itemType === 'user_message') {
    const text = (item as { text?: unknown }).text
    return typeof text === 'string' && text.trim().length > 0 ? text : null
  }

  return null
}

function formatCodexUserInput (input: readonly unknown[]): string | null {
  const parts: string[] = []
  for (const item of input) {
    if (!isUserInput(item)) continue
    if (item.type === 'text') {
      const text = item.text.trim()
      if (text.length > 0) parts.push(text)
    } else if (item.type === 'local_image') {
      const path = item.path.trim()
      if (path.length > 0) parts.push(`[image: ${path}]`)
    }
  }
  const joined = parts.join(' ').trim()
  return joined.length > 0 ? joined : null
}

function isUserInput (value: unknown): value is UserInput {
  if (!isRecord(value)) return false
  if (value.type === 'text') return typeof value.text === 'string'
  if (value.type === 'local_image') return typeof value.path === 'string'
  return false
}

function extractPiMessageText (value: unknown): string | null {
  if (!isPiMessageBody(value)) return null
  const parsed = parsePiStoredMessage({ id: 'preview', body: value })
  if (!parsed) {
    if (!isRecord(value) || typeof value.type !== 'string') return null
    const streamParsed = parsePiStreamEvent(value.type, value)
    if (!streamParsed) return null
    if (streamParsed.kind === 'assistant_delta') return streamParsed.text
    if (streamParsed.kind === 'assistant_message') return streamParsed.text
    if (streamParsed.kind === 'error') return streamParsed.message
    return null
  }
  if (parsed.kind === 'assistant') return parsed.text
  if (parsed.kind === 'user') return parsed.message.content
  return null
}

function extractGenericText (value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (isRecord(value)) {
    if (typeof value.text === 'string') {
      const trimmed = value.text.trim()
      return trimmed.length > 0 ? trimmed : null
    }
    if (typeof value.content === 'string') {
      const trimmed = value.content.trim()
      return trimmed.length > 0 ? trimmed : null
    }
  }
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}
