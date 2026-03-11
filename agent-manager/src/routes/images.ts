import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { stream } from 'hono/streaming'
import type { AppEnv } from '../types/context'
import type { Visibility } from '../db/enums'
import { log } from '../log'
import { registerRoute } from '../openapi/registry'
import {
  createImage,
  getImageById,
  getImageByIdIncludingArchived,
  updateImage,
  deleteImage,
  archiveImage,
  unarchiveImage,
  listImages,
  cloneImage,
  runBuild,
  listEnvironmentSecrets,
  upsertEnvironmentSecret,
  deleteEnvironmentSecret,
  canUserAccessImageVariant,
  canUserMutateImageVariant,
  createImageVariant,
  deleteImageVariant,
  getImageVariantForImage,
  isDefaultVariant,
  listImageVariantsForUser,
  listImageVariantBuilds,
  setImageDefaultVariantId,
  updateImageVariant
} from '../services/image.service'
import { upsertModalSecret } from '../services/modal-secret.service'
import {
  closeSetupSandbox,
  createSetupSandbox,
  getImageSetupSandboxSession
} from '../services/sandbox.service'

const app = new Hono<AppEnv>()
const BASE = '/images'
const SSE_PING_INTERVAL_MS = 15_000

function isMissingTableError (err: unknown, ...tableNames: string[]): boolean {
  let current: unknown = err
  for (let i = 0; i < 8; i++) {
    if (
      !current ||
      (typeof current !== 'object' && typeof current !== 'function')
    ) {
      return false
    }
    const anyErr = current as {
      readonly code?: unknown
      readonly message?: unknown
      readonly cause?: unknown
    }
    if (
      anyErr.code === '42P01' &&
      typeof anyErr.message === 'string' &&
      tableNames.some(name => (anyErr.message as string).includes(name))
    ) {
      return true
    }
    current = anyErr.cause
  }
  return false
}

const createImageSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  headImageId: z.string().optional()
})

const updateImageSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional()
})

const listImagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
  archived: z.enum(['true', 'false']).optional()
})

const sshPublicKeySchema = z
  .string()
  .min(1)
  .max(8192)
  .refine(
    value => !value.includes('\n') && !value.includes('\r'),
    'sshPublicKeys entries must be single-line public keys'
  )

const createSetupSandboxSchema = z.object({
  variantId: z.string().uuid(),
  sshPublicKeys: z.array(sshPublicKeySchema).max(20).optional()
})

const variantIdInputSchema = z.object({
  variantId: z.string().uuid()
})

const cloneImageSchema = z.object({
  name: z.string().min(1).max(255).optional()
})

const upsertModalSecretValuesSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  env: z
    .record(z.string(), z.string())
    .refine(
      value => Object.keys(value).length > 0,
      'env must include at least one entry'
    )
})

const imageSchema = z.object({
  id: z.string(),
  visibility: z.enum(['public', 'private'] as const),
  name: z.string(),
  description: z.string().nullable().optional(),
  createdBy: z.string().nullable(),
  defaultVariantId: z.string().uuid().nullable().optional(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
  deletedAt: z.string().or(z.date()).nullable().optional()
})

const imageVariantSchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: z.enum(['shared', 'personal'] as const),
  imageId: z.string(),
  ownerUserId: z.string().nullable().optional(),
  headImageId: z.string(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date())
})

const setupSandboxSshSchema = z.object({
  username: z.string(),
  host: z.string(),
  port: z.number().int().positive(),
  hostPublicKey: z.string(),
  hostKeyFingerprint: z.string(),
  knownHostsLine: z.string()
})

const setupSandboxSchema = z.object({
  sandboxId: z.string(),
  variantId: z.string().uuid(),
  headImageId: z.string(),
  ssh: setupSandboxSshSchema.nullable().optional()
})

const closeSetupSandboxSchema = z.object({
  baseImageId: z.string(),
  headImageId: z.string(),
  variantId: z.string().uuid()
})

const buildResultSchema = z.object({
  image: imageSchema,
  variant: imageVariantSchema
})

const createVariantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  scope: z.enum(['shared', 'personal'] as const).default('personal'),
  headImageId: z.string().optional(),
  setAsDefault: z.boolean().optional().default(false)
})

const updateVariantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  headImageId: z.string().min(1).optional(),
  scope: z.enum(['shared', 'personal'] as const).optional()
})

const variantParamsSchema = z.object({
  imageId: z.string().min(1),
  variantId: z.string().uuid()
})

const listVariantBuildsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
})

const imageVariantBuildSchema = z.object({
  id: z.string().uuid(),
  imageId: z.string().uuid(),
  variantId: z.string().uuid(),
  requestedByUserId: z.string().uuid().nullable(),
  status: z.enum(['running', 'succeeded', 'failed'] as const),
  inputHash: z.string(),
  baseImageId: z.string().nullable(),
  outputImageId: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string().or(z.date()),
  finishedAt: z.string().or(z.date()).nullable(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date())
})

const upsertModalSecretResponseSchema = z.object({
  ok: z.boolean(),
  name: z.string()
})

const environmentSecretSchema = z.object({
  id: z.string(),
  imageId: z.string().nullable(),
  modalSecretName: z.string(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date())
})

const upsertEnvironmentSecretSchema = z.object({
  modalSecretName: z.string().min(1).max(255)
})

const setupSandboxParamsSchema = z.object({
  imageId: z.string().min(1),
  sandboxId: z.string().min(1)
})

function ensureCanReadImage (
  _userId: string,
  _image: { visibility: Visibility; createdBy: string | null }
) {}

function ensureCanWriteImage (userId: string, image: { createdBy: string | null }) {
  if (image.createdBy !== userId) {
    throw new Error('Image not found')
  }
}

// List images
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}`,
    summary: 'List images',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    request: { query: listImagesQuery },
    responses: {
      200: z.object({
        data: z.array(imageSchema),
        nextCursor: z.string().nullable()
      })
    }
  },
  '/',
  zValidator('query', listImagesQuery),
  async c => {
    const user = c.get('user')
    const query = c.req.valid('query' as never) as z.infer<
      typeof listImagesQuery
    >
    const result = await listImages({
      userId: user.id,
      limit: query.limit,
      cursor: query.cursor,
      archived: query.archived === 'true'
    })
    return c.json({
      data: result.images,
      nextCursor: result.nextCursor
    })
  }
)

// Create image
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}`,
    summary: 'Create image',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    request: { json: createImageSchema },
    responses: {
      201: imageSchema
    }
  },
  '/',
  zValidator('json', createImageSchema),
  async c => {
    const user = c.get('user')
    const body = c.req.valid('json' as never) as z.infer<
      typeof createImageSchema
    >
    const image = await createImage({
      name: body.name,
      description: body.description,
      headImageId: body.headImageId,
      createdBy: user.id
    })
    return c.json(image, 201)
  }
)

// Get image
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/:imageId`,
    summary: 'Get image',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: imageSchema,
      404: z.object({ error: z.string() })
    }
  },
  '/:imageId',
  async c => {
    const user = c.get('user')
    const imageId = c.req.param('imageId')
    const image = await getImageByIdIncludingArchived(imageId)
    if (!image) {
      log.warn('images.get.not_found', { userId: user.id, imageId })
      return c.json({ error: 'Image not found' }, 404)
    }
    try {
      ensureCanReadImage(user.id, {
        visibility: image.visibility as Visibility,
        createdBy: image.createdBy
      })
    } catch {
      log.warn('images.get.denied', {
        userId: user.id,
        imageId,
        imageCreatedBy: image.createdBy
      })
      return c.json({ error: 'Image not found' }, 404)
    }
    return c.json(image)
  }
)

// List variants
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/:imageId/variants`,
    summary: 'List image variants',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: z.object({ data: z.array(imageVariantSchema) }),
      404: z.object({ error: z.string() })
    }
  },
  '/:imageId/variants',
  async c => {
    const user = c.get('user')
    const imageId = c.req.param('imageId')
    const image = await getImageById(imageId)
    if (!image) return c.json({ error: 'Image not found' }, 404)
    try {
      ensureCanReadImage(user.id, {
        visibility: image.visibility as Visibility,
        createdBy: image.createdBy
      })
    } catch {
      return c.json({ error: 'Image not found' }, 404)
    }
    const variants = await listImageVariantsForUser({
      imageId,
      userId: user.id
    })
    return c.json({ data: variants })
  }
)

