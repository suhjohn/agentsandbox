import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Lock, Plus, Star, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from './button'
import { Input } from './input'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

export type VariantOption = {
  readonly id: string
  readonly name: string
  readonly scope: 'shared' | 'personal'
  readonly ownerUserId: string | null
  readonly isDefault: boolean
}

export type VariantComboboxProps = {
  readonly value: string | null
  readonly onChange: (value: string) => void
  readonly variants: readonly VariantOption[]
  readonly currentUserId: string | null
  readonly disabled?: boolean
  readonly placeholder?: string
  readonly className?: string
  readonly onDelete?: (variantId: string, variantName: string) => void
  readonly onCreate?: () => void
  readonly canCreate?: boolean
  readonly canDelete?: (variant: VariantOption) => boolean
}

export function VariantCombobox({
  value,
  onChange,
  variants,
  currentUserId,
  disabled,
  placeholder = 'Select variant...',
  className,
  onDelete,
  onCreate,
  canCreate = true,
  canDelete
}: VariantComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLowerCase()

  const commitSelection = (nextValue: string) => {
    onChange(nextValue)
    setOpen(false)
    setQuery('')
  }

  const selectedVariant = useMemo(
    () => variants.find(v => v.id === value),
    [variants, value]
  )

  const filteredVariants = useMemo(() => {
    if (normalizedQuery.length === 0) return variants
    return variants.filter(variant =>
      variant.name.toLowerCase().includes(normalizedQuery)
    )
  }, [variants, normalizedQuery])

  const groupedVariants = useMemo(() => {
    const groups = new Map<string, VariantOption[]>()

    for (const variant of filteredVariants) {
      const group = variant.scope
      if (!groups.has(group)) {
        groups.set(group, [])
      }
      groups.get(group)!.push(variant)
    }

    // Ensure shared comes before personal
    const ordered = new Map<string, VariantOption[]>()
    if (groups.has('shared')) {
      ordered.set('shared', groups.get('shared')!)
    }
    if (groups.has('personal')) {
      ordered.set('personal', groups.get('personal')!)
    }

    return ordered
  }, [filteredVariants])

  const getGroupLabel = (scope: string): string => {
    if (scope === 'shared') return 'Shared'
    if (scope === 'personal') return 'Personal'
    return scope.charAt(0).toUpperCase() + scope.slice(1)
  }

  const isOwnVariant = (variant: VariantOption): boolean => {
    return currentUserId !== null && variant.ownerUserId === currentUserId
  }

  const canDeleteVariant = (variant: VariantOption): boolean => {
    if (variant.isDefault) return false
    if (canDelete) return canDelete(variant)
    return isOwnVariant(variant)
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
          variant='outline'
          role='combobox'
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'h-8 justify-between gap-2 px-3 text-sm font-normal',
            className
          )}
        >
          <span className='flex items-center gap-2 truncate'>
            {selectedVariant ? (
              <>
                {selectedVariant.scope === 'personal' && (
                  <Lock className='h-3 w-3 shrink-0 text-text-tertiary' />
                )}
                <span className='truncate'>{selectedVariant.name}</span>
                {selectedVariant.isDefault && (
                  <Star className='h-3 w-3 shrink-0 text-yellow-500 fill-yellow-500' />
                )}
              </>
            ) : (
              <span className='text-text-tertiary'>{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className='h-3.5 w-3.5 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className='w-[280px] p-0 bg-surface-1/95 backdrop-blur-sm'
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
            placeholder='Search variants...'
            className='h-8 border-0 bg-transparent px-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
        <div className='max-h-[280px] overflow-y-auto p-1'>
          {Array.from(groupedVariants.entries()).length === 0 ? (
            <div className='px-2 py-6 text-center text-sm text-muted-foreground'>
              No variants found.
            </div>
          ) : (
            Array.from(groupedVariants.entries()).map(
              ([scope, scopeVariants]) => (
                <div key={scope} className='py-1'>
                  <div className='px-2 py-1.5 text-xs font-medium text-muted-foreground'>
                    {getGroupLabel(scope)}
                  </div>
                  <div className='space-y-0.5'>
                    {scopeVariants.map(variant => (
                      <div
                        key={variant.id}
                        className={cn(
                          'group flex items-center rounded-sm transition-colors',
                          value === variant.id
                            ? 'bg-accent text-accent-foreground'
                            : 'text-text-secondary hover:bg-accent/60 hover:text-text-primary'
                        )}
                      >
                        <button
                          type='button'
                          className='flex flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm min-w-0'
                          onClick={() => commitSelection(variant.id)}
                        >
                          <span className='flex flex-1 items-center gap-1.5 truncate min-w-0'>
                            {variant.scope === 'personal' && (
                              <Lock className='h-3 w-3 shrink-0 text-text-tertiary' />
                            )}
                            <span className='truncate'>{variant.name}</span>
                            {isOwnVariant(variant) &&
                              variant.scope === 'personal' && (
                                <span className='text-xs text-text-tertiary shrink-0'>
                                  (yours)
                                </span>
                              )}
                            {variant.isDefault && (
                              <Star className='h-3 w-3 shrink-0 text-yellow-500 fill-yellow-500' />
                            )}
                          </span>
                          <Check
                            className={cn(
                              'h-4 w-4 shrink-0',
                              value === variant.id ? 'opacity-100' : 'opacity-0'
                            )}
                          />
                        </button>
                        {onDelete && canDeleteVariant(variant) && (
                          <button
                            type='button'
                            className='h-7 w-7 flex items-center justify-center text-text-tertiary hover:text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0'
                            onClick={e => {
                              e.stopPropagation()
                              onDelete(variant.id, variant.name)
                            }}
                            title='Delete variant'
                          >
                            <Trash2 className='h-3.5 w-3.5' />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            )
          )}
        </div>
        {onCreate && canCreate && (
          <div className='border-t border-border p-1'>
            <button
              type='button'
              className='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-text-secondary hover:bg-accent/60 hover:text-text-primary transition-colors'
              onClick={() => {
                onCreate()
                setOpen(false)
              }}
            >
              <Plus className='h-4 w-4' />
              <span>Create variant</span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
