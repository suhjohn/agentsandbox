import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

const GRID_COLS = 4
const GRID_ROWS = 4
const DOT_COUNT = GRID_COLS * GRID_ROWS
const FRAME_MS = 120
const FRAMES_PER_VARIANT = 24

const DOT_INDICES = Array.from({ length: DOT_COUNT }, (_, index) => index)

export const BRAILLE_GLYPH_VARIANTS = [
  'braille',
  'orbit',
  'breathe',
  'snake',
  'fillSweep',
  'pulse',
  'columns',
  'checkerboard',
  'scan',
  'rain',
  'cascade',
  'sparkle',
  'waveRows',
  'helix',
  'diagonalSwipe',
  'boxBounce'
] as const

export type BrailleGlyphVariant = (typeof BRAILLE_GLYPH_VARIANTS)[number]

type BrailleGlyphProps = {
  readonly variant?: BrailleGlyphVariant | 'cycle'
  readonly className?: string
}

type BrailleDepthGlyphProps = {
  readonly className?: string
}

const SNAKE_PATH = [
  dot(0, 0),
  dot(1, 0),
  dot(2, 0),
  dot(3, 0),
  dot(3, 1),
  dot(2, 1),
  dot(1, 1),
  dot(0, 1),
  dot(0, 2),
  dot(1, 2),
  dot(2, 2),
  dot(3, 2),
  dot(3, 3),
  dot(2, 3),
  dot(1, 3),
  dot(0, 3)
] as const

const ORBIT_PATH = [
  dot(1, 0),
  dot(2, 0),
  dot(3, 1),
  dot(3, 2),
  dot(2, 3),
  dot(1, 3),
  dot(0, 2),
  dot(0, 1)
] as const

const BOX_BOUNCE_PATH = [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
  [0, 2],
  [0, 1]
] as const

function dot (col: number, row: number): number {
  return row * GRID_COLS + col
}

function wrap (value: number, max: number): number {
  const normalized = value % max
  return normalized < 0 ? normalized + max : normalized
}

function dotsToSet (dots: readonly number[]): ReadonlySet<number> {
  return new Set(dots)
}

function buildBrailleFrame (frame: number): ReadonlySet<number> {
  const phase = frame % 6
  const leftCell = [dot(0, 0), dot(0, 1), dot(1, 0), dot(1, 1)]
  const rightCell = [dot(2, 2), dot(2, 3), dot(3, 2), dot(3, 3)]
  const bridge = [dot(1, 2), dot(2, 1)]
  if (phase <= 1) return dotsToSet(leftCell)
  if (phase <= 3) return dotsToSet([...leftCell, ...bridge])
  return dotsToSet([...rightCell, ...bridge])
}

function buildOrbitFrame (frame: number): ReadonlySet<number> {
  const head = ORBIT_PATH[wrap(frame, ORBIT_PATH.length)]!
  const opposite = ORBIT_PATH[wrap(frame + ORBIT_PATH.length / 2, ORBIT_PATH.length)]!
  const trail = ORBIT_PATH[wrap(frame - 1, ORBIT_PATH.length)]!
  return dotsToSet([head, opposite, trail])
}

function buildBreatheFrame (frame: number): ReadonlySet<number> {
  const phase = wrap(frame, 8)
  const radius = 0.5 + (phase <= 4 ? phase : 8 - phase) * 0.65
  const centerCol = (GRID_COLS - 1) / 2
  const centerRow = (GRID_ROWS - 1) / 2
  const active: number[] = []
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const manhattan = Math.abs(col - centerCol) + Math.abs(row - centerRow)
      if (manhattan <= radius) active.push(dot(col, row))
    }
  }
  return dotsToSet(active)
}

function buildSnakeFrame (frame: number): ReadonlySet<number> {
  const active: number[] = []
  const head = wrap(frame, SNAKE_PATH.length)
  for (let step = 0; step < 6; step += 1) {
    active.push(SNAKE_PATH[wrap(head - step, SNAKE_PATH.length)]!)
  }
  return dotsToSet(active)
}

