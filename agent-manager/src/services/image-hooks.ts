import { createHash } from 'node:crypto'
import { ModalClient, type Volume } from 'modal'
import { ModalVolumeClient } from '@/clients/modal'

const modalClient = new ModalClient()

export const IMAGE_HOOKS_MOUNT_PATH = '/shared/image-hooks'
export const IMAGE_HOOKS_ENV_VAR = 'IMAGE_HOOKS_DIR'
export const IMAGE_BUILD_HOOK_PATH = `${IMAGE_HOOKS_MOUNT_PATH}/build.sh`
export const IMAGE_START_HOOK_PATH = `${IMAGE_HOOKS_MOUNT_PATH}/start.sh`

const IMAGE_HOOK_REMOTE_FILES = ['/build.sh', '/start.sh'] as const

export function getImageHooksVolumeName (imageId: string): string {
  const normalized = imageId.trim().replace(/-/g, '').toLowerCase()
  if (normalized.length === 0) {
    throw new Error('Image id is required for shared image hook volume')
  }
  return `image-hooks-${normalized}`
}

export async function getImageHooksVolume (input: {
  readonly imageId: string
  readonly readOnly?: boolean
}): Promise<Volume> {
  const volume = await modalClient.volumes.fromName(
    getImageHooksVolumeName(input.imageId),
    { createIfMissing: true }
  )
  return input.readOnly ? volume.readOnly() : volume
}

export async function getImageBuildHookDigest (
  imageId: string
): Promise<string | null> {
  const client = new ModalVolumeClient({
    volumeName: getImageHooksVolumeName(imageId)
  })
  const remotePath = '/build.sh'
  if (!(await client.exists({ remotePath }))) return null
  const bytes = await client.getBytes({ remotePath })
  return createHash('sha256').update(bytes).digest('hex')
}

export async function copyImageHookFiles (input: {
  readonly sourceImageId: string
  readonly targetImageId: string
}): Promise<void> {
  const source = new ModalVolumeClient({
    volumeName: getImageHooksVolumeName(input.sourceImageId)
  })
  const target = new ModalVolumeClient({
    volumeName: getImageHooksVolumeName(input.targetImageId)
  })

  for (const remotePath of IMAGE_HOOK_REMOTE_FILES) {
    if (!(await source.exists({ remotePath }))) continue
    const bytes = await source.getBytes({ remotePath })
    await target.putBytes({
      data: bytes,
      remotePath,
      overwrite: true
    })
  }
}

export async function deleteImageHookVolume (imageId: string): Promise<void> {
  try {
    await modalClient.volumes.delete(getImageHooksVolumeName(imageId))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (
      message.includes('not found') ||
      message.includes('404') ||
      message.includes('does not exist')
    ) {
      return
    }
    throw err
  }
}
