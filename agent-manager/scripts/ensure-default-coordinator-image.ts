import { and, eq, isNull } from "drizzle-orm";
import { db, closeDb } from "../src/db";
import { globalSettings, images, imageVariants } from "../src/db/schema";
import { log } from "../src/log";
import { DEFAULT_VARIANT_HEAD_IMAGE_REF } from "../src/services/image.service";

const GLOBAL_SETTINGS_ID = "default";
const IMAGE_NAME = "Default Coordinator";
const IMAGE_DESCRIPTION =
  "Prebuilt default image for coordinator agents.";

async function ensureGlobalSettingsRow() {
  await db
    .insert(globalSettings)
    .values({
      id: GLOBAL_SETTINGS_ID,
      diffignore: [],
      defaultCoordinatorImageId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
}

async function getCurrentDefaultImage() {
  const rows = await db
    .select({
      defaultCoordinatorImageId: globalSettings.defaultCoordinatorImageId,
    })
    .from(globalSettings)
    .where(eq(globalSettings.id, GLOBAL_SETTINGS_ID))
    .limit(1);
  const imageId = rows[0]?.defaultCoordinatorImageId ?? null;
  if (!imageId) return null;

  const existing = await db
    .select({
      id: images.id,
      defaultVariantId: images.defaultVariantId,
      deletedAt: images.deletedAt,
    })
    .from(images)
    .where(eq(images.id, imageId))
    .limit(1);
  return existing[0] ?? null;
}

async function getVariant(variantId: string | null) {
  if (!variantId) return null;
  const rows = await db
    .select({
      id: imageVariants.id,
      headImageId: imageVariants.headImageId,
    })
    .from(imageVariants)
    .where(eq(imageVariants.id, variantId))
    .limit(1);
  return rows[0] ?? null;
}

async function createDefaultCoordinatorImageRecord() {
  const [image] = await db
    .insert(images)
    .values({
      visibility: "public",
      name: IMAGE_NAME,
      description: IMAGE_DESCRIPTION,
      createdBy: null,
    })
    .returning({ id: images.id });
  if (!image) throw new Error("Failed to create default coordinator image");

  const [variant] = await db
    .insert(imageVariants)
    .values({
      imageId: image.id,
      name: "Default",
      scope: "shared",
      ownerUserId: null,
      headImageId: DEFAULT_VARIANT_HEAD_IMAGE_REF,
    })
    .returning({ id: imageVariants.id });
  if (!variant) throw new Error("Failed to create default image variant");

  await db
    .update(images)
    .set({
      defaultVariantId: variant.id,
      updatedAt: new Date(),
    })
    .where(eq(images.id, image.id));

  return { imageId: image.id, variantId: variant.id };
}

async function findReusableUnownedDefaultImage() {
  const rows = await db
    .select({
      id: images.id,
      defaultVariantId: images.defaultVariantId,
    })
    .from(images)
    .where(
      and(
        eq(images.name, IMAGE_NAME),
        isNull(images.createdBy),
        isNull(images.deletedAt),
      ),
    )
    .orderBy(images.createdAt);
  return rows[0] ?? null;
}

async function ensureVariantHeadImageId(variantId: string) {
  const variant = await getVariant(variantId);
  if (variant?.headImageId?.trim()) return variant.headImageId.trim();

  await db
    .update(imageVariants)
    .set({
      headImageId: DEFAULT_VARIANT_HEAD_IMAGE_REF,
      updatedAt: new Date(),
    })
    .where(eq(imageVariants.id, variantId));

  return DEFAULT_VARIANT_HEAD_IMAGE_REF;
}

async function main() {
  await ensureGlobalSettingsRow();

  const current = await getCurrentDefaultImage();
  if (current && current.deletedAt == null && current.defaultVariantId) {
    const headImageId = await ensureVariantHeadImageId(current.defaultVariantId);
    console.log(
      `Default coordinator image already configured: ${current.id} (${headImageId})`,
    );
    return;
  }

  const reusable = await findReusableUnownedDefaultImage();
  const target =
    reusable?.defaultVariantId != null
      ? { imageId: reusable.id, variantId: reusable.defaultVariantId }
      : await createDefaultCoordinatorImageRecord();

  const headImageId = await ensureVariantHeadImageId(target.variantId);

  await db
    .update(globalSettings)
    .set({
      defaultCoordinatorImageId: target.imageId,
      updatedAt: new Date(),
    })
    .where(eq(globalSettings.id, GLOBAL_SETTINGS_ID));

  log.info("default_coordinator_image.ready", {
    imageId: target.imageId,
    variantId: target.variantId,
    headImageId,
  });
  console.log(`Default coordinator image ready: ${target.imageId}`);
  console.log(`Default variant: ${target.variantId}`);
  console.log(`Head image id: ${headImageId}`);
}

try {
  await main();
} finally {
  await closeDb();
}
