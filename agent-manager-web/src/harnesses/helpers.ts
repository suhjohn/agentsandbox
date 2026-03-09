import type { CatalogModel, HarnessDefinition, ThinkingLevel } from './types'

export const DEFAULT_HARNESS_ID = 'codex'

export function normalizeHarnessId (
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

export function resolveHarnessId (
  ...values: Array<string | null | undefined>
): string {
  for (const value of values) {
    const normalized = normalizeHarnessId(value)
    if (normalized) return normalized
  }
  return DEFAULT_HARNESS_ID
}

export function resolveSelectableModels (args: {
  readonly harness: HarnessDefinition
  readonly selectedModel: string
}): readonly CatalogModel[] {
  const available = args.harness.getModels()
  const selectedModel = args.selectedModel.trim()
  if (
    selectedModel.length === 0 ||
    available.some(model => model.id === selectedModel)
  ) {
    return available
  }

  const formatted = args.harness.formatSelectedModel?.(selectedModel) ?? {
    name: `${selectedModel} (current)`,
    provider: 'current'
  }

  return [
    {
      id: selectedModel,
      ...formatted
    },
    ...available
  ]
}

export function normalizeThinkingLevel (
  harness: HarnessDefinition,
  value: string | null | undefined
): string {
  const trimmed = value?.trim().toLowerCase() ?? ''
  if (trimmed.length === 0) return ''
  return harness.getThinkingLevels().includes(trimmed) ? trimmed : ''
}

export function formatThinkingLevelLabel (value: ThinkingLevel): string {
  if (value === 'xhigh') return 'X-High'
  if (value === 'off') return 'Off'
  return value.charAt(0).toUpperCase() + value.slice(1)
}
