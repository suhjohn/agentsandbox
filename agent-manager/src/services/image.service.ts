import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  type SQL,
} from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db";
import { env } from "../env";
import {
  environmentSecrets,
  imageVariantBuilds,
  images,
  imageVariants,
  userImageVariantDefaults,
} from "../db/schema";
import { log } from "../log";
import { runImageBuild, type BuildChunk } from "./sandbox.service";
import {
  copyImageHookFiles,
  deleteImageHookVolume,
  getImageBuildHookDigest,
} from "./image-hooks";

// ── Shared helpers ──────────────────────────────────────────────────

export const DEFAULT_VARIANT_IMAGE_REF = env.AGENT_BASE_IMAGE_REF;

function normalizeNullableText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeVariantImageId(value: string | null | undefined): string {
  return normalizeNullableText(value) ?? DEFAULT_VARIANT_IMAGE_REF;
}

function normalizeSecretNames(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeNullableText(value);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function hydrateImage(input: {
  readonly image: typeof images.$inferSelect;
  readonly userDefaultVariantId?: string | null;
}) {
  const userDefaultVariantId = input.userDefaultVariantId ?? null;
  return {
    ...input.image,
    userDefaultVariantId,
    effectiveDefaultVariantId:
      userDefaultVariantId ?? input.image.defaultVariantId ?? null,
  };
}

// ── Types ───────────────────────────────────────────────────────────

export type ImageVariantScope = "shared" | "personal";
export type ImageVariantBuildStatus = "running" | "succeeded" | "failed";

export type ImageVariantRecord = typeof imageVariants.$inferSelect;

export function getVariantActiveImageId(input: {
  readonly activeImageId: string | null | undefined;
}): string {
  return normalizeVariantImageId(input.activeImageId);
}

export function getVariantDraftImageId(input: {
  readonly draftImageId: string | null | undefined;
  readonly activeImageId: string | null | undefined;
}): string {
  return (
    normalizeNullableText(input.draftImageId) ?? getVariantActiveImageId(input)
  );
}

// ── Environment Secrets ─────────────────────────────────────────────

export async function listEnvironmentSecrets(imageId: string | null) {
  if (imageId !== null && !isUuid(imageId)) return [];
  const condition =
    imageId === null
      ? isNull(environmentSecrets.imageId)
      : eq(environmentSecrets.imageId, imageId);
  return db
    .select()
    .from(environmentSecrets)
    .where(condition)
    .orderBy(environmentSecrets.modalSecretName);
}

export async function upsertEnvironmentSecret(input: {
  readonly imageId: string | null;
  readonly modalSecretName: string;
}) {
  if (input.imageId !== null && !isUuid(input.imageId)) return null;

  const trimmedSecretName = input.modalSecretName.trim();
  if (trimmedSecretName.length === 0)
    throw new Error("modalSecretName must be non-empty");

  const [row] = await db
    .insert(environmentSecrets)
    .values({
      imageId: input.imageId,
      modalSecretName: trimmedSecretName,
    })
    .onConflictDoUpdate({
      target: [environmentSecrets.imageId, environmentSecrets.modalSecretName],
      set: { updatedAt: new Date() },
    })
    .returning();

  return row ?? null;
}

export async function deleteEnvironmentSecret(input: {
  readonly imageId: string | null;
  readonly environmentSecretId: string;
}): Promise<boolean> {
  if (input.imageId !== null && !isUuid(input.imageId)) return false;
  if (!isUuid(input.environmentSecretId)) return false;

  const imageCondition =
    input.imageId === null
      ? isNull(environmentSecrets.imageId)
      : eq(environmentSecrets.imageId, input.imageId);

  const result = await db
    .delete(environmentSecrets)
    .where(
      and(eq(environmentSecrets.id, input.environmentSecretId), imageCondition),
    )
    .returning();
  return result.length > 0;
}

// ── Image Variants ──────────────────────────────────────────────────

const IMAGE_VARIANT_SELECT = {
  id: imageVariants.id,
  name: imageVariants.name,
  scope: imageVariants.scope,
  imageId: imageVariants.imageId,
  ownerUserId: imageVariants.ownerUserId,
  activeImageId: imageVariants.activeImageId,
  draftImageId: imageVariants.draftImageId,
  createdAt: imageVariants.createdAt,
  updatedAt: imageVariants.updatedAt,
};

async function getImageVariantByFilter(where: SQL<unknown>) {
  const rows = await db
    .select(IMAGE_VARIANT_SELECT)
    .from(imageVariants)
    .where(where)
    .limit(1);
  return rows[0] ?? null;
}

export async function getImageVariantById(id: string) {
  if (!isUuid(id)) return null;
  return getImageVariantByFilter(eq(imageVariants.id, id));
}

export async function getImageVariantForImage(input: {
  readonly imageId: string;
  readonly variantId: string;
}) {
  if (!isUuid(input.imageId) || !isUuid(input.variantId)) return null;
  return getImageVariantByFilter(
    and(
      eq(imageVariants.id, input.variantId),
      eq(imageVariants.imageId, input.imageId),
    )!,
  );
}

export async function listImageVariantsForUser(input: {
  readonly imageId: string;
  readonly userId: string;
}) {
  if (!isUuid(input.imageId) || !isUuid(input.userId)) return [];
  return db
    .select(IMAGE_VARIANT_SELECT)
    .from(imageVariants)
    .where(eq(imageVariants.imageId, input.imageId))
    .orderBy(asc(imageVariants.createdAt));
}

export function canUserAccessImageVariant(_input: {
  readonly userId: string;
  readonly variant: {
    readonly scope: string;
    readonly ownerUserId: string | null;
  };
}): boolean {
  return true;
}

export function canUserMutateImageVariant(input: {
  readonly userId: string;
  readonly imageCreatedBy: string;
  readonly variant: {
    readonly scope: string;
    readonly ownerUserId: string | null;
  };
}): boolean {
  if (input.variant.scope === "shared") return true;
  if (input.userId === input.imageCreatedBy) return true;
  if (input.variant.scope !== "personal") return false;
  return input.variant.ownerUserId === input.userId;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || (typeof err !== "object" && typeof err !== "function"))
    return false;
  const anyErr = err as {
    readonly cause?: unknown;
    readonly message?: unknown;
  };
  const cause = anyErr.cause as {
    readonly code?: unknown;
    readonly message?: unknown;
  } | null;
  if (cause?.code === "23505") return true;
  if (typeof anyErr.message === "string" && anyErr.message.includes("23505"))
    return true;
  if (typeof cause?.message === "string" && cause.message.includes("23505"))
    return true;
  return false;
}

