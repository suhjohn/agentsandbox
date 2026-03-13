import { createHash } from 'node:crypto'
import { ModalClient, type Volume } from 'modal'
import { ModalVolumeClient } from '@/clients/modal'

const modalClient = new ModalClient()

export const IMAGE_SHARED_MOUNT_PATH = '/shared/image'
export const IMAGE_SHARED_ENV_VAR = 'IMAGE_SHARED_DIR'
export const IMAGE_HOOKS_DIR = `${IMAGE_SHARED_MOUNT_PATH}/hooks`
export const IMAGE_BUILD_HOOK_PATH = `${IMAGE_HOOKS_DIR}/build.sh`
export const IMAGE_START_HOOK_PATH = `${IMAGE_HOOKS_DIR}/start.sh`

const IMAGE_SHARED_REMOTE_FILES = [
  '/hooks/build.sh',
  '/hooks/start.sh'
] as const

export function getImageSharedVolumeName (imageId: string): string {
  const normalized = imageId.trim().replace(/-/g, '').toLowerCase()
  if (normalized.length === 0) {
    throw new Error('Image id is required for shared image volume')
  }
  return `image-shared-${normalized}`
}

export async function getImageSharedVolume (input: {
  readonly imageId: string
  readonly readOnly?: boolean
}): Promise<Volume> {
  const volume = await modalClient.volumes.fromName(
    getImageSharedVolumeName(input.imageId),
    { createIfMissing: true }
  )
  return input.readOnly ? volume.readOnly() : volume
}

export async function getImageBuildHookDigest (
  imageId: string
): Promise<string | null> {
  const client = new ModalVolumeClient({
    volumeName: getImageSharedVolumeName(imageId),
    ensureExists: false
  })
  const remotePath = '/hooks/build.sh'
  if (!(await client.exists({ remotePath }))) return null
  const bytes = await client.getBytes({ remotePath })
  return createHash('sha256').update(bytes).digest('hex')
}

export async function copyImageSharedFiles (input: {
  readonly sourceImageId: string
  readonly targetImageId: string
}): Promise<void> {
  const source = new ModalVolumeClient({
    volumeName: getImageSharedVolumeName(input.sourceImageId),
    ensureExists: false
  })
  const target = new ModalVolumeClient({
    volumeName: getImageSharedVolumeName(input.targetImageId)
  })

  for (const remotePath of IMAGE_SHARED_REMOTE_FILES) {
    if (!(await source.exists({ remotePath }))) continue
    const bytes = await source.getBytes({ remotePath })
    await target.putBytes({
      data: bytes,
      remotePath,
      overwrite: true
    })
  }
}

export async function deleteImageSharedVolume (imageId: string): Promise<void> {
  try {
    await modalClient.volumes.delete(getImageSharedVolumeName(imageId))
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
