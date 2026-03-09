import { Circle, Loader2 } from 'lucide-react'

type StatusIndicatorProps = {
  readonly status?: string
}

export function StatusIndicator (props: StatusIndicatorProps) {
  const circleSize = 8
  let icon: React.ReactNode

  if (
    props.status === 'pending' ||
    props.status === 'started' ||
    props.status === 'updated'
  ) {
    icon = (
      <Loader2
        size={10}
        className='text-text-tertiary animate-spin'
      />
    )
  } else if (props.status === 'completed') {
    icon = (
      <Circle
        size={circleSize}
        className='text-green-500 fill-green-500'
      />
    )
  } else if (props.status === 'failed') {
    icon = (
      <Circle size={circleSize} className='text-red-500 fill-red-500' />
    )
  } else if (props.status === undefined) {
    icon = (
      <Circle
        size={circleSize}
        className='text-text-primary fill-text-primary'
      />
    )
  } else {
    icon = (
      <Circle
        size={circleSize}
        className='text-text-tertiary fill-text-tertiary'
      />
    )
  }

  return (
    <div className='flex-shrink-0 w-3 h-3 flex items-center justify-center'>
      {icon}
    </div>
  )
}
