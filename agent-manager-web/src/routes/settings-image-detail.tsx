import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, Copy, Loader2, Bot } from 'lucide-react'

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
import Editor from '@monaco-editor/react'
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
import {
  getChatRuntimeController,
  getDialogRuntimeController,
  registerSettingsImageDetailRuntimeController
} from '@/coordinator-actions/runtime-bridge'

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

const SETUP_SCRIPT_AUTOSAVE_DEBOUNCE_MS = 1200
const OPEN_COORDINATOR_EVENT = 'agent-manager-web:open-coordinator'
const AUTOSAVE_TOAST_ID = 'settings-image-detail-autosave'

async function waitForDialogChatController (
  timeoutMs: number
): Promise<ReturnType<typeof getChatRuntimeController>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const controller = getChatRuntimeController('dialog')
    if (controller) return controller
    await new Promise<void>(resolve => {
      globalThis.window.setTimeout(resolve, 50)
    })
  }
  return null
}

function buildCoordinatorSetupScriptPrompt (input: {
  readonly imageId: string
  readonly repository: string
}): string {
  return [
    'create_setup_script',
    `imageId: ${input.imageId}`,
    `repository: ${input.repository}`
  ].join('\n')
}

function buildCoordinatorSessionTitle (repository: string): string {
  const cleaned = repository
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/i, '')
  const clipped = cleaned.length > 56 ? `${cleaned.slice(0, 53)}...` : cleaned
  return `Setup script: ${clipped || 'repository'}`
}

type ImageDraft = {
  readonly name: string
  readonly description: string
  readonly visibility: ImageVisibility
  readonly setupScript: string
  readonly runScript: string
}

function toDraft (image: Image): ImageDraft {
  return {
    name: image.name,
    description: image.description ?? '',
    visibility: image.visibility,
    setupScript: image.setupScript ?? '',
    runScript: image.runScript ?? ''
  }
}

type ImagePatch = {
  readonly name?: string
  readonly description?: string
  readonly visibility?: ImageVisibility
  readonly setupScript?: string
  readonly runScript?: string
}

