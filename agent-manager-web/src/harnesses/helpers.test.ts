import { describe, expect, it } from 'bun:test'
import type { HarnessDefinition } from './types'
import {
  DEFAULT_HARNESS_ID,
  formatThinkingLevelLabel,
  normalizeHarnessId,
  normalizeThinkingLevel,
  resolveHarnessId,
  resolveSelectableModels
} from './helpers'

const testHarness: HarnessDefinition = {
  id: 'test',
  label: 'Test',
  getModels: () => [
    { id: 'alpha', name: 'Alpha', provider: 'openai' },
    { id: 'beta', name: 'Beta', provider: 'anthropic' }
  ],
  getThinkingLevels: () => ['low', 'high'],
  formatSelectedModel: model => ({
    name: `${model} (current)`,
    provider: 'current'
  }),
  MessageView: () => null
}

describe('harness helpers', () => {
  it('preserves arbitrary non-empty harness ids', () => {
    expect(normalizeHarnessId(' opencode ')).toBe('opencode')
    expect(normalizeHarnessId('')).toBeUndefined()
  })

  it('resolves the first defined harness id and falls back to codex', () => {
    expect(resolveHarnessId(undefined, 'pi', 'codex')).toBe('pi')
    expect(resolveHarnessId(undefined, '   ', null)).toBe(DEFAULT_HARNESS_ID)
  })

  it('prepends the current model when it is not in the catalog', () => {
    const result = resolveSelectableModels({
      harness: testHarness,
      selectedModel: 'custom-model'
    })

    expect(result[0]).toEqual({
      id: 'custom-model',
      name: 'custom-model (current)',
      provider: 'current'
    })
    expect(result).toHaveLength(3)
  })

  it('keeps only known thinking levels for a harness', () => {
    expect(normalizeThinkingLevel(testHarness, ' HIGH ')).toBe('high')
    expect(normalizeThinkingLevel(testHarness, 'xhigh')).toBe('')
  })

  it('formats special thinking level labels', () => {
    expect(formatThinkingLevelLabel('xhigh')).toBe('X-High')
    expect(formatThinkingLevelLabel('off')).toBe('Off')
    expect(formatThinkingLevelLabel('medium')).toBe('Medium')
  })
})