function buildUniqueVariantName(input: {
  readonly baseName: string;
  readonly existingNames: ReadonlySet<string>;
}): string {
  if (!input.existingNames.has(input.baseName)) return input.baseName;
  for (let i = 2; i <= 10_000; i++) {
    const candidate = `${input.baseName} ${i}`;
    if (!input.existingNames.has(candidate)) return candidate;
  }
  return `${input.baseName} ${Date.now()}`;
}

export async function createImageVariant(input: {
  readonly imageId: string;
  readonly name?: string;
  readonly scope: ImageVariantScope;
  readonly ownerUserId?: string | null;
  readonly activeImageId?: string | null;
  readonly draftImageId?: string | null;
}) {
  if (!isUuid(input.imageId)) return null;

  const trimmedName = (input.name ?? "").trim();
  const baseName = trimmedName.length > 0 ? trimmedName : "Variant";
  const ownerUserId =
    input.scope === "personal" ? (input.ownerUserId ?? null) : null;
  const activeImageId = normalizeVariantImageId(input.activeImageId);
  const draftImageId =
    normalizeNullableText(input.draftImageId) ?? activeImageId;

  // UI can create personal variants without specifying a name. Auto-number
  // default names so users can create multiple personal variants per image.
  let candidateName = baseName;
  let knownNames: Set<string> | null = null;
  const shouldAutoNumber =
    trimmedName.length === 0 && ownerUserId !== null && isUuid(ownerUserId);
  if (shouldAutoNumber) {
    const existing = await db
      .select({ name: imageVariants.name })
      .from(imageVariants)
      .where(
        and(
          eq(imageVariants.imageId, input.imageId),
          eq(imageVariants.ownerUserId, ownerUserId),
        )!,
      );
    knownNames = new Set(existing.map((row) => row.name));
    candidateName = buildUniqueVariantName({
      baseName,
      existingNames: knownNames,
    });
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const [created] = await db
        .insert(imageVariants)
        .values({
          imageId: input.imageId,
          name: candidateName,
          scope: input.scope,
          ownerUserId,
          activeImageId,
          draftImageId,
        })
        .returning({ id: imageVariants.id });
      if (!created) return null;
      return getImageVariantById(created.id);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (!shouldAutoNumber) return null;
      if (!knownNames) return null;
      knownNames.add(candidateName);
      candidateName = buildUniqueVariantName({
        baseName,
        existingNames: knownNames,
      });
    }
  }

  return null;
}

