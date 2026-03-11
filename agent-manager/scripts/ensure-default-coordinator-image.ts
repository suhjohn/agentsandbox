import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, closeDb } from "../src/db";
import {
  globalSettings,
  images,
  imageVariants,
  imageVariantBuilds,
} from "../src/db/schema";
import { runModalImageBuild, type BuildChunk } from "../src/services/build";
import { log } from "../src/log";

const GLOBAL_SETTINGS_ID = "default";
const IMAGE_NAME = "Default Coordinator";
const IMAGE_DESCRIPTION =
  "Prebuilt default image for coordinator agents. No setup script. No run script.";

function buildInputHash(input: {
  readonly imageId: string;
  readonly variantId: string;
  readonly setupScript: string;
  readonly baseImageId: string | null;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        imageId: input.imageId,
        variantId: input.variantId,
        setupScript: input.setupScript,
        baseImageId: input.baseImageId,
        fileSecrets: [],
        environmentSecretNames: [],
      }),
    )
    .digest("hex");
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

async function getVariantWithHeadImage(variantId: string | null) {
  if (!variantId) return null;
  const rows = await db
    .select({
      id: imageVariants.id,
      headBuildId: imageVariants.headBuildId,
      headImageId: imageVariantBuilds.outputImageId,
    })
    .from(imageVariants)
    .leftJoin(
      imageVariantBuilds,
      eq(imageVariantBuilds.id, imageVariants.headBuildId),
    )
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
      setupScript: null,
      runScript: null,
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
      baseImageId: null,
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

async function buildDefaultCoordinatorImage(input: {
  readonly imageId: string;
  readonly variantId: string;
}) {
  let logs = "";
  const onChunk = (chunk: BuildChunk) => {
    if (!chunk.text) return;
    logs += chunk.text;
    process.stdout.write(chunk.text);
  };

  const inputHash = buildInputHash({
    imageId: input.imageId,
    variantId: input.variantId,
    setupScript: "",
    baseImageId: null,
  });

  const [build] = await db
    .insert(imageVariantBuilds)
    .values({
      imageId: input.imageId,
      variantId: input.variantId,
      requestedByUserId: null,
      status: "running",
      inputHash,
      inputPayload: {
        imageId: input.imageId,
        variantId: input.variantId,
        setupScript: "",
        baseImageId: null,
        fileSecrets: [],
        environmentSecretNames: [],
      },
      logs: "",
      outputImageId: null,
      errorMessage: null,
      finishedAt: null,
    })
    .returning({ id: imageVariantBuilds.id });
  if (!build) throw new Error("Failed to create default image build row");

  try {
    const { builtImageId } = await runModalImageBuild({
      imageId: input.imageId,
      setupScript: "",
      fileSecrets: [],
      environmentSecretNames: [],
      baseImageId: null,
      onChunk,
    });

    await db
      .update(imageVariantBuilds)
      .set({
        status: "succeeded",
        logs,
        outputImageId: builtImageId,
        errorMessage: null,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(imageVariantBuilds.id, build.id));

    await db
      .update(imageVariants)
      .set({
        headBuildId: build.id,
        updatedAt: new Date(),
      })
      .where(eq(imageVariants.id, input.variantId));

    return builtImageId;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    await db
      .update(imageVariantBuilds)
      .set({
        status: "failed",
        logs,
        errorMessage,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(imageVariantBuilds.id, build.id));
    throw error;
  }
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

async function main() {
  await ensureGlobalSettingsRow();

  const current = await getCurrentDefaultImage();
  if (current && current.deletedAt == null) {
    const variant = await getVariantWithHeadImage(current.defaultVariantId);
    if (variant?.headImageId) {
      console.log(
        `Default coordinator image already configured: ${current.id} (${variant.headImageId})`,
      );
      return;
    }
  }

  const reusable = await findReusableUnownedDefaultImage();
  const target =
    reusable?.defaultVariantId != null
      ? { imageId: reusable.id, variantId: reusable.defaultVariantId }
      : await createDefaultCoordinatorImageRecord();

  const currentVariant = await getVariantWithHeadImage(target.variantId);
  const builtImageId =
    currentVariant?.headImageId ??
    (await buildDefaultCoordinatorImage({
      imageId: target.imageId,
      variantId: target.variantId,
    }));

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
    builtImageId,
  });
  console.log(`Default coordinator image ready: ${target.imageId}`);
  console.log(`Default variant: ${target.variantId}`);
  console.log(`Built image id: ${builtImageId}`);
}

try {
  await main();
} finally {
  await closeDb();
}
