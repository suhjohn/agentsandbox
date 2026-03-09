import { CodexMessages } from '@/components/messages/codex-message'
import { OPENAI_MODELS } from '../catalog'
import type { HarnessDefinition } from '../types'

const codexHarness: HarnessDefinition = {
  id: 'codex',
  label: 'Codex',
  getModels: () => OPENAI_MODELS,
  getThinkingLevels: () => ['minimal', 'low', 'medium', 'high', 'xhigh'],
  formatSelectedModel: model => ({
    name: `${model} (current)`,
    provider: 'current'
  }),
  MessageView: CodexMessages
}

export default codexHarness