export async function updateImageVariant(input: {
  readonly imageId: string;
  readonly variantId: string;
  readonly name?: string;
  readonly activeImageId?: string | null;
  readonly draftImageId?: string | null;
  readonly scope?: ImageVariantScope;
  readonly ownerUserId?: string | null;
}) {
  if (!isUuid(input.imageId) || !isUuid(input.variantId)) return null;

  const existing = await getImageVariantForImage({
    imageId: input.imageId,
    variantId: input.variantId,
  });
  if (!existing) return null;

  const nextScope = input.scope ?? (existing.scope as ImageVariantScope);
  const nextOwnerUserId =
    nextScope === "personal" ? (input.ownerUserId ?? null) : null;
  const requestedName =
    typeof input.name === "string" ? input.name.trim() : null;
  if (requestedName !== null && requestedName.length === 0) {
    throw new Error("name must be non-empty");
  }

  let nextName = requestedName ?? existing.name;
  const nextActiveImageId = Object.prototype.hasOwnProperty.call(
    input,
    "activeImageId",
  )
    ? normalizeVariantImageId(input.activeImageId)
    : getVariantActiveImageId(existing);
  const nextDraftImageId = Object.prototype.hasOwnProperty.call(
    input,
    "draftImageId",
  )
    ? (normalizeNullableText(input.draftImageId) ?? nextActiveImageId)
    : getVariantDraftImageId(existing);
  const shouldAutoRenameOnPersonalConflict =
    requestedName === null &&
    nextScope === "personal" &&
    nextOwnerUserId &&
    isUuid(nextOwnerUserId);
  if (shouldAutoRenameOnPersonalConflict) {
    const existingRows = await db
      .select({ name: imageVariants.name })
      .from(imageVariants)
      .where(
        and(
          eq(imageVariants.imageId, input.imageId),
          eq(imageVariants.ownerUserId, nextOwnerUserId),
        )!,
      );
    const existingNames = new Set(
      existingRows
        .map((row) => row.name)
        .filter((name) => name !== existing.name),
    );
    nextName = buildUniqueVariantName({
      baseName: nextName,
      existingNames,
    });
  }

  try {
    const [updated] = await db
      .update(imageVariants)
      .set({
        scope: nextScope,
        ownerUserId: nextOwnerUserId,
        name: nextName,
        activeImageId: nextActiveImageId,
        draftImageId: nextDraftImageId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(imageVariants.id, input.variantId),
          eq(imageVariants.imageId, input.imageId),
        ),
      )
      .returning({ id: imageVariants.id });
    if (!updated) return null;
    return getImageVariantById(updated.id);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error("Variant name already exists");
    }
    throw err;
  }
}

export async function deleteImageVariant(input: {
  readonly imageId: string;
  readonly variantId: string;
}) {
  if (!isUuid(input.imageId) || !isUuid(input.variantId)) return false;
  const deleted = await db
    .delete(imageVariants)
    .where(
      and(
        eq(imageVariants.id, input.variantId),
        eq(imageVariants.imageId, input.imageId),
      ),
    )
    .returning({ id: imageVariants.id });
  return deleted.length > 0;
}

export async function createDefaultImageVariantForImage(input: {
  readonly imageId: string;
  readonly ownerUserId: string;
  readonly activeImageId?: string | null;
  readonly draftImageId?: string | null;
}) {
  return createImageVariant({
    imageId: input.imageId,
    name: "Default",
    scope: "shared",
    ownerUserId: input.ownerUserId,
    activeImageId: input.activeImageId,
    draftImageId: input.draftImageId,
  });
}

export async function setImageDefaultVariantId(input: {
  readonly imageId: string;
  readonly variantId: string | null;
}) {
  if (!isUuid(input.imageId)) return null;
  const [row] = await db
    .update(images)
    .set({
      defaultVariantId: input.variantId,
      updatedAt: new Date(),
    })
    .where(eq(images.id, input.imageId))
    .returning();
  return row ?? null;
}

