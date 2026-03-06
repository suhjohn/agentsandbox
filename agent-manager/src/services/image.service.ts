import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  lt,
  type SQL,
} from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db";
import {
  environmentSecrets,
  fileSecrets,
  imageVariantBuilds,
  images,
  imageVariants,
} from "../db/schema";
import { log } from "../log";
import { runModalImageBuild, type BuildChunk } from "./build";

// ── Shared helpers ──────────────────────────────────────────────────

const DEFAULT_SETUP_SCRIPT = [
  "set -euo pipefail",
  ": # no-op setup script",
  "",
].join("\n");

function resolveSetupScript(setupScript: string | null): string {
  if (typeof setupScript === "string" && setupScript.trim().length > 0) {
    return setupScript;
  }
  return DEFAULT_SETUP_SCRIPT;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function hydrateImage(input: { readonly image: typeof images.$inferSelect }) {
  return { ...input.image };
}

// ── Types ───────────────────────────────────────────────────────────

export type ImageVariantScope = "shared" | "private";
export type ImageVariantBuildStatus = "running" | "succeeded" | "failed";

export type ImageVariantWithHead = typeof imageVariants.$inferSelect & {
  readonly headImageId: string | null;
};

// ── File Secrets ────────────────────────────────────────────────────

export async function listFileSecrets(imageId: string | null) {
  if (imageId !== null && !isUuid(imageId)) return [];
  const condition =
    imageId === null
      ? isNull(fileSecrets.imageId)
      : eq(fileSecrets.imageId, imageId);
  return db.select().from(fileSecrets).where(condition).orderBy(fileSecrets.path);
}

export async function upsertFileSecret(input: {
  readonly imageId: string | null;
  readonly path: string;
  readonly modalSecretName: string;
}) {
  if (input.imageId !== null && !isUuid(input.imageId)) return null;

  const trimmedPath = input.path.trim();
  const trimmedSecretName = input.modalSecretName.trim();
  if (trimmedPath.length === 0) throw new Error("path must be non-empty");
  if (trimmedSecretName.length === 0)
    throw new Error("modalSecretName must be non-empty");

  const [row] = await db
    .insert(fileSecrets)
    .values({
      imageId: input.imageId,
      path: trimmedPath,
      modalSecretName: trimmedSecretName,
    })
    .onConflictDoUpdate({
      target: [fileSecrets.imageId, fileSecrets.path],
      set: { modalSecretName: trimmedSecretName, updatedAt: new Date() },
    })
    .returning();

  return row ?? null;
}

export async function deleteFileSecret(input: {
  readonly imageId: string | null;
  readonly fileSecretId: string;
}): Promise<boolean> {
  if (input.imageId !== null && !isUuid(input.imageId)) return false;
  if (!isUuid(input.fileSecretId)) return false;

  const imageCondition =
    input.imageId === null
      ? isNull(fileSecrets.imageId)
      : eq(fileSecrets.imageId, input.imageId);

  const result = await db
    .delete(fileSecrets)
    .where(and(eq(fileSecrets.id, input.fileSecretId), imageCondition))
    .returning();
  return result.length > 0;
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
  baseImageId: imageVariants.baseImageId,
  headBuildId: imageVariants.headBuildId,
  headImageId: imageVariantBuilds.outputImageId,
  createdAt: imageVariants.createdAt,
  updatedAt: imageVariants.updatedAt,
};

async function getImageVariantByFilter(where: SQL<unknown>) {
  const rows = await db
    .select(IMAGE_VARIANT_SELECT)
    .from(imageVariants)
    .leftJoin(imageVariantBuilds, eq(imageVariants.headBuildId, imageVariantBuilds.id))
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
    .leftJoin(imageVariantBuilds, eq(imageVariants.headBuildId, imageVariantBuilds.id))
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
  if (input.userId === input.imageCreatedBy) return true;
  if (input.variant.scope !== "private") return false;
  return input.variant.ownerUserId === input.userId;
}

export async function createImageVariant(input: {
  readonly imageId: string;
  readonly name?: string;
  readonly scope: ImageVariantScope;
  readonly ownerUserId?: string | null;
  readonly baseImageId?: string | null;
}) {
  if (!isUuid(input.imageId)) return null;
  const name = (input.name ?? "").trim();
  const [created] = await db
    .insert(imageVariants)
    .values({
      imageId: input.imageId,
      name: name.length > 0 ? name : "Variant",
      scope: input.scope,
      ownerUserId: input.scope === "private" ? input.ownerUserId ?? null : null,
      baseImageId: normalizeNullableText(input.baseImageId),
    })
    .returning({ id: imageVariants.id });
  if (!created) return null;
  return getImageVariantById(created.id);
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
  readonly baseImageId?: string | null;
  readonly headImageId?: string | null;
}) {
  const created = await createImageVariant({
    imageId: input.imageId,
    name: "Default",
    scope: "shared",
    ownerUserId: input.ownerUserId,
    baseImageId: input.baseImageId,
  });
  if (!created) return null;

  const headImageId = normalizeNullableText(input.headImageId);
  if (!headImageId) return created;

  const build = await createImageVariantBuild({
    imageId: input.imageId,
    variantId: created.id,
    requestedByUserId: input.ownerUserId,
    status: "succeeded",
    inputHash: "cloned",
    inputPayload: { source: "clone" },
    outputImageId: headImageId,
    logs: "",
    errorMessage: null,
    finishedAt: new Date(),
  });
  if (!build) return null;
  await setImageVariantHeadBuildId({
    variantId: created.id,
    headBuildId: build.id,
  });
  return getImageVariantById(created.id);
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
  return getDefaultImageVariantForImage(input.imageId);
}