// Create variant
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/:imageId/variants`,
    summary: 'Create image variant',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    request: { json: createVariantSchema },
    responses: {
      201: imageVariantSchema,
      404: z.object({ error: z.string() }),
      400: z.object({ error: z.string() })
    }
  },
  '/:imageId/variants',
  zValidator('json', createVariantSchema),
  async c => {
    const user = c.get('user')
    const imageId = c.req.param('imageId')
    const body = c.req.valid('json' as never) as z.infer<
      typeof createVariantSchema
    >
    const image = await getImageById(imageId)
    if (!image) return c.json({ error: 'Image not found' }, 404)
    try {
      ensureCanReadImage(user.id, {
        visibility: image.visibility as Visibility,
        createdBy: image.createdBy
      })
    } catch {
      return c.json({ error: 'Image not found' }, 404)
    }
    if (body.scope === 'shared') {
      try {
        ensureCanWriteImage(user.id, { createdBy: image.createdBy })
      } catch {
        return c.json(
          { error: 'Only image owners can create shared variants' },
          400
        )
      }
    }
    const created = await createImageVariant({
      imageId,
      name: body.name,
      scope: body.scope,
      ownerUserId: user.id,
      headImageId: body.headImageId
    })
    if (!created) return c.json({ error: 'Failed to create variant' }, 400)
    if (body.setAsDefault) {
      try {
        ensureCanWriteImage(user.id, { createdBy: image.createdBy })
      } catch {
        return c.json(
          { error: 'Only image owners can set default variants' },
          400
        )
      }
      await setImageDefaultVariantId({
        imageId,
        variantId: created.id
      })
    }
    return c.json(created, 201)
  }
)

// Update variant
registerRoute(
  app,
  {
    method: 'patch',
    path: `${BASE}/:imageId/variants/:variantId`,
    summary: 'Update image variant',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    request: {
      params: variantParamsSchema,
      json: updateVariantSchema
    },
    responses: {
      200: imageVariantSchema,
      400: z.object({ error: z.string() }),
      404: z.object({ error: z.string() })
    }
  },
  '/:imageId/variants/:variantId',
  zValidator('param', variantParamsSchema),
  zValidator('json', updateVariantSchema),
  async c => {
    const user = c.get('user')
    const { imageId, variantId } = c.req.valid('param' as never) as z.infer<
      typeof variantParamsSchema
    >
    const body = c.req.valid('json' as never) as z.infer<
      typeof updateVariantSchema
    >

    const image = await getImageById(imageId)
    if (!image) return c.json({ error: 'Image not found' }, 404)
    try {
      ensureCanReadImage(user.id, {
        visibility: image.visibility as Visibility,
        createdBy: image.createdBy
      })
    } catch {
      return c.json({ error: 'Image not found' }, 404)
    }

    const variant = await getImageVariantForImage({ imageId, variantId })
    if (!variant) return c.json({ error: 'Image variant not found' }, 404)

    if (
      !canUserMutateImageVariant({
        userId: user.id,
        imageCreatedBy: image.createdBy ?? '',
        variant
      })
    ) {
      return c.json({ error: 'Image variant not found' }, 404)
    }

    if (body.scope === 'shared') {
      try {
        ensureCanWriteImage(user.id, { createdBy: image.createdBy })
      } catch {
        return c.json(
          { error: 'Only image owners can make variants shared' },
          400
        )
      }
    }

    const updated = await updateImageVariant({
      imageId,
      variantId,
      name: body.name,
      headImageId: body.headImageId,
      scope: body.scope,
      ownerUserId: user.id
    })
    if (!updated) return c.json({ error: 'Failed to update variant' }, 400)
    return c.json(updated)
  }
)

// Set default variant
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/:imageId/variants/:variantId/default`,
    summary: 'Set global default image variant',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    request: { params: variantParamsSchema },
    responses: {
      200: z.object({ ok: z.boolean() }),
      404: z.object({ error: z.string() }),
      400: z.object({ error: z.string() })
    }
  },
  '/:imageId/variants/:variantId/default',
  zValidator('param', variantParamsSchema),
  async c => {
    const user = c.get('user')
    const { imageId, variantId } = c.req.valid('param' as never) as z.infer<
      typeof variantParamsSchema
    >
    const image = await getImageById(imageId)
    if (!image) return c.json({ error: 'Image not found' }, 404)
    try {
      ensureCanWriteImage(user.id, { createdBy: image.createdBy })
    } catch {
      return c.json({ error: 'Image not found' }, 404)
    }
    const variant = await getImageVariantForImage({ imageId, variantId })
    if (!variant) return c.json({ error: 'Image variant not found' }, 404)
    if (!canUserAccessImageVariant({ userId: user.id, variant })) {
      return c.json({ error: 'Image variant not found' }, 404)
    }
    await setImageDefaultVariantId({ imageId, variantId })
    return c.json({ ok: true })
  }
)