export async function getDefaultImageVariantForImage(imageId: string) {
  if (!isUuid(imageId)) return null;
  const imageRows = await db
    .select({ defaultVariantId: images.defaultVariantId })
    .from(images)
    .where(eq(images.id, imageId))
    .limit(1);
  const defaultVariantId = imageRows[0]?.defaultVariantId ?? null;
  if (!defaultVariantId) return null;
  return getImageVariantForImage({ imageId, variantId: defaultVariantId });
}

export async function getUserImageDefaultVariantId(input: {
  readonly imageId: string;
  readonly userId: string;
}) {
  if (!isUuid(input.imageId) || !isUuid(input.userId)) return null;
  const rows = await db
    .select({ variantId: userImageVariantDefaults.variantId })
    .from(userImageVariantDefaults)
    .where(
      and(
        eq(userImageVariantDefaults.imageId, input.imageId),
        eq(userImageVariantDefaults.userId, input.userId),
      ),
    )
    .limit(1);
  return rows[0]?.variantId ?? null;
}

async function listUserImageDefaultVariantIds(input: {
  readonly imageIds: readonly string[];
  readonly userId: string;
}) {
  if (!isUuid(input.userId) || input.imageIds.length === 0) {
    return new Map<string, string>();
  }
  const imageIds = input.imageIds.filter(isUuid);
  if (imageIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select({
      imageId: userImageVariantDefaults.imageId,
      variantId: userImageVariantDefaults.variantId,
    })
    .from(userImageVariantDefaults)
    .where(
      and(
        eq(userImageVariantDefaults.userId, input.userId),
        inArray(userImageVariantDefaults.imageId, imageIds),
      ),
    );
  return new Map(rows.map((row) => [row.imageId, row.variantId]));
}

export async function getUserDefaultImageVariantForImage(input: {
  readonly imageId: string;
  readonly userId: string;
}) {
  const variantId = await getUserImageDefaultVariantId(input);
  if (!variantId) return null;
  return getImageVariantForImage({ imageId: input.imageId, variantId });
}

export async function setUserImageDefaultVariantId(input: {
  readonly imageId: string;
  readonly userId: string;
  readonly variantId: string;
}) {
  if (
    !isUuid(input.imageId) ||
    !isUuid(input.userId) ||
    !isUuid(input.variantId)
  ) {
    return null;
  }
  const [row] = await db
    .insert(userImageVariantDefaults)
    .values({
      imageId: input.imageId,
      userId: input.userId,
      variantId: input.variantId,
    })
    .onConflictDoUpdate({
      target: [
        userImageVariantDefaults.userId,
        userImageVariantDefaults.imageId,
      ],
      set: {
        variantId: input.variantId,
        updatedAt: new Date(),
      },
    })
    .returning({ variantId: userImageVariantDefaults.variantId });
  return row?.variantId ?? null;
}

export async function clearUserImageDefaultVariantId(input: {
  readonly imageId: string;
  readonly userId: string;
}) {
  if (!isUuid(input.imageId) || !isUuid(input.userId)) return false;
  const rows = await db
    .delete(userImageVariantDefaults)
    .where(
      and(
        eq(userImageVariantDefaults.imageId, input.imageId),
        eq(userImageVariantDefaults.userId, input.userId),
      ),
    )
    .returning({ id: userImageVariantDefaults.id });
  return rows.length > 0;
}

export async function resolveImageVariantForUser(input: {
  readonly imageId: string;
  readonly userId: string;
  readonly variantId?: string | null;
}) {
  if (input.variantId) {
    const explicitVariant = await getImageVariantForImage({
      imageId: input.imageId,
      variantId: input.variantId,
    });
    if (!explicitVariant) return null;
    return explicitVariant;
  }
  const userDefaultVariant = await getUserDefaultImageVariantForImage({
    imageId: input.imageId,
    userId: input.userId,
  });
  if (userDefaultVariant) return userDefaultVariant;
  return getDefaultImageVariantForImage(input.imageId);
}

export async function setImageVariantDraftImageId(input: {
  readonly variantId: string;
  readonly draftImageId: string | null;
}) {
  if (!isUuid(input.variantId)) return null;
  const [updated] = await db
    .update(imageVariants)
    .set({
      draftImageId: normalizeVariantImageId(input.draftImageId),
      updatedAt: new Date(),
    })
    .where(eq(imageVariants.id, input.variantId))
    .returning({ id: imageVariants.id });
  if (!updated) return null;
  return getImageVariantById(updated.id);
}

export async function createImageVariantBuild(input: {
  readonly imageId: string;
  readonly variantId: string;
  readonly requestedByUserId: string;
  readonly status: ImageVariantBuildStatus;
  readonly inputHash: string;
  readonly inputPayload: Record<string, unknown>;
  readonly logs?: string;
  readonly outputImageId?: string | null;
  readonly errorMessage?: string | null;
  readonly finishedAt?: Date | null;
}) {
  if (
    !isUuid(input.imageId) ||
    !isUuid(input.variantId) ||
    !isUuid(input.requestedByUserId)
  ) {
    return null;
  }
  const [created] = await db
    .insert(imageVariantBuilds)
    .values({
      imageId: input.imageId,
      variantId: input.variantId,
      requestedByUserId: input.requestedByUserId,
      status: input.status,
      inputHash: input.inputHash,
      inputPayload: input.inputPayload,
      logs: input.logs ?? "",
      outputImageId: normalizeNullableText(input.outputImageId),
      errorMessage: normalizeNullableText(input.errorMessage),
      finishedAt: input.finishedAt ?? null,
    })
    .returning();
  return created ?? null;
}

export async function updateImageVariantBuild(input: {
  readonly buildId: string;
  readonly status: ImageVariantBuildStatus;
  readonly logs?: string;
  readonly outputImageId?: string | null;
  readonly errorMessage?: string | null;
  readonly finishedAt?: Date | null;
}) {
  if (!isUuid(input.buildId)) return null;
  const nextLogs = typeof input.logs === "string" ? input.logs : undefined;
  const [updated] = await db
    .update(imageVariantBuilds)
    .set({
      status: input.status,
      ...(nextLogs !== undefined ? { logs: nextLogs } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "outputImageId")
        ? { outputImageId: normalizeNullableText(input.outputImageId) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "errorMessage")
        ? { errorMessage: normalizeNullableText(input.errorMessage) }
        : {}),
      finishedAt: input.finishedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(imageVariantBuilds.id, input.buildId))
    .returning();
  return updated ?? null;
}

export async function listImageVariantBuilds(input: {
  readonly imageId: string;
  readonly variantId: string;
  readonly limit?: number;
}) {
  if (!isUuid(input.imageId) || !isUuid(input.variantId)) return [];
  const limit =
    typeof input.limit === "number"
      ? Math.max(1, Math.min(200, input.limit))
      : 50;
  return db
    .select()
    .from(imageVariantBuilds)
    .where(
      and(
        eq(imageVariantBuilds.imageId, input.imageId),
        eq(imageVariantBuilds.variantId, input.variantId),
      ),
    )
    .orderBy(desc(imageVariantBuilds.startedAt))
    .limit(limit);
}

export async function isDefaultVariant(input: {
  readonly imageId: string;
  readonly variantId: string;
}) {
  if (!isUuid(input.imageId) || !isUuid(input.variantId)) return false;
  const rows = await db
    .select({ defaultVariantId: images.defaultVariantId })
    .from(images)
    .where(eq(images.id, input.imageId))
    .limit(1);
  return rows[0]?.defaultVariantId === input.variantId;
}

// ── Images ──────────────────────────────────────────────────────────

export async function createImage(input: {
  readonly name: string;
  readonly description?: string;
  readonly activeImageId?: string | null;
  readonly draftImageId?: string | null;
  readonly createdBy: string;
}) {
  const [image] = await db
    .insert(images)
    .values({
      name: input.name,
      description: input.description,
      createdBy: input.createdBy,
    })
    .returning();

  if (!image) throw new Error("Failed to create image");

  const defaultVariant = await createDefaultImageVariantForImage({
    imageId: image.id,
    ownerUserId: input.createdBy,
    activeImageId: input.activeImageId,
    draftImageId: input.draftImageId,
  });
  if (!defaultVariant)
    throw new Error("Failed to create default image variant");

  await setImageDefaultVariantId({
    imageId: image.id,
    variantId: defaultVariant.id,
  });

  const hydrated = await getImageById(image.id);
  if (!hydrated) throw new Error("Image not found after create");
  return hydrated;
}

export async function getImageById(id: string, userId?: string | null) {
  if (!isUuid(id)) return null;
  const result = await db
    .select()
    .from(images)
    .where(and(eq(images.id, id), isNull(images.deletedAt)))
    .limit(1);
  const row = result[0] ?? null;
  if (!row) return null;
  const userDefaultVariantId =
    userId && isUuid(userId)
      ? await getUserImageDefaultVariantId({ imageId: id, userId })
      : null;
  return hydrateImage({ image: row, userDefaultVariantId });
}

export async function getImageByIdIncludingArchived(
  id: string,
  userId?: string | null,
) {
  if (!isUuid(id)) return null;
  const result = await db
    .select()
    .from(images)
    .where(eq(images.id, id))
    .limit(1);
  const row = result[0] ?? null;
  if (!row) return null;
  const userDefaultVariantId =
    userId && isUuid(userId)
      ? await getUserImageDefaultVariantId({ imageId: id, userId })
      : null;
  return hydrateImage({ image: row, userDefaultVariantId });
}

export async function updateImage(
  id: string,
  input: {
    readonly name?: string;
    readonly description?: string;
  },
) {
  if (!isUuid(id)) return null;
  const [updated] = await db
    .update(images)
    .set({
      ...(typeof input.name === "string" ? { name: input.name } : {}),
      ...(typeof input.description === "string"
        ? { description: input.description }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(images.id, id), isNull(images.deletedAt)))
    .returning();
  if (!updated) return null;
  return getImageById(updated.id);
}

export async function archiveImage(id: string) {
  if (!isUuid(id)) return null;
  const [archived] = await db
    .update(images)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(images.id, id), isNull(images.deletedAt)))
    .returning();
  if (!archived) return null;
  return getImageByIdIncludingArchived(archived.id);
}