export async function setImageVariantBaseImageId(input: {
  readonly variantId: string;
  readonly baseImageId: string | null;
}) {
  if (!isUuid(input.variantId)) return null;
  const [updated] = await db
    .update(imageVariants)
    .set({
      baseImageId: normalizeNullableText(input.baseImageId),
      updatedAt: new Date(),
    })
    .where(eq(imageVariants.id, input.variantId))
    .returning({ id: imageVariants.id });
  if (!updated) return null;
  return getImageVariantById(updated.id);
}

export async function setImageVariantHeadBuildId(input: {
  readonly variantId: string;
  readonly headBuildId: string | null;
}) {
  if (!isUuid(input.variantId)) return null;
  if (input.headBuildId !== null && !isUuid(input.headBuildId)) return null;
  const [updated] = await db
    .update(imageVariants)
    .set({
      headBuildId: input.headBuildId,
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
  if (!isUuid(input.imageId) || !isUuid(input.variantId) || !isUuid(input.requestedByUserId)) {
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
  const limit = typeof input.limit === "number" ? Math.max(1, Math.min(200, input.limit)) : 50;
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
  readonly setupScript?: string;
  readonly baseImageId?: string | null;
  readonly createdBy: string;
}) {
  const [image] = await db
    .insert(images)
    .values({
      name: input.name,
      description: input.description,
      setupScript: normalizeNullableText(input.setupScript),
      createdBy: input.createdBy,
    })
    .returning();

  if (!image) throw new Error("Failed to create image");

  const defaultVariant = await createDefaultImageVariantForImage({
    imageId: image.id,
    ownerUserId: input.createdBy,
    baseImageId: input.baseImageId,
  });
  if (!defaultVariant) throw new Error("Failed to create default image variant");

  await setImageDefaultVariantId({
    imageId: image.id,
    variantId: defaultVariant.id,
  });

  const hydrated = await getImageById(image.id);
  if (!hydrated) throw new Error("Image not found after create");
  return hydrated;
}

export async function getImageById(id: string) {
  if (!isUuid(id)) return null;
  const result = await db
    .select()
    .from(images)
    .where(and(eq(images.id, id), isNull(images.deletedAt)))
    .limit(1);
  const row = result[0] ?? null;
  if (!row) return null;
  return hydrateImage({ image: row });
}

export async function getImageByIdIncludingArchived(id: string) {
  if (!isUuid(id)) return null;
  const result = await db
    .select()
    .from(images)
    .where(eq(images.id, id))
    .limit(1);
  const row = result[0] ?? null;
  if (!row) return null;
  return hydrateImage({ image: row });
}

export async function updateImage(
  id: string,
  input: {
    readonly name?: string;
    readonly description?: string;
    readonly setupScript?: string | null;
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
      ...(Object.prototype.hasOwnProperty.call(input, "setupScript")
        ? { setupScript: normalizeNullableText(input.setupScript) }
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
  return result.length > 0;
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

  const hydrated = rows.map((row) => hydrateImage({ image: row }));

  return {
    images: hydrated,
    nextCursor: hasMore
      ? hydrated[hydrated.length - 1]?.createdAt.toISOString() ?? null
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
      setupScript: source.setupScript,
      createdBy: input.clonedByUserId,
    })
    .returning();

  if (!cloned) throw new Error("Failed to clone image");

  const defaultVariant = await createDefaultImageVariantForImage({
    imageId: cloned.id,
    ownerUserId: input.clonedByUserId,
    baseImageId: sourceDefaultVariant?.baseImageId ?? null,
    headImageId: sourceDefaultVariant?.headImageId ?? null,
  });
  if (!defaultVariant) throw new Error("Failed to clone default variant");

  await setImageDefaultVariantId({
    imageId: cloned.id,
    variantId: defaultVariant.id,
  });

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

  const setupScript = resolveSetupScript(image.setupScript ?? null);
  const baseImageId = normalizeNullableText(variant.baseImageId);

  let fileSecretRows = [] as Awaited<ReturnType<typeof listFileSecrets>>;
  try {
    fileSecretRows = await listFileSecrets(input.imageRecordId);
  } catch (err) {
    log.warn("Failed to load file secret bindings; continuing without them.", {
      err,
    });
    fileSecretRows = [];
  }
  const fileSecretsForBuild = fileSecretRows.map((secret) => ({
    path: secret.path,
    modalSecretName: secret.modalSecretName,
  }));

  let environmentSecretRows =
    [] as Awaited<ReturnType<typeof listEnvironmentSecrets>>;
  try {
    environmentSecretRows = await listEnvironmentSecrets(input.imageRecordId);
  } catch (err) {
    log.warn("Failed to load environment secret bindings; continuing without them.", {
      err,
    });
    environmentSecretRows = [];
  }
  const environmentSecretNames = normalizeSecretNames(
    environmentSecretRows.map((secret) => secret.modalSecretName),
  );

  const buildInputPayload = {
    imageId: input.imageRecordId,
    variantId: variant.id,
    setupScript,
    baseImageId,
    fileSecrets: fileSecretsForBuild,
    environmentSecretNames,
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
    const { builtImageId } = await runModalImageBuild({
      imageId: input.imageRecordId,
      setupScript,
      fileSecrets: fileSecretsForBuild,
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

    const updatedVariant = await setImageVariantHeadBuildId({
      variantId: variant.id,
      headBuildId: build.id,
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