// List variant builds
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/:imageId/variants/:variantId/builds`,
    summary: 'List image variant builds',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    request: { params: variantParamsSchema, query: listVariantBuildsQuery },
    responses: {
      200: z.object({ data: z.array(imageVariantBuildSchema) }),
      404: z.object({ error: z.string() })
    }
  },
  '/:imageId/variants/:variantId/builds',
  zValidator('param', variantParamsSchema),
  zValidator('query', listVariantBuildsQuery),
  async c => {
    const user = c.get('user')
    const { imageId, variantId } = c.req.valid('param' as never) as z.infer<
      typeof variantParamsSchema
    >
    const query = c.req.valid('query' as never) as z.infer<
      typeof listVariantBuildsQuery
    >
    const image = await getImageById(imageId)
    if (!image) return c.json({ error: 'Image not found' }, 404)
    try {
      ensureCanReadImage(user.id, {
        visibility: image.visibility as Visibility,
        createdBy: image.createdBy
      })
    } catch {
      return c.json({ error: 'Image not found' }, 404)
    }
    const variant = await getImageVariantForImage({ imageId, variantId })
    if (!variant) return c.json({ error: 'Image variant not found' }, 404)
    if (!canUserAccessImageVariant({ userId: user.id, variant })) {
      return c.json({ error: 'Image variant not found' }, 404)
    }
    const rawBuilds = await listImageVariantBuilds({
      imageId,
      variantId,
      limit: query.limit
    })
    const builds = rawBuilds.map(b => {
      const payload = b.inputPayload as Record<string, unknown> | null
      const baseImageId =
        payload && typeof payload.baseImageId === 'string'
          ? payload.baseImageId
          : null
      return { ...b, baseImageId }
    })
    return c.json({ data: builds })
  }
)

// Delete variant
registerRoute(
  app,
  {
    method: 'delete',
    path: `${BASE}/:imageId/variants/:variantId`,
    summary: 'Delete image variant',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    request: { params: variantParamsSchema },
    responses: {
      200: z.object({ ok: z.boolean() }),
      403: z.object({ error: z.string() }),
      400: z.object({ error: z.string() }),
      404: z.object({ error: z.string() })
    }
  },
  '/:imageId/variants/:variantId',
  zValidator('param', variantParamsSchema),
  async c => {
    const user = c.get('user')
    const { imageId, variantId } = c.req.valid('param' as never) as z.infer<
      typeof variantParamsSchema
    >

    const image = await getImageById(imageId)
    if (!image) return c.json({ error: 'Image not found' }, 404)
    try {
      ensureCanReadImage(user.id, {
        visibility: image.visibility as Visibility,
        createdBy: image.createdBy
      })
    } catch {
      return c.json({ error: 'Image not found' }, 404)
    }

    const variant = await getImageVariantForImage({ imageId, variantId })
    if (!variant) return c.json({ error: 'Image variant not found' }, 404)

    const isDefault = await isDefaultVariant({ imageId, variantId })
    if (isDefault) {
      return c.json({ error: 'Default variant cannot be deleted' }, 400)
    }

    if (
      !canUserMutateImageVariant({
        userId: user.id,
        imageCreatedBy: image.createdBy ?? '',
        variant
      })
    ) {
      return c.json({ error: 'Image variant not found' }, 404)
    }

    const ok = await deleteImageVariant({ imageId, variantId })
    return c.json({ ok })
  }
)

// Create setup sandbox
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/:imageId/setup-sandbox`,
    summary: 'Create image setup sandbox',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    request: { json: createSetupSandboxSchema },
    responses: {
      200: setupSandboxSchema,
      404: z.object({ error: z.string() }),
      400: z.object({ error: z.string() })
    }
  },
  '/:imageId/setup-sandbox',
  zValidator('json', createSetupSandboxSchema),
  async c => {
    const user = c.get('user')
    const imageId = c.req.param('imageId')
    const body = c.req.valid('json' as never) as z.infer<
      typeof createSetupSandboxSchema
    >
    const variantId = body.variantId
    const image = await getImageById(imageId)
    if (!image) return c.json({ error: 'Image not found' }, 404)
    try {
      ensureCanReadImage(user.id, {
        visibility: image.visibility as Visibility,
        createdBy: image.createdBy
      })
    } catch {
      return c.json({ error: 'Image not found' }, 404)
    }
    try {
      const created = await createSetupSandbox({
        imageId,
        variantId,
        userId: user.id,
        region: user.defaultRegion,
        sshPublicKeys: body.sshPublicKeys
      })
      return c.json(created)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to create setup sandbox'
      return c.json({ error: message }, 400)
    }
  }
)

