import { PiMessages } from '@/components/messages/pi-message'
import { ALL_MODELS } from '../catalog'
import type { HarnessDefinition } from '../types'

const piHarness: HarnessDefinition = {
  id: 'pi',
  label: 'PI',
  getModels: () =>
    ALL_MODELS.map(model => ({
      ...model,
      id: `${model.provider}/${model.id}`
    })),
  getThinkingLevels: () => ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  formatSelectedModel: model => ({
    name: model.includes('/')
      ? `${model.split('/').slice(1).join('/')} (current)`
      : `${model} (provider unspecified)`,
    provider: model.includes('/') ? 'current' : 'saved'
  }),
  MessageView: PiMessages
}

export default piHarness
