import { readdir } from "node:fs/promises";
import { dirname, join, posix as pathPosix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull } from "drizzle-orm";
import { db, closeDb } from "../src/db";
import { globalSettings, images, imageVariants } from "../src/db/schema";
import { log } from "../src/log";
import { ModalVolumeClient } from "../src/clients/modal";
import { DEFAULT_VARIANT_IMAGE_REF } from "../src/services/image.service";
import { getImageSharedVolumeName } from "../src/services/image-volume";

const GLOBAL_SETTINGS_ID = "default";
const IMAGE_NAME = "Default Coordinator";
const IMAGE_DESCRIPTION =
  "Prebuilt default image for coordinator agents.";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COORDINATOR_SEED_DIR = join(__dirname, "..", "seeds", "coordinator");

async function listCoordinatorSeedEntries(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() || entry.isDirectory())
    .map((entry) => join(rootDir, entry.name))
    .sort();
}

async function listCoordinatorSyncEntries(rootDir: string): Promise<string[]> {
  const rootEntries = await listCoordinatorSeedEntries(rootDir);
  const syncEntries: string[] = [];

  for (const entryPath of rootEntries) {
    const nestedEntries = await listCoordinatorSeedEntries(entryPath).catch(() => null);
    if (nestedEntries == null) {
      syncEntries.push(entryPath);
      continue;
    }

    if (nestedEntries.length === 0) {
      syncEntries.push(entryPath);
      continue;
    }

    syncEntries.push(...nestedEntries);
  }

  return syncEntries.sort();
}

async function syncCoordinatorSeedVolume(imageId: string): Promise<void> {
  const volume = new ModalVolumeClient({
    volumeName: getImageSharedVolumeName(imageId),
  });
  const seedEntries = await listCoordinatorSyncEntries(COORDINATOR_SEED_DIR);

  for (const localPath of seedEntries) {
    const remotePath = pathPosix.join(
      "/",
      relative(COORDINATOR_SEED_DIR, localPath),
    );
    console.log(`Syncing ${remotePath}`);
    await volume.putFile({
      localPath,
      remotePath,
      overwrite: true,
    });
  }
}

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
      activeImageId: imageVariants.activeImageId,
      draftImageId: imageVariants.draftImageId,
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
      activeImageId: DEFAULT_VARIANT_IMAGE_REF,
      draftImageId: DEFAULT_VARIANT_IMAGE_REF,
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

async function ensureVariantActiveImageId(variantId: string) {
  const variant = await getVariant(variantId);
  if (variant?.activeImageId?.trim()) return variant.activeImageId.trim();

  await db
    .update(imageVariants)
    .set({
      activeImageId: DEFAULT_VARIANT_IMAGE_REF,
      draftImageId: variant?.draftImageId?.trim() || DEFAULT_VARIANT_IMAGE_REF,
      updatedAt: new Date(),
    })
    .where(eq(imageVariants.id, variantId));

  return DEFAULT_VARIANT_IMAGE_REF;
}

async function resolveDefaultCoordinatorImageTarget() {
  const current = await getCurrentDefaultImage();
  if (current && current.deletedAt == null && current.defaultVariantId) {
    return { imageId: current.id, variantId: current.defaultVariantId };
  }

  const reusable = await findReusableUnownedDefaultImage();
  if (reusable?.defaultVariantId != null) {
    return { imageId: reusable.id, variantId: reusable.defaultVariantId };
  }

  return await createDefaultCoordinatorImageRecord();
}

async function main() {
  await ensureGlobalSettingsRow();

  const target = await resolveDefaultCoordinatorImageTarget();

  const activeImageId = await ensureVariantActiveImageId(target.variantId);

  await db
    .update(globalSettings)
    .set({
      defaultCoordinatorImageId: target.imageId,
      updatedAt: new Date(),
    })
    .where(eq(globalSettings.id, GLOBAL_SETTINGS_ID));

  await syncCoordinatorSeedVolume(target.imageId);

  log.info("default_coordinator_image.ready", {
    imageId: target.imageId,
    variantId: target.variantId,
    activeImageId,
  });
  console.log(`Default coordinator image ready: ${target.imageId}`);
  console.log(`Default variant: ${target.variantId}`);
  console.log(`Active image id: ${activeImageId}`);
}

try {
  await main();
} finally {
  await closeDb();
}