registerRoute(
  app,
  {
    method: 'delete',
    path: `${BASE}/:imageId/setup-sandbox/:sandboxId`,
    summary: 'Close setup sandbox',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    request: { params: setupSandboxParamsSchema },
    responses: {
      200: closeSetupSandboxSchema,
      404: z.object({ error: z.string() }),
      400: z.object({ error: z.string() })
    }
  },
  '/:imageId/setup-sandbox/:sandboxId',
  zValidator('param', setupSandboxParamsSchema),
  async c => {
    const user = c.get('user')
    const { imageId, sandboxId } = c.req.valid('param' as never) as z.infer<
      typeof setupSandboxParamsSchema
    >
    const image = await getImageById(imageId)
    if (!image) return c.json({ error: 'Image not found' }, 404)
    try {
      ensureCanReadImage(user.id, {
        visibility: image.visibility as Visibility,
        createdBy: image.createdBy
      })
    } catch {
      return c.json({ error: 'Image not found' }, 404)
    }
    try {
      const session = getImageSetupSandboxSession({ sandboxId })
      if (!session || session.imageId !== imageId || session.userId !== user.id) {
        return c.json({ error: 'Setup sandbox not found' }, 404)
      }

      const result = await closeSetupSandbox({
        userId: user.id,
        sandboxId
      })
      return c.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Close failed'
      return c.json({ error: message }, 400)
    }
  }
)

// Update image
registerRoute(
  app,
  {
    method: 'patch',
    path: `${BASE}/:imageId`,
    summary: 'Update image',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    request: { json: updateImageSchema },
    responses: {
      200: imageSchema,
      404: z.object({ error: z.string() })
    }
  },
  '/:imageId',
  zValidator('json', updateImageSchema),
  async c => {
    const user = c.get('user')
    const imageId = c.req.param('imageId')
    const body = c.req.valid('json' as never) as z.infer<
      typeof updateImageSchema
    >
    const existing = await getImageById(imageId)
    if (!existing) return c.json({ error: 'Image not found' }, 404)
    log.info('images.update.request', {
      userId: user.id,
      imageId,
      imageCreatedBy: existing.createdBy
    })
    const patch: {
      readonly name?: string
      readonly description?: string
    } = {
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.description === 'string'
        ? { description: body.description }
        : {})
    }
    const image = await updateImage(imageId, {
      ...patch
    })
    if (!image) return c.json({ error: 'Image not found' }, 404)
    return c.json(image)
  }
)