function buildFillSweepFrame (frame: number): ReadonlySet<number> {
  const sweepFrames = GRID_COLS * 2
  const phase = wrap(frame, sweepFrames)
  const columns = phase < GRID_COLS ? phase + 1 : sweepFrames - phase
  const active: number[] = []
  for (let col = 0; col < columns; col += 1) {
    for (let row = 0; row < GRID_ROWS; row += 1) {
      active.push(dot(col, row))
    }
  }
  return dotsToSet(active)
}

function buildPulseFrame (frame: number): ReadonlySet<number> {
  const phase = wrap(frame, 6)
  const radius = phase <= 3 ? phase : 6 - phase
  if (radius >= 3) return dotsToSet(DOT_INDICES)
  const active = [dot(1, 1), dot(2, 1), dot(1, 2), dot(2, 2)]
  if (radius >= 1) {
    active.push(
      dot(1, 0),
      dot(2, 0),
      dot(0, 1),
      dot(3, 1),
      dot(0, 2),
      dot(3, 2),
      dot(1, 3),
      dot(2, 3)
    )
  }
  if (radius >= 2) {
    active.push(dot(0, 0), dot(3, 0), dot(0, 3), dot(3, 3))
  }
  return dotsToSet(active)
}

function buildColumnsFrame (frame: number): ReadonlySet<number> {
  const col = wrap(frame, GRID_COLS)
  const active: number[] = []
  for (let row = 0; row < GRID_ROWS; row += 1) {
    active.push(dot(col, row))
  }
  return dotsToSet(active)
}

function buildCheckerboardFrame (frame: number): ReadonlySet<number> {
  const parity = frame % 2
  const active: number[] = []
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      if ((row + col + parity) % 2 === 0) active.push(dot(col, row))
    }
  }
  return dotsToSet(active)
}

function buildScanFrame (frame: number): ReadonlySet<number> {
  const col = wrap(frame, GRID_COLS)
  const previousCol = wrap(col - 1, GRID_COLS)
  const active: number[] = []
  for (let row = 0; row < GRID_ROWS; row += 1) {
    active.push(dot(col, row))
  }
  active.push(dot(previousCol, frame % GRID_ROWS))
  return dotsToSet(active)
}

function buildRainFrame (frame: number): ReadonlySet<number> {
  const active: number[] = []
  for (let col = 0; col < GRID_COLS; col += 1) {
    const head = wrap(frame + col * 2, GRID_ROWS + 2) - 1
    if (head >= 0 && head < GRID_ROWS) active.push(dot(col, head))
    if (head - 1 >= 0 && head - 1 < GRID_ROWS) active.push(dot(col, head - 1))
  }
  return dotsToSet(active)
}

function buildCascadeFrame (frame: number): ReadonlySet<number> {
  const active: number[] = []
  for (let col = 0; col < GRID_COLS; col += 1) {
    const row = wrap(frame + col, GRID_ROWS + 1) - 1
    if (row >= 0 && row < GRID_ROWS) active.push(dot(col, row))
  }
  return dotsToSet(active)
}

function buildSparkleFrame (frame: number): ReadonlySet<number> {
  const active: number[] = []
  for (let index = 0; index < DOT_COUNT; index += 1) {
    const signal = (index * 17 + frame * 23 + 19) % 11
    if (signal === 0 || signal === 1) active.push(index)
  }
  if (active.length === 0) active.push(dot(frame % GRID_COLS, frame % GRID_ROWS))
  return dotsToSet(active)
}

function buildWaveRowsFrame (frame: number): ReadonlySet<number> {
  const active: number[] = []
  for (let row = 0; row < GRID_ROWS; row += 1) {
    const col = wrap(frame + row * 2, GRID_COLS)
    active.push(dot(col, row))
    active.push(dot(wrap(col - 1, GRID_COLS), row))
  }
  return dotsToSet(active)
}

