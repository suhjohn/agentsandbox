import { forwardRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
Loader2,
Settings,
SidebarCloseIcon,
SidebarOpenIcon
} from 'lucide-react'

import { Button } from './ui/button'
import { Separator } from './ui/separator'
import { cn } from '@/lib/utils'
import type { Image } from '@/lib/api'

type ImagesSidebarProps = {
readonly collapsed: boolean
readonly onToggleCollapse: () => void
readonly widthPx: number
readonly images: readonly Image[]
readonly isLoadingImages: boolean
readonly selectedImageId: string | null
readonly onSelectImage: (imageId: string) => void
}

export const ImagesSidebar = forwardRef<HTMLElement, ImagesSidebarProps>(
function ImagesSidebar (
{
collapsed,
onToggleCollapse,
widthPx,
images,
isLoadingImages,
selectedImageId,
onSelectImage
},
ref
) {
const navigate = useNavigate()

if (collapsed) {
return (
<aside
ref={ref}
className='flex flex-col shrink-0 w-10 bg-[var(--color-sidebar)] text-[var(--color-sidebar-foreground)]'
>
<div className='flex items-center justify-center h-10'>
<Button
variant='icon'
size='icon'
className='h-8 w-8'
onClick={onToggleCollapse}
title='Expand sidebar'
>
<SidebarOpenIcon className='h-4 w-4' />
</Button>
</div>
<Separator />
<div className='flex-1' />
<Separator />
<div className='py-2'>
<Button
variant='icon'
size='icon'
className='h-8 w-8 mx-auto'
onClick={() => void navigate({ to: '/settings/general' })}
title='Settings'
>
<Settings className='h-4 w-4' />
</Button>
</div>
</aside>
)
}

return (
<aside
ref={ref}
className='border-y border-r flex flex-col shrink-0 bg-surface-1 rounded-tr-2xl rounded-br-2xl'
style={{ width: widthPx }}
>
	{/* Header */}
<div className='flex items-center justify-between gap-2 py-3 px-3'>
<span className='text-sm font-medium'>Agent</span>
<Button
variant='icon'
size='icon'
className='h-7 w-7 shrink-0'
onClick={onToggleCollapse}
title='Collapse sidebar'
>
<SidebarCloseIcon className='h-4 w-4' />
</Button>
</div>

	{/* Image list */}
<div className='flex-1 overflow-y-auto px-3'>
{isLoadingImages ? (
<div className='flex items-center gap-2 px-2 py-2 text-xs text-text-tertiary'>
<Loader2 className='h-3 w-3 animate-spin' />
<span>Loading…</span>
</div>
) : images.length === 0 ? (
<div className='px-2 py-2 text-xs text-text-tertiary'>
No images yet
</div>
) : (
<div className='flex flex-col gap-0.5'>
{images.map(img => (
<Button
key={img.id}
variant='ghost'
className={cn(
'w-full justify-start min-w-0 px-4 py-1.5 h-auto',
img.id === selectedImageId
? 'bg-[var(--color-sidebar-accent)] text-[var(--color-sidebar-foreground)]'
: ''
)}
                onClick={() => onSelectImage(img.id)}
                title={img.name}
              >
                <span className='min-w-0 truncate text-sm'>{img.name}</span>
              </Button>
            ))}
          </div>
)}
</div>
<div className='px-1 py-2'>
<Button
variant='ghost'
className='w-full justify-start gap-2 px-2 py-1.5 h-auto'
onClick={() => void navigate({ to: '/settings/general' })}
title='Settings'
>
<Settings className='h-4 w-4 shrink-0' />
<span className='text-sm'>Settings</span>
</Button>
</div>
</aside>
)
}
)