// Upsert Modal secret values (stores key-value pairs in Modal)
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/:imageId/modal-secrets`,
    summary: 'Upsert Modal secret values',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    request: { json: upsertModalSecretValuesSchema },
    responses: {
      200: upsertModalSecretResponseSchema,
      400: z.object({ error: z.string() }),
      404: z.object({ error: z.string() })
    }
  },
  '/:imageId/modal-secrets',
  zValidator('json', upsertModalSecretValuesSchema),
  async c => {
    const user = c.get('user')
    const imageId = c.req.param('imageId')
    const body = c.req.valid('json' as never) as z.infer<
      typeof upsertModalSecretValuesSchema
    >

    const existing = await getImageById(imageId)
    if (!existing) return c.json({ error: 'Image not found' }, 404)
    try {
      ensureCanWriteImage(user.id, { createdBy: existing.createdBy })
    } catch {
      return c.json({ error: 'Image not found' }, 404)
    }

    const secretName = body.name ?? `image-secret-${imageId}`
    try {
      await upsertModalSecret({ name: secretName, entries: body.env })
      return c.json({ ok: true, name: secretName })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Secret upsert failed'
      return c.json({ error: message }, 400)
    }
  }
)

// List environment secrets
registerRoute(
  app,
  {
    method: 'get',
    path: `${BASE}/:imageId/environment-secrets`,
    summary: 'List environment secrets',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: z.object({ data: z.array(environmentSecretSchema) }),
      404: z.object({ error: z.string() }),
      500: z.object({ error: z.string() })
    }
  },
  '/:imageId/environment-secrets',
  async c => {
    const user = c.get('user')
    const imageId = c.req.param('imageId')

    const existing = await getImageById(imageId)
    if (!existing) return c.json({ error: 'Image not found' }, 404)
    try {
      ensureCanWriteImage(user.id, { createdBy: existing.createdBy })
    } catch {
      return c.json({ error: 'Image not found' }, 404)
    }

    try {
      const secrets = await listEnvironmentSecrets(imageId)
      return c.json({ data: secrets })
    } catch (e) {
      if (isMissingTableError(e, 'environment_secrets')) {
        return c.json(
          {
            error:
              'Database schema is missing "environment_secrets". Run `bun run db:migrate` in `agent-manager` (and ensure DATABASE_URL points to the right DB).'
          },
          500
        )
      }
      return c.json({ error: 'Failed to list environment secrets' }, 500)
    }
  }
)

// Upsert environment secret
registerRoute(
  app,
  {
    method: 'put',
    path: `${BASE}/:imageId/environment-secrets`,
    summary: 'Upsert environment secret',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    request: { json: upsertEnvironmentSecretSchema },
    responses: {
      200: environmentSecretSchema,
      400: z.object({ error: z.string() }),
      404: z.object({ error: z.string() })
    }
  },
  '/:imageId/environment-secrets',
  zValidator('json', upsertEnvironmentSecretSchema),
  async c => {
    const user = c.get('user')
    const imageId = c.req.param('imageId')
    const body = c.req.valid('json' as never) as z.infer<
      typeof upsertEnvironmentSecretSchema
    >

    const existing = await getImageById(imageId)
    if (!existing) return c.json({ error: 'Image not found' }, 404)
    try {
      ensureCanWriteImage(user.id, { createdBy: existing.createdBy })
    } catch {
      return c.json({ error: 'Image not found' }, 404)
    }

    try {
      const row = await upsertEnvironmentSecret({
        imageId,
        modalSecretName: body.modalSecretName
      })
      if (!row) return c.json({ error: 'Image not found' }, 404)
      return c.json(row)
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Failed to upsert environment secret'
      return c.json({ error: message }, 400)
    }
  }
)

// Delete environment secret
registerRoute(
  app,
  {
    method: 'delete',
    path: `${BASE}/:imageId/environment-secrets/:environmentSecretId`,
    summary: 'Delete environment secret',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: z.object({ ok: z.boolean() }),
      404: z.object({ error: z.string() })
    }
  },
  '/:imageId/environment-secrets/:environmentSecretId',
  async c => {
    const user = c.get('user')
    const imageId = c.req.param('imageId')
    const environmentSecretId = c.req.param('environmentSecretId')

    const existing = await getImageById(imageId)
    if (!existing) return c.json({ error: 'Image not found' }, 404)
    try {
      ensureCanWriteImage(user.id, { createdBy: existing.createdBy })
    } catch {
      return c.json({ error: 'Image not found' }, 404)
    }

    const ok = await deleteEnvironmentSecret({ imageId, environmentSecretId })
    return c.json({ ok })
  }
)

// Delete image
registerRoute(
  app,
  {
    method: 'delete',
    path: `${BASE}/:imageId`,
    summary: 'Delete image',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: z.object({ ok: z.boolean() }),
      400: z.object({ error: z.string() }),
      404: z.object({ error: z.string() })
    }
  },
  '/:imageId',
  async c => {
    const user = c.get('user')
    const imageId = c.req.param('imageId')
    const existing = await getImageByIdIncludingArchived(imageId)
    if (!existing) {
      log.warn('images.delete.not_found', { userId: user.id, imageId })
      return c.json({ error: 'Image not found' }, 404)
    }
    if (existing.deletedAt == null) {
      log.warn('images.delete.requires_archived', {
        userId: user.id,
        imageId
      })
      return c.json(
        { error: 'Image must be archived before deletion' },
        400
      )
    }
    const ok = await deleteImage(imageId)
    if (!ok) {
      log.warn('images.delete.failed', { userId: user.id, imageId })
      return c.json({ error: 'Image not found' }, 404)
    }
    log.info('images.delete.succeeded', { userId: user.id, imageId })
    return c.json({ ok: true })
  }
)

// Archive image
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/:imageId/archive`,
    summary: 'Archive image',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: imageSchema,
      400: z.object({ error: z.string() }),
      404: z.object({ error: z.string() })
    }
  },
  '/:imageId/archive',
  async c => {
    const user = c.get('user')
    const imageId = c.req.param('imageId')
    const existing = await getImageByIdIncludingArchived(imageId)
    if (!existing) {
      log.warn('images.archive.not_found', { userId: user.id, imageId })
      return c.json({ error: 'Image not found' }, 404)
    }
    if (existing.deletedAt != null) {
      log.warn('images.archive.already_archived', { userId: user.id, imageId })
      return c.json({ error: 'Image is already archived' }, 400)
    }
    const image = await archiveImage(imageId)
    if (!image) {
      log.warn('images.archive.failed', { userId: user.id, imageId })
      return c.json({ error: 'Image not found' }, 404)
    }
    log.info('images.archive.succeeded', {
      userId: user.id,
      imageId,
      deletedAt: image.deletedAt ?? null
    })
    return c.json(image)
  }
)

