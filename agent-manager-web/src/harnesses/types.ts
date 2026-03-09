import type { ComponentType } from 'react'
import type { GetSessionId200MessagesItem } from '@/api/generated/agent'

export type ThinkingLevel = string

export type CatalogModel = {
  readonly id: string
  readonly name: string
  readonly provider: string
}

export type HarnessMessageProps = {
  readonly messages: readonly GetSessionId200MessagesItem[]
}

export type HarnessDefinition = {
  readonly id: string
  readonly label: string
  readonly getModels: () => readonly CatalogModel[]
  readonly getThinkingLevels: () => readonly ThinkingLevel[]
  readonly formatSelectedModel?: (model: string) => {
    readonly name: string
    readonly provider: string
  }
  readonly MessageView: ComponentType<HarnessMessageProps>
}