function buildHelixFrame (frame: number): ReadonlySet<number> {
  const active: number[] = []
  for (let row = 0; row < GRID_ROWS; row += 1) {
    const left = wrap(frame + row, GRID_COLS)
    const right = wrap(GRID_COLS - 1 - frame + row, GRID_COLS)
    active.push(dot(left, row), dot(right, row))
  }
  active.push(dot(wrap(frame, GRID_COLS), 1), dot(wrap(frame + 2, GRID_COLS), 2))
  return dotsToSet(active)
}

function buildDiagonalSwipeFrame (frame: number): ReadonlySet<number> {
  const active: number[] = []
  const diagonal = wrap(frame, GRID_COLS + GRID_ROWS - 1)
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      if (col + row === diagonal || col + row === diagonal - 1) {
        active.push(dot(col, row))
      }
    }
  }
  return dotsToSet(active)
}

function buildBoxBounceFrame (frame: number): ReadonlySet<number> {
  const loopLength = BOX_BOUNCE_PATH.length * 2 - 2
  const loopStep = wrap(frame, loopLength)
  const step =
    loopStep < BOX_BOUNCE_PATH.length
      ? loopStep
      : loopLength - loopStep
  const [col, row] = BOX_BOUNCE_PATH[step]!
  return dotsToSet([
    dot(col, row),
    dot(col + 1, row),
    dot(col, row + 1),
    dot(col + 1, row + 1)
  ])
}

const VARIANT_BUILDERS: Record<
  BrailleGlyphVariant,
  (frame: number) => ReadonlySet<number>
> = {
  braille: buildBrailleFrame,
  orbit: buildOrbitFrame,
  breathe: buildBreatheFrame,
  snake: buildSnakeFrame,
  fillSweep: buildFillSweepFrame,
  pulse: buildPulseFrame,
  columns: buildColumnsFrame,
  checkerboard: buildCheckerboardFrame,
  scan: buildScanFrame,
  rain: buildRainFrame,
  cascade: buildCascadeFrame,
  sparkle: buildSparkleFrame,
  waveRows: buildWaveRowsFrame,
  helix: buildHelixFrame,
  diagonalSwipe: buildDiagonalSwipeFrame,
  boxBounce: buildBoxBounceFrame
}

