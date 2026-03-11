import * as React from 'react'
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const toggleGroupVariants = cva(
  'inline-flex items-center rounded-md border border-border bg-surface-2',
  {
    variants: {
      size: {
        default: 'h-9',
        sm: 'h-8',
        lg: 'h-10'
      }
    },
    defaultVariants: {
      size: 'default'
    }
  }
)

const toggleGroupItemVariants = cva(
  'inline-flex items-center justify-center text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-surface-4 data-[state=on]:text-text-primary data-[state=off]:text-text-tertiary data-[state=off]:hover:text-text-secondary',
  {
    variants: {
      size: {
        default: 'h-9 px-3',
        sm: 'h-8 px-2.5 text-xs',
        lg: 'h-10 px-4'
      }
    },
    defaultVariants: {
      size: 'default'
    }
  }
)

type ToggleGroupContextValue = VariantProps<typeof toggleGroupItemVariants>

const ToggleGroupContext = React.createContext<ToggleGroupContextValue>({
  size: 'default'
})

export type ToggleGroupProps = React.ComponentProps<
  typeof ToggleGroupPrimitive.Root
> &
  VariantProps<typeof toggleGroupVariants>

export function ToggleGroup({
  className,
  size,
  children,
  ...props
}: ToggleGroupProps) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn(toggleGroupVariants({ size, className }))}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ size }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

export type ToggleGroupItemProps = React.ComponentProps<
  typeof ToggleGroupPrimitive.Item
> &
  VariantProps<typeof toggleGroupItemVariants>

export function ToggleGroupItem({
  className,
  size,
  ...props
}: ToggleGroupItemProps) {
  const context = React.useContext(ToggleGroupContext)
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        toggleGroupItemVariants({ size: size ?? context.size, className })
      )}
      {...props}
    />
  )
}
