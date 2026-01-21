import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export interface WorkspaceCommandPaletteItem {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly detail?: string
  readonly keywords?: readonly string[]
}

export interface WorkspaceCommandPaletteProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: string
  readonly description?: string
  readonly placeholder?: string
  readonly items: readonly WorkspaceCommandPaletteItem[]
  readonly onSelectItem: (
    item: WorkspaceCommandPaletteItem
  ) => void | Promise<void>
}

function matchesQuery (
  item: WorkspaceCommandPaletteItem,
  query: string
): boolean {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0) return true
  const haystack = [
    item.title,
    item.description ?? '',
    item.detail ?? '',
    ...(item.keywords ?? [])
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(normalized)
}

export function WorkspaceCommandPalette (props: WorkspaceCommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activeIndexSourceRef = useRef<'keyboard' | 'pointer' | 'programmatic'>(
    'programmatic'
  )

  const filteredItems = useMemo(
    () => props.items.filter(item => matchesQuery(item, query)),
    [props.items, query]
  )

  useEffect(() => {
    if (!props.open) return
    activeIndexSourceRef.current = 'programmatic'
    setQuery('')
    setActiveIndex(0)
  }, [props.open])

  useEffect(() => {
    if (filteredItems.length === 0) {
      activeIndexSourceRef.current = 'programmatic'
      setActiveIndex(0)
      return
    }
    if (activeIndex < filteredItems.length) return
    activeIndexSourceRef.current = 'programmatic'
    setActiveIndex(filteredItems.length - 1)
  }, [activeIndex, filteredItems.length])

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, filteredItems.length)
  }, [filteredItems.length])

  const selectItem = useCallback(
    (item: WorkspaceCommandPaletteItem) => {
      void (async () => {
        await props.onSelectItem(item)
        props.onOpenChange(false)
      })()
    },
    [props]
  )

  const selectActiveItem = useCallback(() => {
    const target = filteredItems[activeIndex]
    if (!target) return
    selectItem(target)
  }, [activeIndex, filteredItems, selectItem])

  const moveActiveIndex = useCallback(
    (delta: number) => {
      activeIndexSourceRef.current = 'keyboard'
      setActiveIndex(prev => {
        if (filteredItems.length === 0) return 0
        return (prev + delta + filteredItems.length) % filteredItems.length
      })
    },
    [filteredItems.length]
  )

  const handlePaletteKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveActiveIndex(1)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveActiveIndex(-1)
        return
      }
      if (event.key === 'Home') {
        if (filteredItems.length === 0) return
        event.preventDefault()
        activeIndexSourceRef.current = 'keyboard'
        setActiveIndex(0)
        return
      }
      if (event.key === 'End') {
        if (filteredItems.length === 0) return
        event.preventDefault()
        activeIndexSourceRef.current = 'keyboard'
        setActiveIndex(filteredItems.length - 1)
        return
      }
      if (event.key !== 'Enter') return
      event.preventDefault()
      selectActiveItem()
    },
    [filteredItems.length, moveActiveIndex, selectActiveItem]
  )

  useEffect(() => {
    if (!props.open) return
    if (filteredItems.length === 0) return
    if (activeIndexSourceRef.current !== 'keyboard') return
    const container = listRef.current
    const item = itemRefs.current[activeIndex]
    if (!container || !item) return

    const containerRect = container.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    const nextScrollTop =
      container.scrollTop +
      (itemRect.top - containerRect.top) -
      containerRect.height / 2 +
      itemRect.height / 2
    const clampedScrollTop = Math.max(
      0,
      Math.min(nextScrollTop, container.scrollHeight - container.clientHeight)
    )
    container.scrollTo({ top: clampedScrollTop })
    activeIndexSourceRef.current = 'programmatic'
  }, [activeIndex, filteredItems.length, props.open])

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className='max-w-2xl p-0 overflow-hidden gap-0'
        onKeyDownCapture={handlePaletteKeyDown}
      >
        <DialogHeader className='px-4 py-3'>
          <DialogTitle className='text-sm'>{props.title}</DialogTitle>
          {props.description ? (
            <DialogDescription className='text-xs text-text-tertiary'>
              {props.description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <Input
          autoFocus
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={props.placeholder ?? 'Type a command…'}
        />
        <div ref={listRef} className='max-h-[420px] overflow-y-auto'>
          {filteredItems.length === 0 ? (
            <div className='px-4 py-8 text-sm text-text-secondary'>
              No matches.
            </div>
          ) : (
            filteredItems.map((item, index) => {
              const active = index === activeIndex
              return (
                <button
                  key={item.id}
                  type='button'
                  ref={node => {
                    itemRefs.current[index] = node
                  }}
                  aria-selected={active}
                  className={cn(
                    'w-full text-left px-4 py-3 border-b border-border/60 transition-colors',
                    active ? 'bg-surface-2' : 'hover:bg-surface-2'
                  )}
                  onMouseEnter={() => {
                    activeIndexSourceRef.current = 'pointer'
                    setActiveIndex(index)
                  }}
                  onClick={() => selectItem(item)}
                >
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0'>
                      <p className='text-sm text-text-primary truncate'>
                        {item.title}
                      </p>
                      {item.description ? (
                        <p className='text-xs text-text-secondary mt-0.5 line-clamp-2'>
                          {item.description}
                        </p>
                      ) : null}
                    </div>
                    {item.detail ? (
                      <span className='text-[11px] font-mono text-text-tertiary whitespace-nowrap'>
                        {item.detail}
                      </span>
                    ) : null}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
