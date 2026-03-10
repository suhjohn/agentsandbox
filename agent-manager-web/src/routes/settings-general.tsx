import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAuth } from '../lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { UserAvatar } from '@/components/user-avatar'
import { registerSettingsGeneralRuntimeController } from '@/coordinator-actions/runtime-bridge'
import {
  SettingsList,
  SettingsPage,
  SettingsPanel,
  SettingsSection,
  SettingsRow,
  SettingsRowLeft
} from '@/components/settings'

type RegionValue = string | readonly string[]

function regionToDisplay (value: RegionValue | undefined): string {
  if (!value) return 'us-west-2'
  if (typeof value === 'string') return value
  return value.join(', ')
}

function parseRegionInput (raw: string): RegionValue {
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown
    if (
      !Array.isArray(parsed) ||
      !parsed.every(v => typeof v === 'string' && v.trim().length > 0)
    ) {
      throw new Error('Region JSON must be an array of non-empty strings')
    }
    return parsed as readonly string[]
  }

  if (trimmed.includes(',')) {
    const parts = trimmed
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0)
    if (parts.length === 0) throw new Error('Region is required')
    return parts
  }

  if (trimmed.length === 0) throw new Error('Region is required')
  return trimmed
}

function normalizeRegion (value: RegionValue): string {
  if (typeof value === 'string') return value.trim()
  return value
    .map(v => v.trim())
    .filter(v => v.length > 0)
    .join(',')
}

function toErrorMessage (value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'object' && value !== null && 'error' in value) {
    const err = (value as { error?: unknown }).error
    if (typeof err === 'string' && err.trim().length > 0) return err
  }
  if (typeof value === 'string' && value.trim().length > 0) return value
  return 'Save failed'
}

function normalizeDiffignore (value: readonly string[]): readonly string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    const normalized = raw.trim().replaceAll('\\', '/')
    if (normalized.length === 0 || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function parseDiffignoreInput (raw: string): readonly string[] {
  return normalizeDiffignore(
    raw
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
  )
}

function formatDiffignoreInput (value: readonly string[]): string {
  return normalizeDiffignore(value).join('\n')
}

function parseGlobalDiffignoreResponse (value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null) return []
  const raw = (value as { diffignore?: unknown }).diffignore
  if (!Array.isArray(raw)) return []
  return normalizeDiffignore(
    raw.filter((item): item is string => typeof item === 'string')
  )
}

