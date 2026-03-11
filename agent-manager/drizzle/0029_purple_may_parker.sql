ALTER TABLE "image_variants"
  ADD COLUMN IF NOT EXISTS "head_image_id" text;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_variants'
      AND column_name = 'head_build_id'
  ) THEN
    EXECUTE $sql$
      UPDATE "image_variants" AS v
      SET "head_image_id" = b."output_image_id"
      FROM "image_variant_builds" AS b
      WHERE v."head_build_id" = b."id"
        AND b."output_image_id" IS NOT NULL
        AND btrim(b."output_image_id") <> ''
    $sql$;
  END IF;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_variants'
      AND column_name = 'base_image_id'
  ) THEN
    EXECUTE $sql$
      UPDATE "image_variants"
      SET "head_image_id" = "base_image_id"
      WHERE ("head_image_id" IS NULL OR btrim("head_image_id") = '')
        AND "base_image_id" IS NOT NULL
        AND btrim("base_image_id") <> ''
    $sql$;
  END IF;
END
$$;--> statement-breakpoint

UPDATE "image_variants"
SET "head_image_id" = 'suhjohn/agentdesktop'
WHERE "head_image_id" IS NULL
   OR btrim("head_image_id") = '';--> statement-breakpoint

ALTER TABLE "image_variants"
  ALTER COLUMN "head_image_id" SET DEFAULT 'suhjohn/agentdesktop';--> statement-breakpoint

ALTER TABLE "image_variants"
  ALTER COLUMN "head_image_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "image_variants" DROP COLUMN IF EXISTS "base_image_id";--> statement-breakpoint
ALTER TABLE "image_variants" DROP COLUMN IF EXISTS "head_build_id";
