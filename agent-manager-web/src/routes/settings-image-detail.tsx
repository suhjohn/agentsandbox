import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ArrowUp,
  Copy,
  Loader2,
  Terminal,
  Key,
  Check,
  Star
} from 'lucide-react'

import { useAuth } from '../lib/auth'
import {
  useGetImagesImageId,
  useGetImagesImageIdEnvironmentSecrets,
  usePostImagesImageIdModalSecrets,
  usePutImagesImageIdEnvironmentSecrets,
  useGetImagesImageIdVariants,
  useGetImagesImageIdVariantsVariantIdBuilds,
  getGetImagesQueryKey,
  getGetImagesImageIdQueryKey,
  getGetImagesImageIdEnvironmentSecretsQueryKey,
  getGetImagesImageIdVariantsQueryKey,
  getGetImagesImageIdVariantsVariantIdBuildsQueryKey,
  type GetImagesImageId200,
  type GetImagesImageIdVariants200DataItem,
  type GetImagesImageIdVariantsVariantIdBuilds200DataItem,
  type GetImagesImageIdEnvironmentSecrets200DataItem,
  type GetImagesImageId200Visibility
} from '@/api/generated/agent-manager'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  VariantCombobox,
  type VariantOption
} from '@/components/ui/variant-combobox'
import {
  ImageIdCombobox,
  type ImageIdOption
} from '@/components/ui/image-id-combobox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { parseDotEnv } from '@/lib/dotenv'
import { TerminalPanel } from '@/components/terminal-panel'
import { requestTerminalConnect } from '@/lib/terminal-connect'
import {
  SettingsList,
  SettingsPage,
  SettingsPanel,
  SettingsPanelBody,
  SettingsSection,
  SettingsRow,
  SettingsRowLeft
} from '@/components/settings'
import { registerSettingsImageDetailRuntimeController } from '@/coordinator-actions/runtime-bridge'

type Image = GetImagesImageId200
type ImageVariant = GetImagesImageIdVariants200DataItem
type ImageVariantBuild = GetImagesImageIdVariantsVariantIdBuilds200DataItem
type EnvironmentSecretBinding = GetImagesImageIdEnvironmentSecrets200DataItem
type ImageVisibility = GetImagesImageId200Visibility
type VariantScope = 'shared' | 'personal'
type SetupTerminalConnection = {
  readonly wsUrl: string
  readonly authToken: string
}

const DEFAULT_VARIANT_IMAGE_ID = 'ghcr.io/suhjohn/agentsandbox:latest'

const IMAGE_AUTOSAVE_DEBOUNCE_MS = 1200
const AUTOSAVE_TOAST_ID = 'settings-image-detail-autosave'

type ImageDraft = {
  readonly name: string
  readonly description: string
  readonly visibility: ImageVisibility
}

function toDraft (image: Image): ImageDraft {
  return {
    name: image.name,
    description: image.description ?? '',
    visibility: image.visibility
  }
}

type ImagePatch = {
  readonly name?: string
  readonly description?: string
  readonly visibility?: ImageVisibility
}

function buildPatch (initial: ImageDraft, draft: ImageDraft): ImagePatch {
  const patch: Record<string, unknown> = {}
  if (draft.name.trim() !== initial.name) patch.name = draft.name.trim()
  if (draft.description !== initial.description)
    patch.description = draft.description
  if (draft.visibility !== initial.visibility)
    patch.visibility = draft.visibility

  return patch as ImagePatch
}

function unwrapImage (value: unknown): Image | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.id === 'string') return v as Image
  if (typeof v.data === 'object' && v.data !== null) {
    const d = v.data as Record<string, unknown>
    if (typeof d.id === 'string') return d as Image
  }
  return null
}

