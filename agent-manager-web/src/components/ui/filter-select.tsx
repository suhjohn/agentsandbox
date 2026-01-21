import * as React from 'react'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

import { Button } from './button'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

export type FilterSelectOption<TValue extends string> = {
readonly value: TValue
readonly label: string
readonly disabled?: boolean
}

export type FilterSelectProps<TValue extends string> = {
readonly label: string
readonly value: TValue
readonly options: readonly FilterSelectOption<TValue>[]
readonly onChange: (value: TValue) => void
readonly mode?: 'pill' | 'icon'
readonly icon?: React.ReactNode
readonly showValueInTrigger?: boolean
readonly className?: string
readonly isActive?: boolean
}

export function FilterSelect<TValue extends string> ({
label,
value,
options,
onChange,
mode = 'pill',
icon,
showValueInTrigger = true,
className,
isActive: isActiveProp
}: FilterSelectProps<TValue>) {
const [open, setOpen] = React.useState(false)
const selected = options.find(o => o.value === value)
const title = `${label}: ${selected?.label ?? value}`
const isActive = isActiveProp ?? (options.length > 0 && value !== options[0]?.value)

return (
<Popover open={open} onOpenChange={setOpen}>
<PopoverTrigger asChild>
{mode === 'icon' ? (
<Button
type='button'
variant='icon'
size='icon'
className={cn(
'h-7 w-7',
isActive ? 'bg-accent/15 text-accent' : open ? 'bg-surface-2 text-text-primary' : '',
className
)}
aria-label={title}
title={title}
>
{icon ?? <ChevronDown className='h-3.5 w-3.5' />}
</Button>
) : (
<Button
type='button'
variant='secondary'
size='sm'
className={cn(
'h-7 rounded-full px-2.5 text-xs font-medium text-text-secondary',
className
)}
aria-label={title}
title={title}
>
<span className='text-text-secondary'>{label}</span>
{showValueInTrigger ? (
<>
<span className='text-text-tertiary'>:</span>
<span className='truncate text-text-secondary'>
{selected?.label ?? value}
</span>
</>
) : null}
<ChevronDown className='h-3.5 w-3.5 text-text-tertiary' />
</Button>
)}
</PopoverTrigger>

<PopoverContent
align='start'
sideOffset={6}
className='w-56 p-1 bg-[var(--color-popover)]'
>
<div className='flex flex-col'>
{options.map(option => {
const isSelected = option.value === value
return (
<Button
key={option.value}
type='button'
variant='ghost'
className={cn(
'h-8 w-full justify-between px-2 text-xs',
isSelected
? 'bg-surface-2 text-text-primary'
: 'text-text-secondary'
)}
disabled={option.disabled}
onClick={() => {
onChange(option.value)
setOpen(false)
}}
>
<span className='truncate'>{option.label}</span>
{isSelected ? (
<Check className='h-3.5 w-3.5 text-text-tertiary' />
) : (
<span className='h-3.5 w-3.5' />
)}
</Button>
)
})}
</div>
</PopoverContent>
</Popover>
)
}
