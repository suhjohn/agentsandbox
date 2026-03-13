import { access, readFile } from "node:fs/promises";
import { dirname, join, posix as pathPosix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull } from "drizzle-orm";
import { db, closeDb } from "../src/db";
import { globalSettings, images, imageVariants } from "../src/db/schema";
import { log } from "../src/log";
import { ModalVolumeClient } from "../src/clients/modal";
import { DEFAULT_VARIANT_IMAGE_REF } from "../src/services/image.service";
import { getImageSharedVolumeName } from "../src/services/image-volume";
import { formatCoordinatorSemanticActionIdBullets } from "../../shared/coordinator-actions-contract";
import { formatCoordinatorClientToolNameBullets } from "../../shared/coordinator-client-tools-contract";

const GLOBAL_SETTINGS_ID = "default";
const IMAGE_NAME = "Default Coordinator";
const IMAGE_DESCRIPTION =
  "Prebuilt default image for coordinator agents.";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COORDINATOR_SEED_DIR = join(__dirname, "..", "seeds", "coordinator");
const COORDINATOR_AGENTS_TEMPLATE_PATH = join(COORDINATOR_SEED_DIR, "AGENTS.md");
const COORDINATOR_TOOLS_DIR = join(COORDINATOR_SEED_DIR, "tools");
const COORDINATOR_CLIENT_TOOLS_START =
  "<!-- GENERATED:COORDINATOR_CLIENT_TOOLS_START -->";
const COORDINATOR_CLIENT_TOOLS_END =
  "<!-- GENERATED:COORDINATOR_CLIENT_TOOLS_END -->";
const COORDINATOR_ACTIONS_START =
  "<!-- GENERATED:COORDINATOR_ACTIONS_START -->";
const COORDINATOR_ACTIONS_END =
  "<!-- GENERATED:COORDINATOR_ACTIONS_END -->";

function replaceGeneratedSection(input: {
  readonly content: string;
  readonly startMarker: string;
  readonly endMarker: string;
  readonly replacement: string;
}): string {
  const startIndex = input.content.indexOf(input.startMarker);
  const endIndex = input.content.indexOf(input.endMarker);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error(
      `Missing generated section markers: ${input.startMarker} ... ${input.endMarker}`,
    );
  }

  const before = input.content.slice(0, startIndex + input.startMarker.length);
  const after = input.content.slice(endIndex);
  return `${before}\n\n${input.replacement}\n\n${after}`;
}

async function renderCoordinatorAgentsMarkdown(): Promise<string> {
  const template = await readFile(COORDINATOR_AGENTS_TEMPLATE_PATH, "utf8");
  const withClientTools = replaceGeneratedSection({
    content: template,
    startMarker: COORDINATOR_CLIENT_TOOLS_START,
    endMarker: COORDINATOR_CLIENT_TOOLS_END,
    replacement: formatCoordinatorClientToolNameBullets(),
  });
  return replaceGeneratedSection({
    content: withClientTools,
    startMarker: COORDINATOR_ACTIONS_START,
    endMarker: COORDINATOR_ACTIONS_END,
    replacement: formatCoordinatorSemanticActionIdBullets(),
  });
}

async function syncCoordinatorSeedVolume(imageId: string): Promise<void> {
  const volume = new ModalVolumeClient({
    volumeName: getImageSharedVolumeName(imageId),
  });

  await volume.putText({
    text: await renderCoordinatorAgentsMarkdown(),
    remotePath: "/AGENTS.md",
    overwrite: true,
  });

  try {
    await access(COORDINATOR_TOOLS_DIR);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }

  await volume.putFile({
    localPath: COORDINATOR_TOOLS_DIR,
    remotePath: pathPosix.join("/", "tools"),
    overwrite: true,
  });
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
