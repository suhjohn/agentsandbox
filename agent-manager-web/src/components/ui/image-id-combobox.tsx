import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Copy } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from './button'
import { Input } from './input'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

export type ImageIdOption = {
  readonly id: string
  readonly updatedAt: string
  readonly isCurrent?: boolean
}

export type ImageIdComboboxProps = {
  readonly value: string | null
  readonly onChange?: (value: string) => void
  readonly options: readonly ImageIdOption[]
  readonly disabled?: boolean
  readonly placeholder?: string
  readonly className?: string
  readonly onCopy?: (value: string) => void
  readonly readOnly?: boolean
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return `Today, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  } else if (diffDays === 1) {
    return `Yesterday, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  } else if (diffDays < 7) {
    return `${diffDays} days ago`
  } else {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }
}

function truncateId(id: string, length = 16): string {
  if (id.length <= length) return id
  return `${id.slice(0, length)}...`
}

export function ImageIdCombobox({
  value,
  onChange,
  options,
  disabled,
  placeholder = 'Select image...',
  className,
  onCopy,
  readOnly = false
}: ImageIdComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLowerCase()

  const commitSelection = (nextValue: string) => {
    if (onChange && !readOnly) {
      onChange(nextValue)
    }
    setOpen(false)
    setQuery('')
  }

  const selectedOption = useMemo(
    () => options.find(o => o.id === value),
    [options, value]
  )

  const filteredOptions = useMemo(() => {
    if (normalizedQuery.length === 0) return options
    return options.filter(option =>
      option.id.toLowerCase().includes(normalizedQuery)
    )
  }, [options, normalizedQuery])

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
          <span className='flex items-center gap-2 truncate font-mono text-xs'>
            {value ? truncateId(value, 24) : <span className='text-text-tertiary font-sans'>{placeholder}</span>}
          </span>
          <ChevronsUpDown className='h-3.5 w-3.5 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className='w-[360px] p-0 bg-surface-1/95 backdrop-blur-sm'
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
            placeholder='Search images...'
            className='h-8 border-0 bg-transparent px-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
        <div className='max-h-[280px] overflow-y-auto p-1'>
          {filteredOptions.length === 0 ? (
            <div className='px-2 py-6 text-center text-sm text-muted-foreground'>
              No images found.
            </div>
          ) : (
            <div className='space-y-0.5'>
              {filteredOptions.map(option => (
                <div
                  key={option.id}
                  className={cn(
                    'group flex items-center rounded-sm transition-colors',
                    value === option.id
                      ? 'bg-accent text-accent-foreground'
                      : 'text-text-secondary hover:bg-accent/60 hover:text-text-primary'
                  )}
                >
                  <button
                    type='button'
                    className='flex flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm min-w-0'
                    onClick={() => commitSelection(option.id)}
                  >
                    <div className='flex flex-1 flex-col gap-0.5 min-w-0'>
                      <span className='font-mono text-xs truncate'>
                        {truncateId(option.id, 32)}
                      </span>
                      <span className='text-xs text-text-tertiary'>
                        {formatDate(option.updatedAt)}
                        {option.isCurrent && ' (current)'}
                      </span>
                    </div>
                    <Check
                      className={cn(
                        'h-4 w-4 shrink-0',
                        value === option.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </button>
                  {onCopy && (
                    <button
                      type='button'
                      className='h-7 w-7 flex items-center justify-center text-text-tertiary hover:text-text-primary opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0'
                      onClick={e => {
                        e.stopPropagation()
                        onCopy(option.id)
                      }}
                      title='Copy image ID'
                    >
                      <Copy className='h-3.5 w-3.5' />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