export function BrailleGlyph ({
  variant = 'cycle',
  className
}: BrailleGlyphProps) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    if (prefersReducedMotion) return
    const interval = window.setInterval(() => {
      setTick(prev => prev + 1)
    }, FRAME_MS)
    return () => window.clearInterval(interval)
  }, [])

  const resolvedVariant: BrailleGlyphVariant =
    variant === 'cycle'
      ? BRAILLE_GLYPH_VARIANTS[
          Math.floor(tick / FRAMES_PER_VARIANT) %
            BRAILLE_GLYPH_VARIANTS.length
        ]!
      : variant

  const frame =
    variant === 'cycle'
      ? tick % FRAMES_PER_VARIANT
      : tick

  const activeDots = useMemo(
    () => VARIANT_BUILDERS[resolvedVariant](frame),
    [frame, resolvedVariant]
  )

  return (
    <span
      className={cn(
        'inline-grid h-4 w-4 place-items-center gap-[2px]',
        className
      )}
      style={{
        gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${GRID_ROWS}, minmax(0, 1fr))`
      }}
      aria-hidden='true'
    >
      {DOT_INDICES.map(index => (
        <span
          key={index}
          className={cn(
            'h-1 w-1 rounded-full transition-opacity duration-150 ease-linear',
            activeDots.has(index)
              ? 'bg-text-secondary opacity-100'
              : 'bg-text-quaternary opacity-20'
          )}
        />
      ))}
    </span>
  )
}

type Point3D = { x: number; y: number; z: number }
type Point2D = { x: number; y: number }

const CUBE_VERTICES: Point3D[] = [
  { x: -1, y: -1, z: -1 },
  { x: 1, y: -1, z: -1 },
  { x: 1, y: 1, z: -1 },
  { x: -1, y: 1, z: -1 },
  { x: -1, y: -1, z: 1 },
  { x: 1, y: -1, z: 1 },
  { x: 1, y: 1, z: 1 },
  { x: -1, y: 1, z: 1 }
]

const CUBE_FACES: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 2, 3], // back
  [5, 4, 7, 6], // front
  [4, 0, 3, 7], // left
  [1, 5, 6, 2], // right
  [4, 5, 1, 0], // top
  [3, 2, 6, 7] // bottom
]

function rotateY (point: Point3D, angle: number): Point3D {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: point.x * cos - point.z * sin,
    y: point.y,
    z: point.x * sin + point.z * cos
  }
}

function rotateX (point: Point3D, angle: number): Point3D {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: point.x,
    y: point.y * cos - point.z * sin,
    z: point.y * sin + point.z * cos
  }
}

function project (point: Point3D, scale: number, offsetX: number, offsetY: number): Point2D {
  const perspective = 3
  const z = point.z + perspective
  const factor = perspective / z
  return {
    x: point.x * factor * scale + offsetX,
    y: point.y * factor * scale + offsetY
  }
}

function getFaceCenter (vertices: Point3D[], face: readonly number[]): number {
  let sum = 0
  for (const idx of face) {
    sum += vertices[idx]!.z
  }
  return sum / face.length
}

function pointsToPath (points: Point2D[]): string {
  if (points.length === 0) return ''
  const [first, ...rest] = points
  return `M ${first!.x.toFixed(2)} ${first!.y.toFixed(2)} ${rest.map(p => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')} Z`
}

function rotateZ (point: Point3D, angle: number): Point3D {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
    z: point.z
  }
}

export function SpinningCube ({ className }: BrailleDepthGlyphProps) {
  const [time, setTime] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    if (prefersReducedMotion) return

    let animationId: number
    let lastTime = performance.now()

    const animate = (currentTime: number) => {
      const delta = currentTime - lastTime
      lastTime = currentTime
      setTime(prev => prev + delta)
      animationId = requestAnimationFrame(animate)
    }

    animationId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationId)
  }, [])

  const { faces, projected } = useMemo(() => {
    const t = time * 0.001

    const rotX = t * 0.7
    const rotY = t * 1.1
    const rotZ = t * 0.5

    const rotated = CUBE_VERTICES.map(v => {
      let p = v
      p = rotateX(p, rotX)
      p = rotateY(p, rotY)
      p = rotateZ(p, rotZ)
      return p
    })

    const proj = rotated.map(v => project(v, 5, 14, 14))

    const facesWithDepth = CUBE_FACES.map((face, idx) => ({
      face,
      idx,
      depth: getFaceCenter(rotated, face)
    }))
    facesWithDepth.sort((a, b) => a.depth - b.depth)

    return { faces: facesWithDepth, projected: proj }
  }, [time])

  const faceColors = [
    'rgba(255,255,255,0.08)',
    'rgba(255,255,255,0.95)',
    'rgba(255,255,255,0.25)',
    'rgba(255,255,255,0.45)',
    'rgba(255,255,255,0.65)',
    'rgba(255,255,255,0.15)'
  ]

  return (
    <svg
      className={cn('h-7 w-7', className)}
      viewBox='0 0 28 28'
      aria-hidden='true'
    >
      {faces.map(({ face, idx }) => {
        const points = face.map(i => projected[i]!)
        return (
          <path
            key={idx}
            d={pointsToPath(points)}
            fill={faceColors[idx]}
            stroke='rgba(255,255,255,0.4)'
            strokeWidth={0.5}
            strokeLinejoin='round'
          />
        )
      })}
    </svg>
  )
}

export function BrailleDepthGlyph ({ className }: BrailleDepthGlyphProps) {
  const [direction] = useState(() => (Math.random() > 0.5 ? 1 : -1))

  return (
    <img
      src='/src/assets/cube-rotating.svg'
      alt=''
      className={cn('animate-spin', className)}
      style={{
        animationDuration: '3s',
        animationDirection: direction === 1 ? 'normal' : 'reverse'
      }}
      aria-hidden='true'
    />
  )
}
