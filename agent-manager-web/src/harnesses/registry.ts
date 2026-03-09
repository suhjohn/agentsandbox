import { FallbackMessages } from './fallback-message-view'
import type { HarnessDefinition } from './types'

const modules = import.meta.glob('./*/index.ts', {
  eager: true
}) as Record<string, { default: HarnessDefinition }>

const definitions = Object.values(modules).map(module => module.default)
const byID = new Map(definitions.map(definition => [definition.id, definition]))

export function getHarness (id: string | null | undefined): HarnessDefinition | null {
  const key = id?.trim().toLowerCase()
  if (!key) return null
  return byID.get(key) ?? null
}

export function getHarnessOrFallback (
  id: string | null | undefined
): HarnessDefinition {
  return (
    getHarness(id) ?? {
      id: id?.trim().toLowerCase() || 'unknown',
      label: id?.trim() || 'unknown',
      getModels: () => [],
      getThinkingLevels: () => [],
      formatSelectedModel: model => ({
        name: `${model} (current)`,
        provider: 'current'
      }),
      MessageView: FallbackMessages
    }
  )
}

export function listHarnesses (): readonly HarnessDefinition[] {
  return definitions
}