// Unarchive image
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/:imageId/unarchive`,
    summary: 'Unarchive image',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: imageSchema,
      400: z.object({ error: z.string() }),
      404: z.object({ error: z.string() })
    }
  },
  '/:imageId/unarchive',
  async c => {
    const user = c.get('user')
    const imageId = c.req.param('imageId')
    const existing = await getImageByIdIncludingArchived(imageId)
    if (!existing) {
      log.warn('images.unarchive.not_found', { userId: user.id, imageId })
      return c.json({ error: 'Image not found' }, 404)
    }
    if (existing.deletedAt == null) {
      log.warn('images.unarchive.not_archived', { userId: user.id, imageId })
      return c.json({ error: 'Image is not archived' }, 400)
    }
    const image = await unarchiveImage(imageId)
    if (!image) {
      log.warn('images.unarchive.failed', { userId: user.id, imageId })
      return c.json({ error: 'Image not found' }, 404)
    }
    log.info('images.unarchive.succeeded', { userId: user.id, imageId })
    return c.json(image)
  }
)

// Run build
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/:imageId/build`,
    summary: 'Run image build',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    request: { json: variantIdInputSchema },
    responses: {
      200: buildResultSchema,
      400: z.object({ error: z.string() })
    }
  },
  '/:imageId/build',
  zValidator('json', variantIdInputSchema),
  async c => {
    const user = c.get('user')
    const imageId = c.req.param('imageId')
    const body = c.req.valid('json' as never) as z.infer<
      typeof variantIdInputSchema
    >
    const variantId = body.variantId
    const existing = await getImageById(imageId)
    if (!existing) return c.json({ error: 'Image not found' }, 404)
    try {
      ensureCanReadImage(user.id, {
        visibility: existing.visibility as Visibility,
        createdBy: existing.createdBy
      })
    } catch {
      return c.json({ error: 'Image not found' }, 404)
    }

    const accept = c.req.header('accept')?.toLowerCase() ?? ''
    const wantsSse = accept.includes('text/event-stream')
    if (!wantsSse) {
      try {
        const result = await runBuild({
          imageRecordId: imageId,
          variantId,
          userId: user.id
        })
        return c.json({ image: result.image, variant: result.variant })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Build failed'
        return c.json({ error: message }, 400)
      }
    }

    c.header('Content-Type', 'text/event-stream')
    c.header('Cache-Control', 'no-cache')
    c.header('Connection', 'keep-alive')

    return stream(c, async writer => {
      let eventId = 0
      let writeChain: Promise<void> = Promise.resolve()

      const enqueue = (payload: string) => {
        writeChain = writeChain
          .then(async () => {
            await writer.write(payload)
          })
          .catch(() => {})
      }

      const send = (event: string, data: unknown) => {
        eventId += 1
        enqueue(
          `id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        )
      }

      const pingTimer = setInterval(() => {
        enqueue(`: ping\n\n`)
      }, SSE_PING_INTERVAL_MS)

      send('status', { phase: 'starting' })
      try {
        const result = await runBuild({
          imageRecordId: imageId,
          variantId,
          userId: user.id,
          onChunk: chunk => {
            if (!chunk.text) return
            send('log', chunk)
          }
        })
        send('result', { image: result.image, variant: result.variant })
        send('status', { phase: 'completed' })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Build failed'
        send('error', { message })
        send('status', { phase: 'failed' })
      } finally {
        clearInterval(pingTimer)
        await writeChain
      }
    })
  }
)

// Clone image
registerRoute(
  app,
  {
    method: 'post',
    path: `${BASE}/:imageId/clone`,
    summary: 'Clone image',
    tags: ['images'],
    security: [{ bearerAuth: [] }],
    request: { json: cloneImageSchema },
    responses: {
      201: imageSchema,
      400: z.object({ error: z.string() })
    }
  },
  '/:imageId/clone',
  zValidator('json', cloneImageSchema),
  async c => {
    const user = c.get('user')
    const imageId = c.req.param('imageId')
    const body = c.req.valid('json' as never) as z.infer<
      typeof cloneImageSchema
    >
    try {
      const existing = await getImageById(imageId)
      if (!existing) return c.json({ error: 'Image not found' }, 404)
      try {
        ensureCanReadImage(user.id, {
          visibility: existing.visibility as Visibility,
          createdBy: existing.createdBy
        })
      } catch {
        return c.json({ error: 'Image not found' }, 404)
      }
      const cloned = await cloneImage({
        sourceImageId: imageId,
        clonedByUserId: user.id,
        nameOverride: body.name
      })
      return c.json(cloned, 201)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Clone failed'
      return c.json({ error: message }, 400)
    }
  }
)

export { app as imageRoutes }
