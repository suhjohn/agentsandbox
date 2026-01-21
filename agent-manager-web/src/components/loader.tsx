import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  BRAILLE_GLYPH_VARIANTS,
  BrailleDepthGlyph,
  BrailleGlyph,
  type BrailleGlyphVariant
} from '@/workspace/ui/braille-glyph'

type LoaderProps = {
  readonly className?: string
  readonly label?: string
  readonly labelClassName?: string
  readonly variant?: BrailleGlyphVariant | 'cycle'
  readonly glyphClassName?: string
}

type SandboxLoaderProps = {
  readonly className?: string
  readonly label?: string
  readonly labelClassName?: string
  readonly glyphClassName?: string
}

function pickRandomVariant (): BrailleGlyphVariant {
  const randomIndex = Math.floor(Math.random() * BRAILLE_GLYPH_VARIANTS.length)
  return BRAILLE_GLYPH_VARIANTS[randomIndex]!
}

export function Loader ({
  className,
  label,
  labelClassName,
  variant,
  glyphClassName
}: LoaderProps) {
  const [randomVariant] = useState<BrailleGlyphVariant>(() => pickRandomVariant())
  const resolvedVariant = variant ?? randomVariant

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BrailleGlyph variant={resolvedVariant} className={glyphClassName} />
      {label ? (
        <span className={cn('text-sm text-text-tertiary', labelClassName)}>
          {label}
        </span>
      ) : null}
    </span>
  )
}

export function SandboxLoader ({
  className,
  label,
  labelClassName,
  glyphClassName
}: SandboxLoaderProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <BrailleDepthGlyph className={cn('h-6 w-6', glyphClassName)} />
      {label ? (
        <span className={cn('text-sm text-text-tertiary', labelClassName)}>
          {label}
        </span>
      ) : null}
    </span>
  )
}