export function SettingsGeneralPage () {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  const currentName = auth.user?.name ?? ''
  const currentRegionDisplay = regionToDisplay(
    auth.user?.defaultRegion as RegionValue | undefined
  )

  const [name, setName] = useState(currentName)
  const [regionText, setRegionText] = useState(currentRegionDisplay)
  const [diffignoreText, setDiffignoreText] = useState('')
  const [didEditDiffignore, setDidEditDiffignore] = useState(false)

  const globalSettingsQuery = useQuery({
    queryKey: ['settings', 'global'],
    enabled: Boolean(auth.user),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await auth.fetchAuthed('/settings/global')
      const text = await res.text()
      const body = text.trim().length > 0 ? (JSON.parse(text) as unknown) : null
      if (!res.ok) throw new Error(toErrorMessage(body))
      return parseGlobalDiffignoreResponse(body)
    }
  })

  useEffect(() => {
    if (didEditDiffignore) return
    if (!globalSettingsQuery.data) return
    setDiffignoreText(formatDiffignoreInput(globalSettingsQuery.data))
  }, [didEditDiffignore, globalSettingsQuery.data])

  const desiredRegion = useMemo(() => {
    try {
      return parseRegionInput(regionText)
    } catch {
      return null
    }
  }, [regionText])

  const currentDiffignore = useMemo(
    () => normalizeDiffignore(globalSettingsQuery.data ?? []),
    [globalSettingsQuery.data]
  )
  const desiredDiffignore = useMemo(
    () => parseDiffignoreInput(diffignoreText),
    [diffignoreText]
  )

  const isUserDirty = useMemo(() => {
    if (!auth.user) return false
    if (name !== currentName) return true
    if (!desiredRegion) return false
    return (
      normalizeRegion(desiredRegion) !==
      normalizeRegion(parseRegionInput(currentRegionDisplay))
    )
  }, [auth.user, currentName, currentRegionDisplay, desiredRegion, name])

  const isGlobalDirty = useMemo(() => {
    return formatDiffignoreInput(desiredDiffignore) !== formatDiffignoreInput(currentDiffignore)
  }, [currentDiffignore, desiredDiffignore])

  const isDirty = isUserDirty || isGlobalDirty

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!auth.user) throw new Error('Not logged in')
      if (isUserDirty) {
        if (!desiredRegion) throw new Error('Invalid region')
        await auth.updateMe({ name, defaultRegion: desiredRegion })
      }
      if (isGlobalDirty) {
        const res = await auth.fetchAuthed('/settings/global', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ diffignore: desiredDiffignore })
        })
        const text = await res.text()
        const body = text.trim().length > 0 ? (JSON.parse(text) as unknown) : null
        if (!res.ok) throw new Error(toErrorMessage(body))
      }
    },
    onSuccess: async () => {
      toast.success('Saved')
      setDidEditDiffignore(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['images'] }),
        queryClient.invalidateQueries({ queryKey: ['settings', 'global'] })
      ])
    },
    onError: err => {
      const msg = err instanceof Error ? err.message : 'Save failed'
      toast.error(msg)
    }
  })

  const uploadAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      await auth.uploadAvatar(file)
    },
    onSuccess: () => {
      toast.success('Avatar updated')
    },
    onError: error => {
      toast.error(toErrorMessage(error))
    }
  })

  const resetAvatarMutation = useMutation({
    mutationFn: async () => {
      await auth.resetAvatar()
    },
    onSuccess: () => {
      toast.success('Avatar reset')
    },
    onError: error => {
      toast.error(toErrorMessage(error))
    }
  })

  let regionError: string | null = null
  try {
    parseRegionInput(regionText)
  } catch (e) {
    regionError = e instanceof Error ? e.message : 'Invalid region'
  }
  const canSave = isDirty && !regionError && !saveMutation.isPending

  useEffect(() => {
    return registerSettingsGeneralRuntimeController({
      getSnapshot: () => ({
        name,
        regionText,
        isDirty,
        canSave,
        regionError
      }),
      setName: async nextName => {
        setName(nextName)
        return {
          name: nextName,
          dirty: nextName !== name ? true : isDirty
        }
      },
      setDefaultRegion: async nextRegionText => {
        setRegionText(nextRegionText)
        return {
          regionText: nextRegionText,
          dirty: nextRegionText !== regionText ? true : isDirty
        }
      },
      save: async () => {
        if (!canSave) {
          throw new Error('General settings cannot be saved right now')
        }
        await saveMutation.mutateAsync()
        return { saved: true as const }
      }
    })
  }, [
    canSave,
    isDirty,
    name,
    regionError,
    regionText,
    saveMutation,
    setName,
    setRegionText
  ])

  return (
    <SettingsPage
      title='General'
      description='Manage user-level and global defaults.'
      action={
        <Button
          variant='secondary'
          disabled={!canSave}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
      }
    >
      <div className='space-y-4'>
        <SettingsSection
          title='User'
          description='Preferences for your user account.'
        >
          <SettingsPanel>
            <SettingsList className='rounded-none border-0'>
              <SettingsRow
                className='items-start flex-col sm:flex-row'
                left={
                  <SettingsRowLeft
                    title='Profile image'
                    description='Upload your own image or fall back to your initials.'
                    leading={
                      auth.user ? (
                        <UserAvatar
                          user={auth.user}
                          className='h-12 w-12'
                          textClassName='text-lg'
                        />
                      ) : null
                    }
                  />
                }
                right={
                  <div className='w-full sm:w-[420px] space-y-2'>
                    <input
                      ref={avatarInputRef}
                      type='file'
                      accept='image/png,image/jpeg,image/webp,image/gif,image/avif'
                      className='hidden'
                      onChange={async e => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (!file) return
                        await uploadAvatarMutation.mutateAsync(file)
                      }}
                    />
                    <div className='flex flex-wrap gap-2'>
                      <Button
                        type='button'
                        variant='secondary'
                        disabled={uploadAvatarMutation.isPending || resetAvatarMutation.isPending}
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        {uploadAvatarMutation.isPending ? 'Uploading...' : 'Upload image'}
                      </Button>
                      <Button
                        type='button'
                        variant='outline'
                        disabled={uploadAvatarMutation.isPending || resetAvatarMutation.isPending}
                        onClick={() => resetAvatarMutation.mutate()}
                      >
                        {resetAvatarMutation.isPending ? 'Resetting...' : 'Reset to default'}
                      </Button>
                    </div>
                    <div className='text-xs text-text-secondary'>
                      PNG, JPEG, WebP, GIF, or AVIF up to 5 MB.
                    </div>
                  </div>
                }
              />
              <SettingsRow
                className='items-start sm:items-center flex-col sm:flex-row'
                left={
                  <SettingsRowLeft
                    title='Display name'
                    description='Shown across the UI.'
                  />
                }
                right={
                  <Input
                    className='w-full sm:w-[420px]'
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                }
              />
              <SettingsRow
                className='items-start flex-col sm:flex-row'
                left={
                  <SettingsRowLeft
                    title='Default region'
                    description={
                      <>
                        Single region like{' '}
                        <span className='font-mono'>us-west-2</span>,
                        comma-separated, or a JSON array.
                      </>
                    }
                  />
                }
                right={
                  <div className='w-full sm:w-[420px] space-y-1.5'>
                    <Input
                      value={regionText}
                      onChange={e => setRegionText(e.target.value)}
                      placeholder={
                        'us-west-2 or us-west-2,us-east-1 or ["us-west-2","us-east-1"]'
                      }
                    />
                    {regionError ? (
                      <div className='text-xs text-destructive'>
                        {regionError}
                      </div>
                    ) : null}
                  </div>
                }
              />
            </SettingsList>
          </SettingsPanel>
        </SettingsSection>

        <SettingsSection
          title='Global'
          description='Shared defaults used across workspaces and users.'
        >
          <SettingsPanel>
            <SettingsList className='rounded-none border-0'>
              <SettingsRow
                className='items-start flex-col sm:flex-row'
                left={
                  <SettingsRowLeft
                    title='Diff ignore'
                    description={
                      <>
                        One glob pattern per line. Matching files are hidden by
                        default in workspace diff panels.
                      </>
                    }
                  />
                }
                right={
                  <div className='w-full sm:w-[420px] space-y-1.5'>
                    <Textarea
                      minRows={8}
                      value={diffignoreText}
                      onChange={e => {
                        setDidEditDiffignore(true)
                        setDiffignoreText(e.target.value)
                      }}
                      placeholder='**/package-lock.json'
                    />
                    {globalSettingsQuery.isLoading ? (
                      <div className='text-xs text-text-secondary'>
                        Loading global settings...
                      </div>
                    ) : null}
                    {globalSettingsQuery.isError ? (
                      <div className='text-xs text-destructive'>
                        {toErrorMessage(globalSettingsQuery.error)}
                      </div>
                    ) : null}
                  </div>
                }
              />
            </SettingsList>
          </SettingsPanel>
        </SettingsSection>
      </div>
    </SettingsPage>
  )
}
