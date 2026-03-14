import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from './button'
import { Input } from './input'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

export type ModelOption = {
  readonly id: string
  readonly name: string
  readonly provider: string
}

export type ModelComboboxProps = {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly models: readonly ModelOption[]
  readonly disabled?: boolean
  readonly placeholder?: string
  readonly className?: string
}

export function ModelCombobox ({
  value,
  onChange,
  models,
  disabled,
  placeholder = 'Select model...',
  className
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const popoverContainer = (() => {
    const container = triggerRef.current?.closest('[role="dialog"]')
    return container instanceof HTMLElement ? container : undefined
  })()

  const commitSelection = (nextValue: string) => {
    onChange(nextValue)
    setOpen(false)
    setQuery('')
  }

  const selectedModel = useMemo(
    () => models.find(m => m.id === value),
    [models, value]
  )

  const filteredModels = useMemo(() => {
    if (normalizedQuery.length === 0) return models
    return models.filter(model =>
      `${model.id} ${model.name} ${model.provider}`
        .toLowerCase()
        .includes(normalizedQuery)
    )
  }, [models, normalizedQuery])

  const groupedModels = useMemo(() => {
    const groups = new Map<string, ModelOption[]>()

    const shouldShowDefault =
      normalizedQuery.length === 0 ||
      'default model'.includes(normalizedQuery) ||
      'default'.includes(normalizedQuery)

    if (shouldShowDefault) {
      groups.set('default', [
        { id: '', name: 'Default model', provider: 'default' }
      ])
    }

    for (const model of filteredModels) {
      const provider = model.provider
      if (!groups.has(provider)) {
        groups.set(provider, [])
      }
      groups.get(provider)!.push(model)
    }

    return groups
  }, [filteredModels, normalizedQuery])

  const displayLabel = useMemo(() => {
    if (!value) return 'Default model'
    if (!selectedModel) return value
    if (selectedModel.provider === 'saved') {
      return selectedModel.name
    }
    if (selectedModel.provider === 'current') {
      return selectedModel.name
    }
    if (value.includes('/')) {
      return `${selectedModel.name} (${selectedModel.provider})`
    }
    if (selectedModel.provider === 'openai') {
      return selectedModel.name
    }
    return `${selectedModel.name} (${selectedModel.provider})`
  }, [value, selectedModel])

  const getProviderLabel = (provider: string): string => {
    if (provider === 'default') return ''
    if (provider === 'current') return 'Current'
    if (provider === 'saved') return 'Saved'
    return provider.charAt(0).toUpperCase() + provider.slice(1)
  }

  return (
    <Popover
      open={open}
      onOpenChange={nextOpen => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setQuery('')
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant='icon'
          role='combobox'
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'h-7 justify-between gap-1 px-2 text-xs font-normal text-text-secondary hover:text-text-primary',
            className
          )}
        >
          <span className='truncate'>{displayLabel}</span>
          <ChevronsUpDown className='h-3.5 w-3.5 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={popoverContainer}
        className='w-[300px] p-0 bg-surface-1/95 backdrop-blur-sm'
        align='start'
        onOpenAutoFocus={event => {
          event.preventDefault()
          queueMicrotask(() => inputRef.current?.focus())
        }}
      >
        <div className='border-b border-border px-3 py-2'>
          <Input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={placeholder}
            className='h-8 border-0 bg-transparent px-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
        <div className='max-h-[320px] overflow-y-auto p-1'>
          {Array.from(groupedModels.entries()).length === 0 ? (
            <div className='px-2 py-6 text-center text-sm text-muted-foreground'>
              No model found.
            </div>
          ) : (
            Array.from(groupedModels.entries()).map(
              ([provider, providerModels]) => (
                <div key={provider} className='py-1'>
                  {getProviderLabel(provider) ? (
                    <div className='px-2 py-1.5 text-xs font-medium text-muted-foreground'>
                      {getProviderLabel(provider)}
                    </div>
                  ) : null}
                  <div className='space-y-0.5'>
                    {providerModels.map(model => (
                      <button
                        key={model.id}
                        type='button'
                        className={cn(
                          'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors',
                          value === model.id
                            ? 'bg-accent text-accent-foreground'
                            : 'text-text-secondary hover:bg-accent/60 hover:text-text-primary'
                        )}
                        onClick={() => {
                          commitSelection(model.id)
                        }}
                      >
                        <span className='flex-1 truncate'>{model.name}</span>
                        <Check
                          className={cn(
                            'h-4 w-4',
                            value === model.id ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )
            )
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