export async function unarchiveImage(id: string) {
  if (!isUuid(id)) return null;
  const [unarchived] = await db
    .update(images)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(images.id, id), isNotNull(images.deletedAt)))
    .returning();
  if (!unarchived) return null;
  return getImageById(unarchived.id);
}

export async function deleteImage(id: string) {
  if (!isUuid(id)) return false;
  const result = await db.delete(images).where(eq(images.id, id)).returning();
  const deleted = result.length > 0;
  if (deleted) {
    try {
      await deleteImageHookVolume(id);
    } catch (err) {
      log.warn(
        "Failed to delete shared image hook volume after image delete.",
        {
          imageId: id,
          err,
        },
      );
    }
  }
  return deleted;
}

export async function listImages(input: {
  readonly userId: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly archived?: boolean;
}) {
  const conditions = [
    input.archived ? isNotNull(images.deletedAt) : isNull(images.deletedAt),
  ];

  if (input.cursor) {
    conditions.push(lt(images.createdAt, new Date(input.cursor)));
  }

  const rows = await db
    .select()
    .from(images)
    .where(and(...conditions))
    .orderBy(desc(images.createdAt))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  if (hasMore) rows.pop();

  const userDefaultVariantIds = await listUserImageDefaultVariantIds({
    imageIds: rows.map((row) => row.id),
    userId: input.userId,
  });
  const hydrated = rows.map((row) =>
    hydrateImage({
      image: row,
      userDefaultVariantId: userDefaultVariantIds.get(row.id) ?? null,
    }),
  );

  return {
    images: hydrated,
    nextCursor: hasMore
      ? (hydrated[hydrated.length - 1]?.createdAt.toISOString() ?? null)
      : null,
  };
}