function parseSshPublicKeysDraft (value: string): readonly string[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

export function SettingsImageDetailPage () {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const params = useParams({ strict: false }) as { readonly imageId?: string }
  const imageId = params.imageId ?? ''

  const [initial, setInitial] = useState<ImageDraft | null>(null)
  const [draft, setDraft] = useState<ImageDraft | null>(null)
  const [buildLogs, setBuildLogs] = useState<
    Array<{
      readonly source: 'stdout' | 'stderr' | 'status' | 'error'
      readonly text: string
    }>
  >([])
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    null
  )
  const [setupSandboxId, setSetupSandboxId] = useState<string | null>(null)
  const closeRequestedSetupSandboxIdRef = useRef<string | null>(null)
  const [setupTerminalConnection, setSetupTerminalConnection] =
    useState<SetupTerminalConnection | null>(null)
  const setupTerminalReconnectInFlightRef = useRef(false)
  const [pendingDeleteVariant, setPendingDeleteVariant] = useState<{
    readonly variantId: string
    readonly label: string
  } | null>(null)
  const [showArchiveConfirmDialog, setShowArchiveConfirmDialog] =
    useState(false)
  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState(false)
  const [environmentModalSecretName, setEnvironmentModalSecretName] =
    useState('')
  const [environmentContents, setEnvironmentContents] = useState('')
  const [environmentDraftTouched, setEnvironmentDraftTouched] = useState(false)
  const [variantNameDraft, setVariantNameDraft] = useState('')
  const [extendMode, setExtendMode] = useState<'interactive' | 'api'>(
    'interactive'
  )
  const [sshPublicKeysDraft, setSshPublicKeysDraft] = useState('')
  const [setupAuthorizedPublicKeys, setSetupAuthorizedPublicKeys] = useState<
    readonly string[]
  >([])
  const [setupSshInfo, setSetupSshInfo] = useState<{
    readonly username: string
    readonly host: string
    readonly port: number
    readonly knownHostsLine: string
  } | null>(null)

  const imageQuery = useGetImagesImageId(imageId, {
    query: {
      enabled: !!auth.user && imageId.length > 0,
      refetchOnWindowFocus: false
    }
  })

  const image = useMemo(() => unwrapImage(imageQuery.data), [imageQuery.data])
  const isArchived = Boolean(image?.deletedAt)
  const canEdit = Boolean(auth.user && image && !isArchived)
  const canDeleteArchivedImage = Boolean(auth.user && image && isArchived)

  const environmentSecretsQuery = useGetImagesImageIdEnvironmentSecrets(
    imageId,
    {
      query: {
        enabled:
          !!auth.user &&
          imageId.length > 0 &&
          imageQuery.isSuccess &&
          !!image &&
          !isArchived,
        refetchOnWindowFocus: false,
        retry: false
      }
    }
  )
  const imageVariantsQuery = useGetImagesImageIdVariants(imageId, {
    query: {
      enabled:
        !!auth.user &&
        imageId.length > 0 &&
        imageQuery.isSuccess &&
        !!image &&
        !isArchived,
      refetchOnWindowFocus: false
    }
  })
  const variantBuildsQuery = useGetImagesImageIdVariantsVariantIdBuilds(
    imageId,
    selectedVariantId ?? '',
    { limit: 20 },
    {
      query: {
        enabled:
          !!auth.user &&
          imageId.length > 0 &&
          imageQuery.isSuccess &&
          !!image &&
          !isArchived &&
          !!selectedVariantId,
        refetchOnWindowFocus: false
      }
    }
  )
  const variantBuilds = useMemo(() => {
    const value = variantBuildsQuery.data?.data
    return Array.isArray(value) ? (value as readonly ImageVariantBuild[]) : []
  }, [variantBuildsQuery.data])

  const variants = useMemo(() => {
    const value = imageVariantsQuery.data?.data
    return Array.isArray(value) ? (value as readonly ImageVariant[]) : []
  }, [imageVariantsQuery.data])
  const visibleVariants = useMemo(() => {
    const userId = auth.user?.id
    if (!userId) return variants.filter(v => v.scope === 'shared')
    return variants.filter(
      v =>
        v.scope === 'shared' ||
        v.ownerUserId === userId ||
        image?.createdBy === userId
    )
  }, [auth.user?.id, image?.createdBy, variants])

  const variantOptions = useMemo((): readonly VariantOption[] => {
    return visibleVariants.map(v => ({
      id: v.id,
      name: v.name,
      scope: v.scope as VariantScope,
      ownerUserId: v.ownerUserId ?? null,
      isDefault: v.id === image?.defaultVariantId,
      isUserDefault: v.id === image?.userDefaultVariantId
    }))
  }, [visibleVariants, image?.defaultVariantId, image?.userDefaultVariantId])

  useEffect(() => {
    if (visibleVariants.length === 0) {
      setSelectedVariantId(null)
      return
    }
    if (
      selectedVariantId &&
      visibleVariants.some(v => v.id === selectedVariantId)
    ) {
      return
    }
    const preferredId =
      image?.effectiveDefaultVariantId ?? image?.defaultVariantId
    const preferred =
      preferredId && visibleVariants.some(v => v.id === preferredId)
        ? preferredId
        : visibleVariants[0]?.id ?? null
    setSelectedVariantId(preferred)
  }, [
    image?.defaultVariantId,
    image?.effectiveDefaultVariantId,
    selectedVariantId,
    visibleVariants
  ])

  const selectedVariant = useMemo(
    () => visibleVariants.find(v => v.id === selectedVariantId) ?? null,
    [selectedVariantId, visibleVariants]
  )
  const selectedVariantActiveImageId =
    typeof selectedVariant?.activeImageId === 'string' &&
    selectedVariant.activeImageId.trim().length > 0
      ? selectedVariant.activeImageId
      : undefined
  const selectedVariantDraftImageId =
    typeof selectedVariant?.draftImageId === 'string' &&
    selectedVariant.draftImageId.trim().length > 0
      ? selectedVariant.draftImageId
      : selectedVariantActiveImageId

  const imageIdOptions = useMemo((): readonly ImageIdOption[] => {
    const optionsById = new Map<
      string,
      { id: string; updatedAt: string; labels: string[] }
    >()
    const addOption = (input: {
      readonly id: string | null | undefined
      readonly updatedAt: string
      readonly label?: string
    }) => {
      const id = input.id?.trim() ?? ''
      if (!id) return
      const existing = optionsById.get(id)
      if (existing) {
        if (input.label && !existing.labels.includes(input.label)) {
          existing.labels.push(input.label)
        }
        return
      }
      optionsById.set(id, {
        id,
        updatedAt: input.updatedAt,
        labels: input.label ? [input.label] : []
      })
    }

    addOption({
      id: selectedVariant?.activeImageId,
      updatedAt: selectedVariant?.updatedAt ?? new Date().toISOString(),
      label: 'active'
    })
    addOption({
      id: selectedVariant?.draftImageId ?? selectedVariant?.activeImageId,
      updatedAt: selectedVariant?.updatedAt ?? new Date().toISOString(),
      label: 'draft'
    })
    addOption({
      id: DEFAULT_VARIANT_IMAGE_ID,
      updatedAt:
        image?.updatedAt ??
        selectedVariant?.updatedAt ??
        new Date().toISOString()
    })

    for (const build of variantBuilds) {
      if (build.status !== 'succeeded' || !build.outputImageId) continue
      addOption({
        id: build.outputImageId,
        updatedAt: build.startedAt
      })
    }

    return [...optionsById.values()]
  }, [
    image?.updatedAt,
    selectedVariant?.activeImageId,
    selectedVariant?.draftImageId,
    selectedVariant?.updatedAt,
    variantBuilds
  ])

  const isSelectedVariantUserDefault =
    selectedVariantId === image?.userDefaultVariantId
  const isSelectedVariantGlobalDefault =
    selectedVariantId === image?.defaultVariantId
  const isImageOwner = Boolean(
    auth.user && image && auth.user.id === image.createdBy
  )
  const isDraftAndActiveInSync = Boolean(
    selectedVariant &&
      selectedVariant.draftImageId &&
      selectedVariant.activeImageId &&
      selectedVariant.draftImageId === selectedVariant.activeImageId
  )

  const canMutateSelectedVariant = useMemo(() => {
    if (!auth.user || !image || !selectedVariant) return false
    if (auth.user.id === image.createdBy) return true
    if (selectedVariant.scope !== 'personal') return false
    return selectedVariant.ownerUserId === auth.user.id
  }, [auth.user, image, selectedVariant])

  const canPromoteDraft = Boolean(
    canMutateSelectedVariant &&
      selectedVariant?.draftImageId &&
      selectedVariant?.activeImageId &&
      selectedVariant.draftImageId !== selectedVariant.activeImageId
  )

  const variantMutabilityReason = useMemo((): string | null => {
    if (!auth.user) return 'Sign in to modify variants'
    if (!image) return 'Loading...'
    if (!selectedVariant) return 'Select a variant'
    if (canMutateSelectedVariant) return null
    if (selectedVariant.scope === 'shared') {
      return 'Only the image owner can modify shared variants'
    }
    return 'You can only modify your own personal variants'
  }, [auth.user, canMutateSelectedVariant, image, selectedVariant])

  const selectedVariantScope =
    (selectedVariant?.scope as VariantScope | undefined) ?? null
  const variantNameValidationError = useMemo((): string | null => {
    if (!selectedVariant) return null
    if (variantNameDraft.trim().length === 0) return 'Variant name is required.'
    return null
  }, [selectedVariant, variantNameDraft])
  const isVariantNameDirty = Boolean(
    selectedVariant && variantNameDraft.trim() !== selectedVariant.name
  )
  const canChangeSelectedVariantScope = Boolean(
    auth.user && image && auth.user.id === image.createdBy && selectedVariant
  )
  const variantScopeChangeReason = useMemo((): string | null => {
    if (!auth.user) return 'Sign in to change variant visibility'
    if (!image) return 'Loading...'
    if (!selectedVariant) return 'Select a variant'
    if (auth.user.id !== image.createdBy) {
      return 'Only the image owner can change personal/shared status'
    }
    return null
  }, [auth.user, image, selectedVariant])

  useEffect(() => {
    setVariantNameDraft(selectedVariant?.name ?? '')
  }, [selectedVariant?.id, selectedVariant?.name])

  const connectSetupSandboxTerminal = useCallback(
    async (sandboxId: string): Promise<SetupTerminalConnection> => {
      const accessToken = auth.accessToken?.trim() ?? ''
      if (accessToken.length === 0) throw new Error('Missing access token')
      const result = await requestTerminalConnect({
        baseUrl: auth.baseUrl,
        accessToken,
        targetType: 'setupSandbox',
        targetId: sandboxId
      })
      return { wsUrl: result.wsUrl, authToken: result.authToken }
    },
    [auth.accessToken, auth.baseUrl]
  )

  const environmentSecretBindings = useMemo(() => {
    const value = environmentSecretsQuery.data?.data
    return Array.isArray(value)
      ? (value as readonly EnvironmentSecretBinding[])
      : []
  }, [environmentSecretsQuery.data])
  const primaryEnvironmentSecret = environmentSecretBindings[0] ?? null

  useEffect(() => {
    setEnvironmentModalSecretName('')
    setEnvironmentContents('')
    setEnvironmentDraftTouched(false)
  }, [imageId])

  useEffect(() => {
    if (environmentDraftTouched) return
    setEnvironmentModalSecretName(
      primaryEnvironmentSecret?.modalSecretName ?? ''
    )
  }, [environmentDraftTouched, primaryEnvironmentSecret?.modalSecretName])

  const environmentContentsError = useMemo(() => {
    if (environmentContents.trim().length === 0) return null
    const parsed = parseDotEnv(environmentContents)
    return parsed.error
  }, [environmentContents])

  useEffect(() => {
    if (!image) return
    const next = toDraft(image)
    setInitial(next)
    setDraft(next)
  }, [image?.id])
  const buildOutput = useMemo(
    () => buildLogs.map(entry => entry.text).join(''),
    [buildLogs]
  )

  const nameValidationError = useMemo(() => {
    if (!draft) return null
    if (draft.name.trim().length === 0) return 'Name is required.'
    return null
  }, [draft?.name])

  const autosaveImageMutation = useMutation({
    mutationFn: async (patch: ImagePatch) =>
      auth.api.updateImage(imageId, patch),
    onMutate: () => {
      toast.loading('Autosaving…', { id: AUTOSAVE_TOAST_ID })
    },
    onSuccess: async (_, patch) => {
      setInitial(prev => {
        if (!prev) return prev
        return {
          ...prev,
          ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
          ...(Object.prototype.hasOwnProperty.call(patch, 'description')
            ? { description: patch.description ?? '' }
            : {}),
          ...(patch.visibility ? { visibility: patch.visibility } : {})
        }
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetImagesQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdQueryKey(imageId)
        })
      ])
      toast.success('Saved', { id: AUTOSAVE_TOAST_ID, duration: 1200 })
    },
    onError: err => {
      const msg = err instanceof Error ? err.message : 'Auto-save failed'
      toast.error(msg, { id: AUTOSAVE_TOAST_ID })
    }
  })

  const buildStreamMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVariantId) throw new Error('Select a variant first.')
      setBuildLogs([])

      const safeParse = (input: string): unknown => {
        try {
          return JSON.parse(input) as unknown
        } catch {
          return null
        }
      }

      const append = (entry: {
        readonly source: 'stdout' | 'stderr' | 'status' | 'error'
        readonly text: string
      }) => {
        if (entry.text.trim().length === 0) return
        setBuildLogs(prev => {
          const next = [...prev, entry]
          return next.length > 2000 ? next.slice(next.length - 2000) : next
        })
      }

      await auth.api.buildImageStream({
        imageId,
        variantId: selectedVariantId,
        onEvent: event => {
          const data = safeParse(event.data)
          if (event.event === 'log') {
            if (!data || typeof data !== 'object') return
            const source = (data as { source?: unknown }).source
            const text = (data as { text?: unknown }).text
            if (
              (source !== 'stdout' && source !== 'stderr') ||
              typeof text !== 'string'
            ) {
              return
            }
            append({ source, text })
            return
          }
          if (event.event === 'status') {
            if (!data || typeof data !== 'object') return
            const phase = (data as { phase?: unknown }).phase
            if (typeof phase !== 'string') return
            append({ source: 'status', text: `\n[${phase}]\n` })
            return
          }
          if (event.event === 'error') {
            if (!data || typeof data !== 'object') return
            const message = (data as { message?: unknown }).message
            if (typeof message !== 'string') return
            append({ source: 'error', text: `\n[error] ${message}\n` })
            toast.error(message)
            return
          }
          if (event.event === 'result') {
            if (!data || typeof data !== 'object') return
            void queryClient.invalidateQueries({
              queryKey: getGetImagesQueryKey()
            })
            void queryClient.invalidateQueries({
              queryKey: getGetImagesImageIdQueryKey(imageId)
            })
            void queryClient.invalidateQueries({
              queryKey: getGetImagesImageIdVariantsQueryKey(imageId)
            })
            void queryClient.invalidateQueries({
              queryKey: getGetImagesImageIdVariantsVariantIdBuildsQueryKey(
                imageId,
                selectedVariantId!,
                { limit: 20 }
              )
            })
            toast.success('Build complete')
          }
        }
      })
    },
    onError: err => {
      const msg = err instanceof Error ? err.message : 'Build failed'
      toast.error(msg)
      setBuildLogs(prev => [...prev, { source: 'error', text: `\n${msg}\n` }])
      void queryClient.invalidateQueries({
        queryKey: getGetImagesImageIdVariantsVariantIdBuildsQueryKey(
          imageId,
          selectedVariantId!,
          { limit: 20 }
        )
      })
    }
  })

  useEffect(() => {
    if (!canEdit || !draft || !initial) return
    if (autosaveImageMutation.isPending) return
    if (nameValidationError) return

    const patch = buildPatch(initial, draft)
    const metadataPatch: Record<string, unknown> = {}
    if (typeof patch.name === 'string') metadataPatch.name = patch.name
    if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
      metadataPatch.description = patch.description
    }
    if (patch.visibility) metadataPatch.visibility = patch.visibility
    if (Object.keys(metadataPatch).length === 0) return
    const typedMetadataPatch = metadataPatch as ImagePatch

    const timeout = window.setTimeout(() => {
      autosaveImageMutation.mutate(typedMetadataPatch)
    }, IMAGE_AUTOSAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timeout)
  }, [
    autosaveImageMutation.isPending,
    autosaveImageMutation.mutate,
    canEdit,
    draft?.description,
    draft?.name,
    draft?.visibility,
    initial?.description,
    initial?.name,
    initial?.visibility,
    nameValidationError
  ])

  const cloneMutation = useMutation({
    mutationFn: async () => auth.api.cloneImage(imageId),
    onSuccess: async cloned => {
      toast.success('Cloned')
      await queryClient.invalidateQueries({ queryKey: getGetImagesQueryKey() })
      await navigate({
        to: '/settings/images/$imageId',
        params: { imageId: cloned.id }
      })
    },
    onError: err => {
      const msg = err instanceof Error ? err.message : 'Clone failed'
      toast.error(msg)
    }
  })

  const upsertEnvironmentSecretBindingMutation =
    usePutImagesImageIdEnvironmentSecrets()
  const upsertEnvironmentSecretValuesMutation =
    usePostImagesImageIdModalSecrets()

  const saveEnvironmentSecretMutation = useMutation({
    mutationFn: async (input: {
      readonly modalSecretName: string
      readonly envText: string
      readonly initialModalSecretName: string | null
    }): Promise<{
      readonly didSaveBinding: boolean
      readonly didSaveValues: boolean
    }> => {
      const modalSecretName = input.modalSecretName.trim()
      if (modalSecretName.length === 0) {
        throw new Error('Modal secret name is required')
      }

      const shouldSaveBinding =
        !input.initialModalSecretName ||
        modalSecretName !== input.initialModalSecretName
      if (shouldSaveBinding) {
        await upsertEnvironmentSecretBindingMutation.mutateAsync({
          imageId,
          data: { modalSecretName }
        })
      }

      let env: Record<string, string> | null = null
      const envText = input.envText.trim()
      if (envText.length > 0) {
        const parsed = parseDotEnv(input.envText)
        if (parsed.error) throw new Error(parsed.error)
        env = parsed.env
      }

      if (env) {
        await upsertEnvironmentSecretValuesMutation.mutateAsync({
          imageId,
          data: {
            name: modalSecretName,
            env
          }
        })
      }

      return {
        didSaveBinding: shouldSaveBinding,
        didSaveValues: env !== null
      }
    },
    onSuccess: async data => {
      if (data.didSaveBinding || data.didSaveValues) {
        toast.success('Saved')
      }
      await queryClient.invalidateQueries({
        queryKey: getGetImagesImageIdEnvironmentSecretsQueryKey(imageId)
      })
      if (data.didSaveValues) {
        setEnvironmentContents('')
      }
      setEnvironmentDraftTouched(false)
    },
    onError: err => {
      const msg = err instanceof Error ? err.message : 'Save failed'
      toast.error(msg)
    }
  })

  const archiveMutation = useMutation({
    mutationFn: async () => auth.api.archiveImage(imageId),
    onSuccess: async () => {
      toast.success('Archived')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetImagesQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdQueryKey(imageId)
        }),
        queryClient.invalidateQueries({ queryKey: ['images'] })
      ])
    },
    onError: err => {
      const msg = err instanceof Error ? err.message : 'Archive failed'
      toast.error(msg)
    }
  })

  const unarchiveMutation = useMutation({
    mutationFn: async () => auth.api.unarchiveImage(imageId),
    onSuccess: async () => {
      toast.success('Unarchived')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetImagesQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdQueryKey(imageId)
        }),
        queryClient.invalidateQueries({ queryKey: ['images'] })
      ])
    },
    onError: err => {
      const msg = err instanceof Error ? err.message : 'Unarchive failed'
      toast.error(msg)
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async () => auth.api.deleteImage(imageId),
    onSuccess: async () => {
      toast.success('Deleted')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetImagesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: ['images'] })
      ])
      await navigate({ to: '/settings/images' })
    },
    onError: err => {
      const msg = err instanceof Error ? err.message : 'Delete failed'
      toast.error(msg)
    }
  })

  const createVariantMutation = useMutation({
    mutationFn: async () =>
      auth.api.createImageVariant(imageId, {
        ...(selectedVariantActiveImageId
          ? { activeImageId: selectedVariantActiveImageId }
          : {}),
        ...(selectedVariantDraftImageId
          ? { draftImageId: selectedVariantDraftImageId }
          : {})
      }),
    onSuccess: async created => {
      setSelectedVariantId(created.id)
      toast.success('Variant created')
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdVariantsQueryKey(imageId)
        }),
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdQueryKey(imageId)
        })
      ])
    },
    onError: err => {
      const msg = err instanceof Error ? err.message : 'Create variant failed'
      toast.error(msg)
    }
  })

  const updateVariantMutation = useMutation({
    mutationFn: async (input: {
      readonly scope?: VariantScope
      readonly name?: string
      readonly activeImageId?: string
      readonly draftImageId?: string
    }) => {
      if (!selectedVariantId) throw new Error('Select a variant first.')
      return auth.api.updateImageVariant(imageId, selectedVariantId, input)
    },
    onSuccess: async updated => {
      setVariantNameDraft(updated.name)
      toast.success('Variant updated')
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdVariantsQueryKey(imageId)
        }),
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdQueryKey(imageId)
        })
      ])
    },
    onError: err => {
      const msg = err instanceof Error ? err.message : 'Update variant failed'
      toast.error(msg)
    }
  })

  const promoteDraftMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVariantId) throw new Error('Select a variant first.')
      if (!selectedVariant?.draftImageId) {
        throw new Error('No draft image to promote.')
      }
      return auth.api.updateImageVariant(imageId, selectedVariantId, {
        activeImageId: selectedVariant.draftImageId
      })
    },
    onSuccess: async () => {
      toast.success('Draft promoted to active')
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdVariantsQueryKey(imageId)
        }),
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdQueryKey(imageId)
        })
      ])
    },
    onError: err => {
      const msg = err instanceof Error ? err.message : 'Promote failed'
      toast.error(msg)
    }
  })

  const deleteVariantMutation = useMutation({
    mutationFn: async (input: { readonly variantId: string }) =>
      auth.api.deleteImageVariant(imageId, input.variantId),
    onSuccess: async (_, input) => {
      toast.success('Variant deleted')
      setPendingDeleteVariant(prev =>
        prev?.variantId === input.variantId ? null : prev
      )
      setSelectedVariantId(prev => (prev === input.variantId ? null : prev))
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdVariantsQueryKey(imageId)
        }),
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdQueryKey(imageId)
        }),
        queryClient.invalidateQueries({ queryKey: getGetImagesQueryKey() })
      ])
    },
    onError: err => {
      const msg = err instanceof Error ? err.message : 'Delete variant failed'
      toast.error(msg)
    }
  })

  const setUserDefaultVariantMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVariantId) throw new Error('Select a variant first.')
      return auth.api.setUserImageDefaultVariant(imageId, selectedVariantId)
    },
    onSuccess: async () => {
      toast.success('Your default variant was updated')
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdQueryKey(imageId)
        }),
        queryClient.invalidateQueries({ queryKey: getGetImagesQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdVariantsQueryKey(imageId)
        })
      ])
    },
    onError: err => {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to set your default variant'
      toast.error(msg)
    }
  })

  const setImageDefaultVariantMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVariantId) throw new Error('Select a variant first.')
      return auth.api.setImageDefaultVariant(imageId, selectedVariantId)
    },
    onSuccess: async () => {
      toast.success('Image default variant updated')
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdQueryKey(imageId)
        }),
        queryClient.invalidateQueries({ queryKey: getGetImagesQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdVariantsQueryKey(imageId)
        })
      ])
    },
    onError: err => {
      const msg =
        err instanceof Error ? err.message : 'Failed to set image default'
      toast.error(msg)
    }
  })

  const clearUserDefaultVariantMutation = useMutation({
    mutationFn: async () => auth.api.clearUserImageDefaultVariant(imageId),
    onSuccess: async () => {
      toast.success('Cleared your default')
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdQueryKey(imageId)
        }),
        queryClient.invalidateQueries({ queryKey: getGetImagesQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdVariantsQueryKey(imageId)
        })
      ])
    },
    onError: err => {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to clear your default'
      toast.error(msg)
    }
  })

  const applySetupSandboxSshState = useCallback(
    (input: {
      readonly authorizedPublicKeys: readonly string[]
      readonly ssh: {
        readonly username: string
        readonly host: string
        readonly port: number
        readonly knownHostsLine: string
      } | null
    }) => {
      setSetupAuthorizedPublicKeys([...input.authorizedPublicKeys])
      if (input.ssh) {
        setSetupSshInfo({
          username: input.ssh.username,
          host: input.ssh.host,
          port: input.ssh.port,
          knownHostsLine: input.ssh.knownHostsLine
        })
      } else {
        setSetupSshInfo(null)
      }
    },
    []
  )

  const createSetupSandboxMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVariantId) throw new Error('Select a variant first.')
      return auth.api.createImageSetupSandbox({
        imageId,
        variantId: selectedVariantId
      })
    },
    onSuccess: async result => {
      setSetupSandboxId(result.sandboxId)
      applySetupSandboxSshState({
        authorizedPublicKeys: result.authorizedPublicKeys,
        ssh: result.ssh
      })
      try {
        const terminalConnection = await connectSetupSandboxTerminal(
          result.sandboxId
        )
        setSetupTerminalConnection(terminalConnection)
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Failed to initialize terminal connection'
        toast.error(msg)
        setSetupTerminalConnection(null)
      }
      toast.success('Setup sandbox ready')
    },
    onError: err => {
      const msg =
        err instanceof Error ? err.message : 'Failed to create setup sandbox'
      toast.error(msg)
    }
  })

  const upsertSetupSandboxSshMutation = useMutation({
    mutationFn: async () => {
      if (!setupSandboxId) throw new Error('Start a setup sandbox first.')
      const sshPublicKeys = parseSshPublicKeysDraft(sshPublicKeysDraft)
      if (sshPublicKeys.length === 0) {
        throw new Error('Enter at least one SSH public key.')
      }
      return auth.api.upsertImageSetupSandboxSsh({
        imageId,
        sandboxId: setupSandboxId,
        sshPublicKeys
      })
    },
    onSuccess: result => {
      applySetupSandboxSshState(result)
      setSshPublicKeysDraft('')
      toast.success(
        result.ssh ? 'SSH access updated' : 'SSH public keys updated'
      )
    },
    onError: err => {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to configure setup sandbox SSH'
      toast.error(msg)
    }
  })

  const closeSetupSandboxMutation = useMutation({
    mutationFn: async () => {
      if (!setupSandboxId) throw new Error('Start a setup sandbox first.')
      closeRequestedSetupSandboxIdRef.current = setupSandboxId
      return auth.api.closeImageSetupSandbox({
        imageId,
        sandboxId: setupSandboxId
      })
    },
    onSuccess: async () => {
      setSetupSandboxId(null)
      setSetupTerminalConnection(null)
      setSetupAuthorizedPublicKeys([])
      setSshPublicKeysDraft('')
      setSetupSshInfo(null)
      toast.success('Draft image updated')
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdQueryKey(imageId)
        }),
        queryClient.invalidateQueries({ queryKey: getGetImagesQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdVariantsQueryKey(imageId)
        }),
        queryClient.invalidateQueries({
          queryKey: getGetImagesImageIdVariantsVariantIdBuildsQueryKey(
            imageId,
            selectedVariantId ?? '',
            { limit: 20 }
          )
        })
      ])
    },
    onError: err => {
      closeRequestedSetupSandboxIdRef.current = null
      const msg =
        err instanceof Error ? err.message : 'Failed to close setup sandbox'
      toast.error(msg)
    }
  })

  const reconnectSetupSandboxTerminal = useCallback(() => {
    if (!setupSandboxId) return
    if (closeSetupSandboxMutation.isPending) return
    if (setupTerminalReconnectInFlightRef.current) return
    setupTerminalReconnectInFlightRef.current = true
    void connectSetupSandboxTerminal(setupSandboxId)
      .then(terminalConnection => {
        setSetupTerminalConnection(terminalConnection)
      })
      .catch(err => {
        const msg =
          err instanceof Error
            ? err.message
            : 'Failed to re-establish terminal connection'
        toast.error(msg)
        setSetupTerminalConnection(null)
      })
      .finally(() => {
        setupTerminalReconnectInFlightRef.current = false
      })
  }, [
    connectSetupSandboxTerminal,
    closeSetupSandboxMutation.isPending,
    setupSandboxId
  ])

  const onCopy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`Copied ${label}`)
    } catch {
      toast.error('Copy failed')
    }
  }, [])

  useEffect(() => {
    if (!setupSandboxId) {
      closeRequestedSetupSandboxIdRef.current = null
      setSetupTerminalConnection(null)
      return
    }
    if (setupTerminalConnection) return
    void connectSetupSandboxTerminal(setupSandboxId)
      .then(terminalConnection => {
        setSetupTerminalConnection(terminalConnection)
      })
      .catch(err => {
        const msg =
          err instanceof Error
            ? err.message
            : 'Failed to initialize terminal connection'
        toast.error(msg)
        setSetupTerminalConnection(null)
      })
  }, [
    connectSetupSandboxTerminal,
    setupSandboxId,
    setupTerminalConnection
  ])

  useEffect(() => {
    return () => {
      if (!setupSandboxId) return
      if (closeRequestedSetupSandboxIdRef.current === setupSandboxId) return
      void auth.api.closeImageSetupSandbox({
        imageId,
        sandboxId: setupSandboxId
      })
    }
  }, [auth.api, imageId, setupSandboxId])

  const isBusy =
    buildStreamMutation.isPending ||
    cloneMutation.isPending ||
    saveEnvironmentSecretMutation.isPending ||
    createVariantMutation.isPending ||
    updateVariantMutation.isPending ||
    promoteDraftMutation.isPending ||
    deleteVariantMutation.isPending ||
    setUserDefaultVariantMutation.isPending ||
    setImageDefaultVariantMutation.isPending ||
    clearUserDefaultVariantMutation.isPending ||
    createSetupSandboxMutation.isPending ||
    closeSetupSandboxMutation.isPending ||
    archiveMutation.isPending ||
    unarchiveMutation.isPending ||
    deleteMutation.isPending
  const hasDirtyDraft =
    initial && draft
      ? Object.keys(buildPatch(initial, draft)).length > 0
      : false

  useEffect(() => {
    return registerSettingsImageDetailRuntimeController({
      getSnapshot: () => ({
        imageId,
        imageLoaded: Boolean(image),
        canEdit,
        isArchived,
        isBusy,
        hasDirtyDraft,
        isBuildRunning: buildStreamMutation.isPending
      }),
      setName: async name => {
        if (!draft) throw new Error('Image detail draft is not ready')
        setDraft(prev => (prev ? { ...prev, name } : prev))
        return { name, dirty: true as const }
      },
      setDescription: async description => {
        if (!draft) throw new Error('Image detail draft is not ready')
        setDraft(prev => (prev ? { ...prev, description } : prev))
        return { description, dirty: true as const }
      },
      save: async () => {
        if (!initial || !draft) {
          throw new Error('Image detail draft is not ready')
        }
        if (nameValidationError) throw new Error(nameValidationError)
        const patch = buildPatch(initial, draft)
        if (Object.keys(patch).length === 0) {
          throw new Error('No image detail changes to save')
        }

        const metadataPatch: Record<string, unknown> = {}
        if (typeof patch.name === 'string') metadataPatch.name = patch.name
        if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
          metadataPatch.description = patch.description
        }
        if (patch.visibility) metadataPatch.visibility = patch.visibility

        if (Object.keys(metadataPatch).length > 0) {
          await autosaveImageMutation.mutateAsync(metadataPatch as ImagePatch)
        }
        return { saved: true as const }
      },
      revert: async () => {
        if (!initial) throw new Error('Image detail initial state is not ready')
        setDraft(initial)
        return { reverted: true as const, dirty: false as const }
      },
      clone: async () => {
        const cloned = await cloneMutation.mutateAsync()
        return {
          cloned: true as const,
          newImageId: cloned.id,
          navigated: true as const
        }
      },
      startBuild: async () => {
        if (!selectedVariantId) throw new Error('Select a variant first')
        if (buildStreamMutation.isPending)
          throw new Error('Build already running')
        buildStreamMutation.mutate()
        return { buildStarted: true as const }
      },
      stopBuild: async () => {
        throw new Error(
          'Stopping image builds from the settings UI is not supported'
        )
      },
      archive: async () => {
        await archiveMutation.mutateAsync()
        return {
          archived: true as const,
          routePath: globalThis.window.location.pathname
        }
      },
      delete: async () => {
        await deleteMutation.mutateAsync()
        return { deleted: true as const, redirectedTo: '/settings/images' }
      }
    })
  }, [
    archiveMutation,
    autosaveImageMutation,
    buildStreamMutation,
    canEdit,
    cloneMutation,
    deleteMutation,
    draft,
    hasDirtyDraft,
    image,
    imageId,
    initial,
    isArchived,
    isBusy,
    nameValidationError,
    selectedVariantId
  ])

  if (!auth.user) {
    return (
      <SettingsPage title='Image settings'>
        <SettingsPanel>
          <SettingsPanelBody className='space-y-3 text-sm text-text-secondary'>
            Log in to view and edit images.
            <div>
              <Link to='/login' className='underline'>
                Go to login
              </Link>
            </div>
          </SettingsPanelBody>
        </SettingsPanel>
      </SettingsPage>
    )
  }

  const draftValue = draft ?? null
  const selectedActiveImageId = selectedVariant?.activeImageId ?? null
  const selectedDraftImageId =
    selectedVariant?.draftImageId ?? selectedVariant?.activeImageId ?? null

  const pageTitle = (
    <div className='flex items-center gap-2 min-w-0'>
      <Button variant='ghost' size='icon' className='h-9 w-9' asChild>
        <Link to='/settings/images' title='Back to images'>
          <ArrowLeft className='h-4 w-4' />
        </Link>
      </Button>
      <div className='min-w-0'>
        <div className='text-xs text-text-tertiary'>Image</div>
        <div className='text-base font-semibold truncate'>
          {imageQuery.isLoading ? 'Loading...' : image?.name ?? imageId}
        </div>
      </div>
    </div>
  )

  const pageActions = (
    <div className='flex items-center gap-2 flex-wrap justify-end'>
      <Button
        variant='secondary'
        disabled={!image || isBusy || isArchived}
        onClick={() => cloneMutation.mutate()}
        title='Clone image'
      >
        {cloneMutation.isPending ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : null}
        Clone
      </Button>
    </div>
  )

  const archivedPageActions = (
    <div className='flex items-center gap-2 flex-wrap justify-end'>
      <Button
        variant='secondary'
        disabled={!canDeleteArchivedImage || isBusy}
        onClick={() => unarchiveMutation.mutate()}
      >
        {unarchiveMutation.isPending ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : null}
        Unarchive
      </Button>
      <Button
        variant='ghost'
        className='text-destructive'
        disabled={!canDeleteArchivedImage || isBusy}
        onClick={() => setShowDeleteConfirmDialog(true)}
      >
        Delete
      </Button>
    </div>
  )

  if (isArchived && image) {
    return (
      <SettingsPage title={pageTitle} action={archivedPageActions}>
        {imageQuery.isError ? (
          <div className='border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
            {imageQuery.error instanceof Error
              ? imageQuery.error.message
              : 'Failed to load image'}
          </div>
        ) : null}

        <div className='flex flex-col gap-4'>
          <SettingsSection
            title='Archived view'
            description='This image is archived. Unarchive to make it active again, or delete it permanently.'
          >
            <SettingsPanel>
              <SettingsPanelBody className='space-y-2 text-sm text-text-secondary'>
                <div>
                  <span className='text-text-tertiary'>Name: </span>
                  {image.name}
                </div>
                <div>
                  <span className='text-text-tertiary'>Image ID: </span>
                  <span className='font-mono'>{image.id}</span>
                </div>
                <div>
                  <span className='text-text-tertiary'>Archived at: </span>
                  {image.deletedAt ?? 'Unknown'}
                </div>
              </SettingsPanelBody>
            </SettingsPanel>
          </SettingsSection>
        </div>

        <Dialog
          open={showDeleteConfirmDialog}
          onOpenChange={setShowDeleteConfirmDialog}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete archived image</DialogTitle>
              <DialogDescription>
                Are you sure you want to permanently delete this archived image?
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => setShowDeleteConfirmDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={() => {
                  setShowDeleteConfirmDialog(false)
                  deleteMutation.mutate()
                }}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : null}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SettingsPage>
    )
  }

  return (
    <SettingsPage title={pageTitle} action={pageActions}>
      <Dialog
        open={showArchiveConfirmDialog}
        onOpenChange={setShowArchiveConfirmDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive image</DialogTitle>
            <DialogDescription>
              Are you sure you want to archive this image? It will be removed
              from active use but can be unarchived later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setShowArchiveConfirmDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => {
                setShowArchiveConfirmDialog(false)
                archiveMutation.mutate()
              }}
              disabled={archiveMutation.isPending}
            >
              {archiveMutation.isPending ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : null}
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {nameValidationError ? (
        <div className='border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
          {nameValidationError}
        </div>
      ) : null}

      {imageQuery.isError ? (
        <div className='border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
          {imageQuery.error instanceof Error
            ? imageQuery.error.message
            : 'Failed to load image'}
        </div>
      ) : null}

      <div className='flex flex-col gap-4'>
        {/* A. Overview */}
        <SettingsSection title='Overview'>
          <SettingsPanel>
            <SettingsList className='rounded-none border-0'>
              <SettingsRow
                disabled={!canEdit}
                className='items-start sm:items-center flex-col sm:flex-row'
                left={
                  <SettingsRowLeft
                    title='Name'
                    description='Human-friendly name shown in lists.'
                  />
                }
                right={
                  <div className='w-full sm:w-[420px]'>
                    {draftValue ? (
                      <Input
                        value={draftValue.name}
                        onChange={e =>
                          setDraft(prev =>
                            prev ? { ...prev, name: e.target.value } : prev
                          )
                        }
                        disabled={!canEdit || isBusy}
                      />
                    ) : (
                      <div className='border border-border bg-surface-2 px-3 py-2 text-text-secondary'>
                        -
                      </div>
                    )}
                  </div>
                }
              />
              <SettingsRow
                disabled={!canEdit}
                className='items-start flex-col sm:flex-row'
                left={
                  <SettingsRowLeft
                    title='Description'
                    description='Optional long-form description.'
                  />
                }
                right={
                  <div className='w-full sm:w-[420px]'>
                    {draftValue ? (
                      <Textarea
                        value={draftValue.description}
                        onChange={e =>
                          setDraft(prev =>
                            prev
                              ? { ...prev, description: e.target.value }
                              : prev
                          )
                        }
                        disabled={!canEdit || isBusy}
                        minRows={3}
                        maxRows={10}
                        placeholder='Add a description (optional)'
                      />
                    ) : (
                      <div className='border border-border bg-surface-2 px-3 py-2 text-text-secondary'>
                        -
                      </div>
                    )}
                  </div>
                }
              />
            </SettingsList>
          </SettingsPanel>
        </SettingsSection>

        <SettingsSection
          title='Secret environment'
          description='Set a Modal secret name and contents for full-stack environment variables.'
        >
          <SettingsPanel>
            <SettingsList className='rounded-none border-0'>
              <SettingsRow
                disabled={!canEdit || isBusy}
                className='items-start sm:items-center flex-col sm:flex-row'
                left={
                  <SettingsRowLeft
                    title='Modal secret name'
                    description='Name of the Modal secret loaded into the full environment.'
                  />
                }
                right={
                  <div className='w-full sm:w-[420px]'>
                    <Input
                      value={environmentModalSecretName}
                      onChange={e => {
                        setEnvironmentDraftTouched(true)
                        setEnvironmentModalSecretName(e.target.value)
                      }}
                      disabled={!canEdit || isBusy}
                      placeholder='modal-secret-name'
                    />
                  </div>
                }
              />

              <SettingsRow
                disabled={!canEdit || isBusy}
                className='items-start flex-col sm:flex-row'
                left={
                  <SettingsRowLeft
                    title='Contents'
                    description='Key-value pairs written to Modal. Clears after saving.'
                  />
                }
                right={
                  <div className='w-full sm:w-[420px]'>
                    <Textarea
                      value={environmentContents}
                      onChange={e => {
                        setEnvironmentDraftTouched(true)
                        setEnvironmentContents(e.target.value)
                      }}
                      disabled={!canEdit || isBusy}
                      minRows={6}
                      placeholder={`# Example\nDATABASE_URL=...\nREDIS_URL=...`}
                      aria-invalid={Boolean(environmentContentsError)}
                    />
                    {environmentContentsError ? (
                      <div className='text-xs text-destructive'>
                        {environmentContentsError}
                      </div>
                    ) : null}
                  </div>
                }
              />
            </SettingsList>
            <div className='flex items-center justify-end gap-2 flex-wrap px-4 py-3'>
              <Button
                type='button'
                variant='secondary'
                size='sm'
                disabled={
                  !canEdit ||
                  isBusy ||
                  environmentModalSecretName.trim().length === 0 ||
                  environmentContentsError !== null ||
                  (environmentContents.trim().length === 0 &&
                    environmentModalSecretName.trim() ===
                      (primaryEnvironmentSecret?.modalSecretName ?? ''))
                }
                onClick={() => {
                  void saveEnvironmentSecretMutation.mutateAsync({
                    modalSecretName: environmentModalSecretName,
                    envText: environmentContents,
                    initialModalSecretName:
                      primaryEnvironmentSecret?.modalSecretName ?? null
                  })
                }}
              >
                {saveEnvironmentSecretMutation.isPending ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : null}
                Save
              </Button>
            </div>
          </SettingsPanel>
        </SettingsSection>

        <SettingsSection
          title='Image Variants'
          description='Under the same image, you may want slightly different configurations that may require interactivity (e.g. perform Codex auth per user). Variants share the same setup / run script via a volume.'
        >
          <VariantCombobox
            className='min-w-48 max-w-64'
            value={selectedVariantId}
            onChange={setSelectedVariantId}
            variants={variantOptions}
            currentUserId={auth.user?.id ?? null}
            disabled={!canEdit || isBusy}
            onDelete={(variantId, variantName) => {
              setPendingDeleteVariant({ variantId, label: variantName })
            }}
            onCreate={() => createVariantMutation.mutate()}
            canCreate={canEdit && !isBusy}
            canDelete={variant => canEdit && !isBusy && !variant.isDefault}
          />
          <SettingsPanel>
            <Dialog
              open={pendingDeleteVariant !== null}
              onOpenChange={open => {
                if (open) return
                setPendingDeleteVariant(null)
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete image variant?</DialogTitle>
                  <DialogDescription>
                    This removes the variant{' '}
                    <span className='font-mono'>
                      {pendingDeleteVariant?.label ?? ''}
                    </span>
                    .
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    type='button'
                    variant='secondary'
                    disabled={isBusy}
                    onClick={() => setPendingDeleteVariant(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type='button'
                    variant='destructive'
                    disabled={!pendingDeleteVariant || isBusy}
                    onClick={() => {
                      if (!pendingDeleteVariant) return
                      deleteVariantMutation.mutate({
                        variantId: pendingDeleteVariant.variantId
                      })
                    }}
                  >
                    {deleteVariantMutation.isPending ? (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    ) : null}
                    Delete
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Variant Settings */}
            <div className='border-b border-border px-4 py-3'>
              <div className='flex items-center justify-between gap-4 flex-wrap'>
                <div className='flex items-center gap-3 min-w-0 flex-1'>
                  <div
                    className='min-w-0 flex-1 max-w-[240px]'
                    title={
                      !canMutateSelectedVariant
                        ? variantMutabilityReason ?? undefined
                        : undefined
                    }
                  >
                    <Input
                      value={variantNameDraft}
                      disabled={!canMutateSelectedVariant || isBusy}
                      onChange={event =>
                        setVariantNameDraft(event.target.value)
                      }
                      placeholder='Variant name'
                      aria-invalid={Boolean(variantNameValidationError)}
                      className='h-8 text-sm'
                    />
                  </div>
                  {isVariantNameDirty && !variantNameValidationError && (
                    <Button
                      variant='secondary'
                      size='sm'
                      disabled={!canMutateSelectedVariant || isBusy}
                      onClick={() => {
                        void updateVariantMutation.mutateAsync({
                          name: variantNameDraft.trim()
                        })
                      }}
                    >
                      Save
                    </Button>
                  )}
                  <ToggleGroup
                    type='single'
                    value={selectedVariantScope ?? undefined}
                    onValueChange={value => {
                      if (value) {
                        void updateVariantMutation.mutateAsync({
                          scope: value as VariantScope
                        })
                      }
                    }}
                    disabled={!canChangeSelectedVariantScope || isBusy}
                    size='sm'
                    title={
                      !canChangeSelectedVariantScope
                        ? variantScopeChangeReason ?? undefined
                        : undefined
                    }
                  >
                    <ToggleGroupItem value='personal'>Personal</ToggleGroupItem>
                    <ToggleGroupItem value='shared'>Shared</ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <div className='flex items-center gap-2'>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='gap-1.5'
                    disabled={isBusy || !selectedVariantId}
                    onClick={() => {
                      if (isSelectedVariantUserDefault) {
                        clearUserDefaultVariantMutation.mutate()
                      } else {
                        setUserDefaultVariantMutation.mutate()
                      }
                    }}
                    title={
                      isSelectedVariantUserDefault
                        ? 'Click to unpin (follow image default)'
                        : 'Click to pin as my default'
                    }
                  >
                    <Star
                      className={
                        isSelectedVariantUserDefault
                          ? 'h-3.5 w-3.5 text-blue-500 fill-blue-500'
                          : 'h-3.5 w-3.5 text-blue-500'
                      }
                    />
                    {isSelectedVariantUserDefault ? 'My default' : 'Set as my default'}
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='gap-1.5'
                    disabled={!isImageOwner || isBusy || !selectedVariantId || isSelectedVariantGlobalDefault}
                    onClick={() => setImageDefaultVariantMutation.mutate()}
                    title={
                      !isImageOwner
                        ? 'Only the image owner can set the image default'
                        : isSelectedVariantGlobalDefault
                          ? 'This is the image default'
                          : 'Set as image default'
                    }
                  >
                    <Star
                      className={
                        isSelectedVariantGlobalDefault
                          ? 'h-3.5 w-3.5 text-yellow-500 fill-yellow-500'
                          : 'h-3.5 w-3.5 text-yellow-500'
                      }
                    />
                    {isSelectedVariantGlobalDefault ? 'Image default' : 'Set as image default'}
                  </Button>
                  {selectedVariant?.id && (
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-7 w-7'
                      onClick={() =>
                        void onCopy(selectedVariant.id, 'variant id')
                      }
                      title={`Copy variant ID: ${selectedVariant.id}`}
                    >
                      <Copy className='h-3.5 w-3.5' />
                    </Button>
                  )}
                </div>
              </div>
              {variantNameValidationError && (
                <div className='mt-1 text-xs text-destructive'>
                  {variantNameValidationError}
                </div>
              )}
            </div>

            {/* Image Workflow */}
            <div className='border-b border-border px-4 py-4'>
              <div className='text-xs font-medium text-text-tertiary uppercase tracking-wide mb-3'>
                Image Workflow
              </div>
              <div className='flex flex-col sm:flex-row items-stretch sm:items-center gap-3'>
                {/* Draft */}
                <div className='flex-1 min-w-0'>
                  <div className='text-xs text-text-tertiary mb-1.5'>Draft</div>
                  <div
                    title={
                      !canMutateSelectedVariant
                        ? variantMutabilityReason ?? undefined
                        : undefined
                    }
                  >
                    <ImageIdCombobox
                      value={selectedDraftImageId}
                      options={imageIdOptions}
                      disabled={!canMutateSelectedVariant || isBusy}
                      placeholder='No draft image'
                      className='w-full'
                      onCopy={id => void onCopy(id, 'draft image id')}
                      onChange={value => {
                        void updateVariantMutation.mutateAsync({
                          draftImageId: value
                        })
                      }}
                    />
                  </div>
                </div>

                {/* Promote Button */}
                <div className='flex items-center justify-center sm:pt-5'>
                  {isDraftAndActiveInSync ? (
                    <div className='flex items-center gap-1.5 text-xs text-text-tertiary px-3 py-1.5 rounded bg-surface-2'>
                      <Check className='h-3.5 w-3.5' />
                      In sync
                    </div>
                  ) : (
                    <Button
                      variant='secondary'
                      size='sm'
                      disabled={!canPromoteDraft || isBusy}
                      onClick={() => promoteDraftMutation.mutate()}
                      title='Copy draft image ID to active'
                      className='gap-1.5'
                    >
                      {promoteDraftMutation.isPending ? (
                        <Loader2 className='h-3.5 w-3.5 animate-spin' />
                      ) : (
                        <ArrowUp className='h-3.5 w-3.5 rotate-90' />
                      )}
                      Promote
                    </Button>
                  )}
                </div>

                {/* Active */}
                <div className='flex-1 min-w-0'>
                  <div className='text-xs text-text-tertiary mb-1.5'>
                    Active{' '}
                    <span className='text-text-quaternary'>
                      (used by new sandboxes)
                    </span>
                  </div>
                  <div
                    title={
                      !canMutateSelectedVariant
                        ? variantMutabilityReason ?? undefined
                        : undefined
                    }
                  >
                    <ImageIdCombobox
                      value={selectedActiveImageId}
                      options={imageIdOptions}
                      disabled={!canMutateSelectedVariant || isBusy}
                      placeholder='No active image'
                      className='w-full'
                      onCopy={id => void onCopy(id, 'active image id')}
                      onChange={value => {
                        void updateVariantMutation.mutateAsync({
                          activeImageId: value
                        })
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Customize */}
            <div>
              <div className='px-4 py-3'>
                <div className='flex items-center justify-between'>
                  <div>
                    <div className='text-sm font-medium text-text-primary'>
                      Customize
                    </div>
                    <div className='text-xs text-text-tertiary'>
                      Open a terminal to edit the current draft image directly.
                      Closing snapshots the filesystem and updates the variant
                      draft image. New agent sandboxes continue to use the
                      active image.
                    </div>
                  </div>
                  {!setupSandboxId && (
                    <div className='inline-flex rounded-md border border-border bg-surface-2 p-1'>
                      <Button
                        type='button'
                        variant={extendMode === 'interactive' ? 'secondary' : 'ghost'}
                        size='sm'
                        className='h-8'
                        onClick={() => setExtendMode('interactive')}
                      >
                        <Terminal className='h-3.5 w-3.5 mr-1.5' />
                        Interactive
                      </Button>
                      <Button
                        type='button'
                        variant={extendMode === 'api' ? 'secondary' : 'ghost'}
                        size='sm'
                        className='h-8'
                        onClick={() => setExtendMode('api')}
                      >
                        API
                      </Button>
                    </div>
                  )}
                </div>

                {!setupSandboxId && extendMode === 'interactive' && (
                  <div className='mt-3 text-xs text-text-tertiary'>
                    Start one setup sandbox first. The browser terminal is
                    available immediately, and SSH public keys can be added
                    later if you need external access.
                  </div>
                )}

                {/* Action Buttons */}
                <div className='mt-3 flex items-center gap-2'>
                  {!setupSandboxId && extendMode !== 'api' ? (
                    <Button
                      variant='secondary'
                      disabled={!canEdit || isBusy || !selectedVariantId}
                      onClick={() => {
                        createSetupSandboxMutation.mutate()
                      }}
                    >
                      {createSetupSandboxMutation.isPending ? (
                        <Loader2 className='h-4 w-4 animate-spin' />
                      ) : null}
                      Activate Shell
                    </Button>
                  ) : setupSandboxId ? (
                    <Button
                      variant='secondary'
                      disabled={!canEdit || isBusy}
                      onClick={() => closeSetupSandboxMutation.mutate()}
                    >
                      {closeSetupSandboxMutation.isPending ? (
                        <Loader2 className='h-4 w-4 animate-spin' />
                      ) : null}
                      Close and Save
                    </Button>
                  ) : null}
                </div>

                {!setupSandboxId && extendMode === 'api' && (
                  <div className='mt-3 space-y-2 text-xs text-text-secondary'>
                    <div className='font-medium text-text-secondary'>
                      API reference for agents
                    </div>
                    <p>
                      <span className='font-mono text-text-primary'>
                        POST /images/:imageId/setup-sandbox
                      </span>{' '}
                      with{' '}
                      <span className='font-mono text-text-primary'>
                        {`{ variantId }`}
                      </span>
                    </p>
                    <p>
                      Add SSH keys later with{' '}
                      <span className='font-mono text-text-primary'>
                        {`POST /images/:imageId/setup-sandbox/:sandboxId/ssh`}
                      </span>{' '}
                      and{' '}
                      <span className='font-mono text-text-primary'>
                        {`{ sshPublicKeys[] }`}
                      </span>
                    </p>
                    <p>
                      Returns{' '}
                      <span className='font-mono text-text-primary'>
                        {`{ sandboxId, ssh, authorizedPublicKeys[] }`}
                      </span>
                    </p>
                    <p>
                      <span className='font-mono text-text-primary'>
                        DELETE /images/:imageId/setup-sandbox/:sandboxId
                      </span>{' '}
                      to close and persist changes.
                    </p>
                  </div>
                )}

                {setupSandboxId && (
                  <div className='mt-3 space-y-3'>
                    <div>
                      <div className='text-xs font-medium text-text-secondary'>
                        SSH Access
                      </div>
                      <div className='mt-1 text-xs text-text-tertiary'>
                        Browser terminal access is already live for this setup
                        sandbox. Add public keys only if you also want SSH/SCP.
                      </div>
                    </div>
                    <div className='rounded-md bg-surface-2 px-3 py-2'>
                      <div className='text-xs text-text-tertiary mb-1'>
                        Authorized public keys:
                      </div>
                      {setupAuthorizedPublicKeys.length > 0 ? (
                        <pre className='whitespace-pre-wrap break-all text-xs font-mono text-text-primary'>
                          {setupAuthorizedPublicKeys.join('\n')}
                        </pre>
                      ) : (
                        <div className='text-xs text-text-tertiary'>
                          No SSH public keys added yet.
                        </div>
                      )}
                    </div>
                    <div>
                      <label className='block text-xs font-medium text-text-secondary mb-1.5'>
                        Add SSH Public Keys
                      </label>
                      <Textarea
                        value={sshPublicKeysDraft}
                        onChange={e => setSshPublicKeysDraft(e.target.value)}
                        placeholder='ssh-ed25519 AAAA... one key per line'
                        className='font-mono text-xs h-24 resize-none'
                        disabled={!canEdit || isBusy}
                      />
                      <div className='mt-1 text-xs text-text-tertiary'>
                        Paste one key per line. New keys are merged with the
                        current authorized key list for this sandbox.
                      </div>
                    </div>
                    <div className='flex items-center gap-2'>
                      <Button
                        variant='secondary'
                        disabled={
                          !canEdit ||
                          isBusy ||
                          parseSshPublicKeysDraft(sshPublicKeysDraft).length === 0
                        }
                        onClick={() => upsertSetupSandboxSshMutation.mutate()}
                      >
                        {upsertSetupSandboxSshMutation.isPending ? (
                          <Loader2 className='h-4 w-4 animate-spin' />
                        ) : (
                          <Key className='h-4 w-4' />
                        )}
                        {setupSshInfo ? 'Add SSH Keys' : 'Enable SSH'}
                      </Button>
                    </div>
                  </div>
                )}

                {setupSandboxId && setupSshInfo && (
                  <div className='mt-3 space-y-2'>
                    <div className='text-xs font-medium text-text-secondary'>
                      SSH Connection
                    </div>
                    <div className='text-xs text-text-tertiary'>
                      If you generated a new key for this sandbox, plain{' '}
                      <code className='font-mono text-text-primary'>
                        ssh host
                      </code>{' '}
                      may fail unless that matching private key is already
                      loaded into your SSH agent. Use{' '}
                      <code className='font-mono text-text-primary'>
                        -i /path/to/private_key
                      </code>{' '}
                      or a matching SSH config entry.
                    </div>
                    <div className='rounded-md bg-surface-2 px-3 py-2'>
                      <div className='text-xs text-text-tertiary mb-1'>
                        Connect via SSH:
                      </div>
                      <div className='flex items-center gap-2'>
                        <code className='flex-1 text-xs font-mono text-text-primary break-all'>
                          ssh -p {setupSshInfo.port} {setupSshInfo.username}@
                          {setupSshInfo.host}
                        </code>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 shrink-0'
                          onClick={() =>
                            void onCopy(
                              `ssh -p ${setupSshInfo.port} ${setupSshInfo.username}@${setupSshInfo.host}`,
                              'SSH command'
                            )
                          }
                        >
                          <Copy className='h-3.5 w-3.5' />
                        </Button>
                      </div>
                    </div>
                    <div className='rounded-md bg-surface-2 px-3 py-2'>
                      <div className='text-xs text-text-tertiary mb-1'>
                        Copy files via SCP:
                      </div>
                      <div className='flex items-center gap-2'>
                        <code className='flex-1 text-xs font-mono text-text-primary break-all'>
                          scp -P {setupSshInfo.port} ./file{' '}
                          {setupSshInfo.username}@{setupSshInfo.host}
                          :/home/agent/
                        </code>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 shrink-0'
                          onClick={() =>
                            void onCopy(
                              `scp -P ${setupSshInfo.port} ./file ${setupSshInfo.username}@${setupSshInfo.host}:/home/agent/`,
                              'SCP command'
                            )
                          }
                        >
                          <Copy className='h-3.5 w-3.5' />
                        </Button>
                      </div>
                    </div>
                    <div className='rounded-md bg-surface-2 px-3 py-2'>
                      <div className='text-xs text-text-tertiary mb-1'>
                        Run a bash command:
                      </div>
                      <div className='flex items-center gap-2'>
                        <code className='flex-1 text-xs font-mono text-text-primary break-all'>
                          ssh -p {setupSshInfo.port} {setupSshInfo.username}@
                          {setupSshInfo.host} -- bash -lc 'ls -la /home/agent'
                        </code>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 shrink-0'
                          onClick={() =>
                            void onCopy(
                              `ssh -p ${setupSshInfo.port} ${setupSshInfo.username}@${setupSshInfo.host} -- bash -lc 'ls -la /home/agent'`,
                              'SSH bash command'
                            )
                          }
                        >
                          <Copy className='h-3.5 w-3.5' />
                        </Button>
                      </div>
                    </div>
                    <div className='rounded-md bg-surface-2 px-3 py-2'>
                      <div className='text-xs text-text-tertiary mb-1'>
                        Write a file via shell:
                      </div>
                      <div className='flex items-center gap-2'>
                        <code className='flex-1 text-xs font-mono text-text-primary break-all'>
                          ssh -p {setupSshInfo.port} {setupSshInfo.username}@
                          {setupSshInfo.host} -- bash -lc "cat &gt;
                          /shared/image-hooks/build.sh &lt;&lt;'EOF'
                          <br />
                          set -euo pipefail
                          <br />
                          echo hello
                          <br />
                          EOF"
                        </code>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 shrink-0'
                          onClick={() =>
                            void onCopy(
                              `ssh -p ${setupSshInfo.port} ${setupSshInfo.username}@${setupSshInfo.host} -- bash -lc "cat > /shared/image-hooks/build.sh <<'EOF'\nset -euo pipefail\necho hello\nEOF"`,
                              'SSH file write command'
                            )
                          }
                        >
                          <Copy className='h-3.5 w-3.5' />
                        </Button>
                      </div>
                    </div>
                    <div className='rounded-md bg-surface-2 px-3 py-2'>
                      <div className='text-xs text-text-tertiary mb-1'>
                        Known hosts line (add to ~/.ssh/known_hosts):
                      </div>
                      <div className='flex items-center gap-2'>
                        <code className='flex-1 text-xs font-mono text-text-primary break-all'>
                          {setupSshInfo.knownHostsLine}
                        </code>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 shrink-0'
                          onClick={() =>
                            void onCopy(
                              setupSshInfo.knownHostsLine,
                              'known hosts line'
                            )
                          }
                        >
                          <Copy className='h-3.5 w-3.5' />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Browser Terminal - shown when sandbox active in browser mode */}
              {setupSandboxId && setupTerminalConnection ? (
                <div className='p-2 h-[320px] w-full'>
                  <TerminalPanel
                    wsUrl={setupTerminalConnection.wsUrl}
                    wsAuthToken={setupTerminalConnection.authToken}
                    onConnectionLost={reconnectSetupSandboxTerminal}
                  />
                </div>
              ) : null}

              <div className='border-t border-border'>
                <SettingsRow
                  left={
                    <SettingsRowLeft
                      title='Shared volume'
                      descriptionClassName='line-clamp-none'
                      description={
                        <>
                          <code className='font-mono text-text-primary'>
                            /shared/image-hooks/build.sh
                          </code>{' '}
                          runs during image builds if present and is shared across
                          all variants of this image.{' '}
                          <code className='font-mono text-text-primary'>
                            /shared/image-hooks/start.sh
                          </code>{' '}
                          runs before agent-server starts in new agent sandboxes if
                          present.{' '}
                          <code className='font-mono text-text-primary'>
                            /shared
                          </code>{' '}
                          is a mounted Modal volume, so hook edits persist
                          immediately without waiting for a setup sandbox snapshot.
                        </>
                      }
                    />
                  }
                />
              </div>
            </div>
            {buildLogs.length > 0 ? (
              <div className='border-t border-border px-3 py-2'>
                <div className='flex items-center justify-between mb-2'>
                  <span className='text-xs text-text-tertiary'>
                    Build output
                  </span>
                </div>
                <pre className='max-h-[240px] overflow-auto whitespace-pre-wrap text-xs font-mono text-text-secondary'>
                  {buildOutput}
                </pre>
              </div>
            ) : null}
          </SettingsPanel>
        </SettingsSection>

        {/* E. Lifecycle */}
        <SettingsSection
          title='Lifecycle'
          description='Archive removes this image from active use. You can unarchive it later.'
        >
          <SettingsPanel>
            <SettingsList className='rounded-none border-0'>
              {!isArchived ? (
                <SettingsRow
                  disabled={!canEdit || !image || isBusy}
                  className='items-start sm:items-center flex-col sm:flex-row'
                  left={
                    <SettingsRowLeft
                      title='Archive image'
                      description='Archive this image and remove it from active use.'
                    />
                  }
                  right={
                    <Button
                      variant='ghost'
                      disabled={!canEdit || !image || isBusy}
                      onClick={() => setShowArchiveConfirmDialog(true)}
                    >
                      Archive
                    </Button>
                  }
                />
              ) : null}
            </SettingsList>
          </SettingsPanel>
        </SettingsSection>

        <Dialog
          open={showDeleteConfirmDialog}
          onOpenChange={setShowDeleteConfirmDialog}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete archived image</DialogTitle>
              <DialogDescription>
                Are you sure you want to permanently delete this archived image?
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => setShowDeleteConfirmDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={() => {
                  setShowDeleteConfirmDialog(false)
                  deleteMutation.mutate()
                }}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : null}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </SettingsPage>
  )
}
