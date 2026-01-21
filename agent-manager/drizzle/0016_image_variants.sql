CREATE TABLE IF NOT EXISTS "image_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text DEFAULT 'Default' NOT NULL,
  "scope" text DEFAULT 'shared' NOT NULL,
  "image_id" uuid NOT NULL,
  "owner_user_id" uuid,
  "base_image_id" text,
  "current_image_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "image_variants_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade,
  CONSTRAINT "image_variants_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade
);

ALTER TABLE "images" ADD COLUMN IF NOT EXISTS "default_variant_id" uuid;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "image_variant_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'images_default_variant_id_image_variants_id_fk'
  ) THEN
    ALTER TABLE "images"
      ADD CONSTRAINT "images_default_variant_id_image_variants_id_fk"
      FOREIGN KEY ("default_variant_id") REFERENCES "public"."image_variants"("id") ON DELETE set null;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agents_image_variant_id_image_variants_id_fk'
  ) THEN
    ALTER TABLE "agents"
      ADD CONSTRAINT "agents_image_variant_id_image_variants_id_fk"
      FOREIGN KEY ("image_variant_id") REFERENCES "public"."image_variants"("id") ON DELETE set null;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "image_variants_image_id_idx" ON "image_variants" USING btree ("image_id");
CREATE INDEX IF NOT EXISTS "image_variants_owner_user_id_idx" ON "image_variants" USING btree ("owner_user_id");
CREATE INDEX IF NOT EXISTS "image_variants_scope_idx" ON "image_variants" USING btree ("scope");
CREATE INDEX IF NOT EXISTS "agents_image_variant_idx" ON "agents" USING btree ("image_variant_id");

WITH created_default_variants AS (
  INSERT INTO "image_variants" (
    "id",
    "name",
    "scope",
    "image_id",
    "owner_user_id",
    "base_image_id",
    "current_image_id",
    "created_at",
    "updated_at"
  )
  SELECT
    gen_random_uuid(),
    'Default',
    'shared',
    i."id",
    i."created_by",
    i."base_image_id",
    i."current_image_id",
    now(),
    now()
  FROM "images" i
  WHERE i."deleted_at" IS NULL
    AND i."default_variant_id" IS NULL
  RETURNING "id", "image_id"
)
UPDATE "images" i
SET "default_variant_id" = c."id",
    "updated_at" = now()
FROM created_default_variants c
WHERE i."id" = c."image_id"
  AND i."default_variant_id" IS NULL;

UPDATE "agents" a
SET "image_variant_id" = i."default_variant_id",
    "updated_at" = now()
FROM "images" i
WHERE a."image_id" = i."id"
  AND a."image_variant_id" IS NULL
  AND i."default_variant_id" IS NOT NULL;

DROP TABLE IF EXISTS "user_images";
ALTER TABLE "images" DROP COLUMN IF EXISTS "base_image_id";
ALTER TABLE "images" DROP COLUMN IF EXISTS "current_image_id";