export async function cloneImage(input: {
  readonly sourceImageId: string;
  readonly clonedByUserId: string;
  readonly nameOverride?: string;
}) {
  const source = await getImageById(input.sourceImageId);
  if (!source) {
    throw new Error("Source image not found");
  }
  const sourceDefaultVariant =
    source.defaultVariantId != null
      ? await getImageVariantForImage({
          imageId: source.id,
          variantId: source.defaultVariantId,
        })
      : null;

  const [cloned] = await db
    .insert(images)
    .values({
      name: input.nameOverride ?? `${source.name} (Copy)`,
      description: source.description,
      visibility: "private",
      createdBy: input.clonedByUserId,
    })
    .returning();

  if (!cloned) throw new Error("Failed to clone image");

  const defaultVariant = await createDefaultImageVariantForImage({
    imageId: cloned.id,
    ownerUserId: input.clonedByUserId,
    activeImageId: sourceDefaultVariant?.activeImageId ?? null,
    draftImageId: sourceDefaultVariant?.draftImageId ?? null,
  });
  if (!defaultVariant) throw new Error("Failed to clone default variant");

  await setImageDefaultVariantId({
    imageId: cloned.id,
    variantId: defaultVariant.id,
  });

  try {
    await copyImageHookFiles({
      sourceImageId: input.sourceImageId,
      targetImageId: cloned.id,
    });
  } catch (err) {
    throw new Error(
      `Failed to clone shared image hooks: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const hydrated = await getImageById(cloned.id);
  if (!hydrated) throw new Error("Image not found after clone");
  return hydrated;
}

export async function runBuild(input: {
  readonly imageRecordId: string;
  readonly variantId: string;
  readonly userId: string;
  readonly onChunk?: (chunk: BuildChunk) => void;
}) {
  const image = await getImageById(input.imageRecordId);
  if (!image) {
    throw new Error("Image not found");
  }

  const variant = await getImageVariantForImage({
    imageId: input.imageRecordId,
    variantId: input.variantId,
  });
  if (!variant) {
    throw new Error("Image variant not found");
  }
  if (!canUserAccessImageVariant({ userId: input.userId, variant })) {
    throw new Error("Image variant not found");
  }
  if (
    !canUserMutateImageVariant({
      userId: input.userId,
      imageCreatedBy: image.createdBy ?? "",
      variant,
    })
  ) {
    throw new Error("Image variant is read-only");
  }

  const baseImageId = getVariantDraftImageId(variant);

  let environmentSecretRows = [] as Awaited<
    ReturnType<typeof listEnvironmentSecrets>
  >;
  try {
    environmentSecretRows = await listEnvironmentSecrets(input.imageRecordId);
  } catch (err) {
    log.warn(
      "Failed to load environment secret bindings; continuing without them.",
      {
        err,
      },
    );
    environmentSecretRows = [];
  }
  const environmentSecretNames = normalizeSecretNames(
    environmentSecretRows.map((secret) => secret.modalSecretName),
  );
  const buildHookDigest = await getImageBuildHookDigest(input.imageRecordId);

  const buildInputPayload = {
    imageId: input.imageRecordId,
    variantId: variant.id,
    baseImageId,
    environmentSecretNames,
    buildHookDigest,
  } as const;
  const inputHash = createHash("sha256")
    .update(JSON.stringify(buildInputPayload))
    .digest("hex");

  const build = await createImageVariantBuild({
    imageId: input.imageRecordId,
    variantId: variant.id,
    requestedByUserId: input.userId,
    status: "running",
    inputHash,
    inputPayload: buildInputPayload as unknown as Record<string, unknown>,
    logs: "",
  });
  if (!build) throw new Error("Failed to create variant build record");

  let buildLogs = "";
  const appendBuildChunk = (chunk: BuildChunk) => {
    if (!chunk.text) return;
    buildLogs += chunk.text;
  };

  try {
    const { builtImageId } = await runImageBuild({
      imageId: input.imageRecordId,
      environmentSecretNames,
      baseImageId,
      onChunk: (chunk) => {
        appendBuildChunk(chunk);
        input.onChunk?.(chunk);
      },
    });

    const updatedBuild = await updateImageVariantBuild({
      buildId: build.id,
      status: "succeeded",
      outputImageId: builtImageId,
      logs: buildLogs,
      errorMessage: null,
      finishedAt: new Date(),
    });
    if (!updatedBuild) {
      throw new Error("Failed to update build record");
    }

    const updatedVariant = await setImageVariantDraftImageId({
      variantId: variant.id,
      draftImageId: builtImageId,
    });
    if (!updatedVariant) throw new Error("Image variant not found after build");

    const latestImage = await getImageById(input.imageRecordId);
    if (!latestImage) throw new Error("Image not found after build");

    return {
      image: latestImage,
      variant: updatedVariant,
      builtImageId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateImageVariantBuild({
      buildId: build.id,
      status: "failed",
      logs: buildLogs,
      errorMessage: message,
      finishedAt: new Date(),
    });
    throw err;
  }
}
