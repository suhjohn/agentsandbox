import { getModels, getProviders } from '@mariozechner/pi-ai'
import type { CatalogModel } from './types'

export const ALL_MODELS: readonly CatalogModel[] = getProviders()
  .flatMap(provider =>
    getModels(provider).map(model => ({
      id: model.id,
      name: model.name,
      provider: model.provider
    }))
  )
  .sort((a, b) => {
    const providerCompare = a.provider.localeCompare(b.provider)
    if (providerCompare !== 0) return providerCompare
    return a.name.localeCompare(b.name)
  })

export const OPENAI_MODELS: readonly CatalogModel[] = ALL_MODELS.filter(
  model => model.provider === 'openai'
)