function buildPatch (initial: ImageDraft, draft: ImageDraft): ImagePatch {
  const patch: Record<string, unknown> = {}
  if (draft.name.trim() !== initial.name) patch.name = draft.name.trim()
  if (draft.description !== initial.description)
    patch.description = draft.description
  if (draft.visibility !== initial.visibility)
    patch.visibility = draft.visibility

  if (draft.setupScript !== initial.setupScript) {
    patch.setupScript = draft.setupScript
  }
  if (draft.runScript !== initial.runScript) {
    patch.runScript = draft.runScript
  }

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
  const [showCoordinatorPromptDialog, setShowCoordinatorPromptDialog] =
    useState(false)
  const [coordinatorRepositoryInput, setCoordinatorRepositoryInput] =
    useState('')
  const [environmentModalSecretName, setEnvironmentModalSecretName] =
    useState('')
  const [environmentContents, setEnvironmentContents] = useState('')
  const [environmentDraftTouched, setEnvironmentDraftTouched] = useState(false)

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
      isDefault: v.id === image?.defaultVariantId
    }))
  }, [visibleVariants, image?.defaultVariantId])

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
    const preferredId = image?.defaultVariantId
    const preferred =
      preferredId && visibleVariants.some(v => v.id === preferredId)
        ? preferredId
        : visibleVariants[0]?.id ?? null
    setSelectedVariantId(preferred)
  }, [image?.defaultVariantId, selectedVariantId, visibleVariants])

  const selectedVariant = useMemo(
    () => visibleVariants.find(v => v.id === selectedVariantId) ?? null,
    [selectedVariantId, visibleVariants]
  )
  const selectedVariantHeadImageId =
    typeof selectedVariant?.headImageId === 'string' &&
    selectedVariant.headImageId.trim().length > 0
      ? selectedVariant.headImageId
      : undefined

  const imageIdOptions = useMemo((): readonly ImageIdOption[] => {
    const currentHeadId = selectedVariant?.headImageId
    const seen = new Set<string>()
    const options: ImageIdOption[] = []

    // Add current head image first if it exists
    if (currentHeadId && currentHeadId.trim().length > 0) {
      seen.add(currentHeadId)
      options.push({
        id: currentHeadId,
        updatedAt: selectedVariant?.updatedAt ?? new Date().toISOString(),
        isCurrent: true
      })
    }

    // Add successful build outputs (these are previous head images)
    for (const build of variantBuilds) {
      if (
        build.status === 'succeeded' &&
        build.outputImageId &&
        !seen.has(build.outputImageId)
      ) {
        seen.add(build.outputImageId)
        options.push({
          id: build.outputImageId,
          updatedAt: build.startedAt,
          isCurrent: false
        })
      }
    }

    return options
  }, [selectedVariant?.headImageId, selectedVariant?.updatedAt, variantBuilds])

  const isImageOwner = Boolean(
    auth.user && image && auth.user.id === image.createdBy
  )
  const isSelectedVariantDefault = selectedVariantId === image?.defaultVariantId

  const canMutateSelectedVariant = useMemo(() => {
    if (!auth.user || !image || !selectedVariant) return false
    if (auth.user.id === image.createdBy) return true
    if (selectedVariant.scope !== 'personal') return false
    return selectedVariant.ownerUserId === auth.user.id
  }, [auth.user, image, selectedVariant])

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

  const selectedVariantScope = (selectedVariant?.scope as VariantScope | undefined) ?? null
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

  const isScriptDirty = Boolean(
    initial && draft && draft.setupScript !== initial.setupScript
  )
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

  const saveSetupScriptMutation = useMutation({
    mutationFn: async (setupScript: string) =>
      auth.api.updateImage(imageId, { setupScript }),
    onMutate: () => {
      toast.loading('Autosaving…', { id: AUTOSAVE_TOAST_ID })
    },
    onSuccess: (_, setupScript) => {
      setInitial(prev => (prev ? { ...prev, setupScript } : prev))
      toast.success('Saved', { id: AUTOSAVE_TOAST_ID, duration: 1200 })
    },
    onError: err => {
      const msg =
        err instanceof Error ? err.message : 'Failed to auto-save setup script'
      toast.error(msg, { id: AUTOSAVE_TOAST_ID })
    }
  })

  const saveRunScriptMutation = useMutation({
    mutationFn: async (runScript: string) =>
      auth.api.updateImage(imageId, { runScript }),
    onMutate: () => {
      toast.loading('Autosaving…', { id: AUTOSAVE_TOAST_ID })
    },
    onSuccess: (_, runScript) => {
      setInitial(prev => (prev ? { ...prev, runScript } : prev))
      toast.success('Saved', { id: AUTOSAVE_TOAST_ID, duration: 1200 })
    },
    onError: err => {
      const msg =
        err instanceof Error ? err.message : 'Failed to auto-save run script'
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
    }, SETUP_SCRIPT_AUTOSAVE_DEBOUNCE_MS)

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

  useEffect(() => {
    if (!canEdit || !draft || !initial) return
    if (draft.setupScript === initial.setupScript) return
    if (saveSetupScriptMutation.isPending) return

    const timeout = window.setTimeout(() => {
      saveSetupScriptMutation.mutate(draft.setupScript)
    }, SETUP_SCRIPT_AUTOSAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timeout)
  }, [
    canEdit,
    draft?.setupScript,
    initial?.setupScript,
    saveSetupScriptMutation.isPending,
    saveSetupScriptMutation.mutate
  ])

  useEffect(() => {
    if (!canEdit || !draft || !initial) return
    if (draft.runScript === initial.runScript) return
    if (saveRunScriptMutation.isPending) return

    const timeout = window.setTimeout(() => {
      saveRunScriptMutation.mutate(draft.runScript)
    }, SETUP_SCRIPT_AUTOSAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timeout)
  }, [
    canEdit,
    draft?.runScript,
    initial?.runScript,
    saveRunScriptMutation.isPending,
    saveRunScriptMutation.mutate
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

  const writeWithCoordinatorMutation = useMutation({
    mutationFn: async (repositoryInput: string) => {
      const repository = repositoryInput.trim().replace(/\s+/g, ' ')
      if (repository.length === 0) throw new Error('Repository is required')
      if (imageId.trim().length === 0) throw new Error('Image ID is missing')

      globalThis.window.dispatchEvent(new Event(OPEN_COORDINATOR_EVENT))

      let dialogController = getDialogRuntimeController()
      if (!dialogController) {
        await new Promise<void>(resolve => {
          globalThis.window.setTimeout(resolve, 0)
        })
        dialogController = getDialogRuntimeController()
      }
      if (!dialogController) throw new Error('Coordinator dialog is not ready')

      await dialogController.createSession({
        title: buildCoordinatorSessionTitle(repository)
      })
      await new Promise<void>(resolve => {
        globalThis.window.requestAnimationFrame(() => {
          globalThis.window.requestAnimationFrame(() => resolve())
        })
      })

      const chatController = await waitForDialogChatController(5_000)
      if (!chatController) {
        throw new Error('Coordinator conversation is not ready')
      }

      await chatController.sendMessage(
        buildCoordinatorSetupScriptPrompt({
          imageId,
          repository
        })
      )
    },
    onSuccess: () => {
      setShowCoordinatorPromptDialog(false)
      setCoordinatorRepositoryInput('')
      toast.success('Coordinator prompt sent')
    },
    onError: err => {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to hand off request to coordinator'
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
        ...(selectedVariantHeadImageId
          ? { headImageId: selectedVariantHeadImageId }
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

  const updateVariantScopeMutation = useMutation({
    mutationFn: async (scope: VariantScope) => {
      if (!selectedVariantId) throw new Error('Select a variant first.')
      return auth.api.updateImageVariant(imageId, selectedVariantId, { scope })
    },
    onSuccess: async updated => {
      toast.success(
        updated.scope === 'shared'
          ? 'Variant is now shared'
          : 'Variant is now personal'
      )
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

  const setDefaultVariantMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVariantId) throw new Error('Select a variant first.')
      return auth.api.setImageDefaultVariant(imageId, selectedVariantId)
    },
    onSuccess: async () => {
      toast.success('Default variant updated')
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
        err instanceof Error ? err.message : 'Failed to set default variant'
      toast.error(msg)
    }
  })

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

  const closeSetupSandboxMutation = useMutation({
    mutationFn: async () => {
      if (!setupSandboxId) throw new Error('Start a setup sandbox first.')
      return auth.api.closeImageSetupSandbox({
        imageId,
        sandboxId: setupSandboxId
      })
    },
    onSuccess: async () => {
      setSetupSandboxId(null)
      setSetupTerminalConnection(null)
      toast.success('Head image updated')
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

  const onBuildClick = useCallback(() => {
    if (saveSetupScriptMutation.isPending) return
    if (isScriptDirty) {
      if (!draft) return
      saveSetupScriptMutation.mutate(draft.setupScript, {
        onSuccess: () => {
          buildStreamMutation.mutate()
        }
      })
      return
    }
    buildStreamMutation.mutate()
  }, [buildStreamMutation, draft, isScriptDirty, saveSetupScriptMutation])

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
  }, [connectSetupSandboxTerminal, setupSandboxId, setupTerminalConnection])

  useEffect(() => {
    return () => {
      if (!setupSandboxId) return
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
    updateVariantScopeMutation.isPending ||
    deleteVariantMutation.isPending ||
    setDefaultVariantMutation.isPending ||
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
      setSetupScript: async script => {
        if (!draft) throw new Error('Image detail draft is not ready')
        setDraft(prev => (prev ? { ...prev, setupScript: script } : prev))
        return { scriptUpdated: true as const, dirty: true as const }
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
        if (Object.prototype.hasOwnProperty.call(patch, 'setupScript')) {
          await saveSetupScriptMutation.mutateAsync(draft.setupScript)
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'runScript')) {
          await saveRunScriptMutation.mutateAsync(draft.runScript)
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
        if (saveSetupScriptMutation.isPending) {
          throw new Error('Setup script save already in progress')
        }
        if (isScriptDirty) {
          if (!draft) throw new Error('Image detail draft is not ready')
          await saveSetupScriptMutation.mutateAsync(draft.setupScript)
        }
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
    isScriptDirty,
    nameValidationError,
    saveRunScriptMutation,
    saveSetupScriptMutation,
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
  const initialValue = initial ?? null
  const selectedCurrentImageId = selectedVariant?.headImageId ?? null

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

        <Dialog
          open={showCoordinatorPromptDialog}
          onOpenChange={open => {
            if (open) {
              setShowCoordinatorPromptDialog(true)
              return
            }
            if (writeWithCoordinatorMutation.isPending) return
            setShowCoordinatorPromptDialog(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Write Setup Script with Coordinator</DialogTitle>
              <DialogDescription>
                Enter a repository URL or owner/repo. Coordinator will search it
                and generate an image setup script.
              </DialogDescription>
            </DialogHeader>
            <form
              className='space-y-4'
              onSubmit={event => {
                event.preventDefault()
                if (writeWithCoordinatorMutation.isPending) return
                void writeWithCoordinatorMutation.mutateAsync(
                  coordinatorRepositoryInput
                )
              }}
            >
              <Input
                value={coordinatorRepositoryInput}
                onChange={e => setCoordinatorRepositoryInput(e.target.value)}
                placeholder='https://github.com/org/repo or org/repo'
                disabled={writeWithCoordinatorMutation.isPending}
                autoFocus
              />
              <DialogFooter>
                <Button
                  type='button'
                  variant='secondary'
                  disabled={writeWithCoordinatorMutation.isPending}
                  onClick={() => setShowCoordinatorPromptDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  type='submit'
                  disabled={
                    writeWithCoordinatorMutation.isPending ||
                    coordinatorRepositoryInput.trim().length === 0
                  }
                >
                  {writeWithCoordinatorMutation.isPending ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : null}
                  Send to Coordinator
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

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
          title='Image'
          description='Manage image variants, current images, and builds for this image.'
        >
          <SettingsPanel>
            <div className='flex items-center gap-2 border-b border-border px-4 py-3'>
              <span className='text-sm text-text-secondary'>Variant:</span>
              <VariantCombobox
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
            </div>
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

            <SettingsList className='rounded-none border-0'>
              <SettingsRow
                className='items-start sm:items-center flex-col sm:flex-row border-b border-border'
                left={
                  <SettingsRowLeft
                    title='Variant visibility'
                    description='Toggle whether this variant is personal to you or shared across the image.'
                  />
                }
                right={
                  <ToggleGroup
                    type='single'
                    value={selectedVariantScope ?? undefined}
                    onValueChange={value => {
                      if (value) {
                        void updateVariantScopeMutation.mutateAsync(
                          value as VariantScope
                        )
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
                }
              />
              <SettingsRow
                className='items-start sm:items-center flex-col sm:flex-row border-b border-border'
                left={
                  <SettingsRowLeft
                    title='Default variant'
                    description='The variant used when no variant is specified.'
                  />
                }
                right={
                  <Button
                    variant='secondary'
                    size='sm'
                    disabled={
                      !isImageOwner ||
                      isBusy ||
                      !selectedVariantId ||
                      isSelectedVariantDefault
                    }
                    onClick={() => setDefaultVariantMutation.mutate()}
                    title={
                      !isImageOwner
                        ? 'Only image owner can set default'
                        : isSelectedVariantDefault
                        ? 'Already default'
                        : 'Set as default variant'
                    }
                  >
                    {isSelectedVariantDefault ? 'Default' : 'Set default'}
                  </Button>
                }
              />
              <SettingsRow
                className='items-start sm:items-center flex-col sm:flex-row border-b border-border'
                left={
                  <SettingsRowLeft
                    title='Current Image'
                    description='Image ref used for builds, setup sandboxes, and new agent sandboxes.'
                  />
                }
                right={
                  <ImageIdCombobox
                    value={selectedCurrentImageId ?? null}
                    options={imageIdOptions}
                    disabled={!canEdit || isBusy}
                    placeholder='No image selected'
                    className='w-full sm:w-[320px]'
                    onCopy={id => void onCopy(id, 'image id')}
                    readOnly
                  />
                }
              />
              <div>
                <SettingsRow
                  className='items-start sm:items-center flex-col sm:flex-row'
                  left={
                    <SettingsRowLeft
                      title='Extend'
                      description='Open a live shell to make manual changes. Closing the sandbox snapshots and updates the current image.'
                    />
                  }
                  right={
                    <div className='flex items-center gap-2'>
                      {!setupSandboxId ? (
                        <Button
                          variant='secondary'
                          size='sm'
                          disabled={!canEdit || isBusy || !selectedVariantId}
                          onClick={() => createSetupSandboxMutation.mutate()}
                        >
                          {createSetupSandboxMutation.isPending ? (
                            <Loader2 className='h-4 w-4 animate-spin' />
                          ) : null}
                          Activate Shell
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant='secondary'
                            size='sm'
                            disabled={!canEdit || isBusy}
                            onClick={() => closeSetupSandboxMutation.mutate()}
                          >
                            {closeSetupSandboxMutation.isPending ? (
                              <Loader2 className='h-4 w-4 animate-spin' />
                            ) : null}
                            Close and Save
                          </Button>
                        </>
                      )}
                    </div>
                  }
                />
                {setupSandboxId && setupTerminalConnection ? (
                  <div className='p-2 h-[320px] w-full'>
                    <TerminalPanel
                      wsUrl={setupTerminalConnection.wsUrl}
                      wsAuthToken={setupTerminalConnection.authToken}
                      onConnectionLost={reconnectSetupSandboxTerminal}
                    />
                  </div>
                ) : null}
              </div>
            </SettingsList>
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

        <SettingsSection
          title={
            <div className='flex items-center gap-2'>
              <p>Setup Script</p>
            </div>
          }
          description={
            <div>
              Every 30 minutes, we will create a new head image id for all
              variants by running this script.
            </div>
          }
          action={
            <div className='flex items-center gap-2'>
              <Button
                variant='secondary'
                disabled={
                  !canMutateSelectedVariant ||
                  isBusy ||
                  saveSetupScriptMutation.isPending ||
                  !selectedVariantId
                }
                onClick={onBuildClick}
                title={
                  !canMutateSelectedVariant
                    ? variantMutabilityReason ?? undefined
                    : 'Run the setup script to create a new image'
                }
              >
                {buildStreamMutation.isPending ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : null}
                Build
              </Button>
            </div>
          }
        >
          <SettingsPanel>
            {!draftValue || !initialValue ? (
              <SettingsPanelBody className='text-sm text-text-secondary'>
                Loading...
              </SettingsPanelBody>
            ) : (
              <div className='overflow-hidden h-[400px] relative'>
                <Editor
                  height='100%'
                  defaultLanguage='shell'
                  value={draftValue.setupScript}
                  onChange={value =>
                    setDraft(prev =>
                      prev ? { ...prev, setupScript: value ?? '' } : prev
                    )
                  }
                  theme='vs-dark'
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    readOnly: isBusy,
                    padding: { top: 12, bottom: 12 }
                  }}
                />
                {!draftValue.setupScript && (
                  <div className='absolute top-3 left-14 text-text-tertiary text-[13px] pointer-events-none select-none'>
                    # Install dependencies, configure environment, etc.
                  </div>
                )}
              </div>
            )}
          </SettingsPanel>
        </SettingsSection>
        <SettingsSection
          title={
            <div className='flex items-center gap-2'>
              <p>Run Script</p>
            </div>
          }
          description={
            <div>
              Every time we start a new agent sandbox, we will run this script.
            </div>
          }
        >
          <SettingsPanel>
            {!draftValue || !initialValue ? (
              <SettingsPanelBody className='text-sm text-text-secondary'>
                Loading...
              </SettingsPanelBody>
            ) : (
              <div className='overflow-hidden h-[300px] relative'>
                <Editor
                  height='100%'
                  defaultLanguage='shell'
                  value={draftValue.runScript}
                  onChange={value =>
                    setDraft(prev =>
                      prev ? { ...prev, runScript: value ?? '' } : prev
                    )
                  }
                  theme='vs-dark'
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    readOnly: isBusy,
                    padding: { top: 12, bottom: 12 }
                  }}
                />
                {!draftValue.runScript && (
                  <div className='absolute top-3 left-14 text-text-tertiary text-[13px] pointer-events-none select-none'>
                    # Prepare runtime state before agent-server starts.
                  </div>
                )}
              </div>
            )}
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
