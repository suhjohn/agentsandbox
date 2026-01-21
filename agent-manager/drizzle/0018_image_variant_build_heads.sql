CREATE TABLE IF NOT EXISTS "image_variant_builds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "image_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "requested_by_user_id" uuid NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "input_hash" text NOT NULL,
  "input_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "logs" text DEFAULT '' NOT NULL,
  "output_image_id" text,
  "error_message" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "image_variant_builds_image_id_images_id_fk"
    FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade,
  CONSTRAINT "image_variant_builds_variant_id_image_variants_id_fk"
    FOREIGN KEY ("variant_id") REFERENCES "public"."image_variants"("id") ON DELETE cascade,
  CONSTRAINT "image_variant_builds_requested_by_user_id_users_id_fk"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "image_variant_builds_image_id_idx"
  ON "image_variant_builds" USING btree ("image_id");
CREATE INDEX IF NOT EXISTS "image_variant_builds_variant_id_idx"
  ON "image_variant_builds" USING btree ("variant_id");
CREATE INDEX IF NOT EXISTS "image_variant_builds_requested_by_user_id_idx"
  ON "image_variant_builds" USING btree ("requested_by_user_id");
CREATE INDEX IF NOT EXISTS "image_variant_builds_status_idx"
  ON "image_variant_builds" USING btree ("status");
CREATE INDEX IF NOT EXISTS "image_variant_builds_started_at_idx"
  ON "image_variant_builds" USING btree ("started_at");

ALTER TABLE "image_variants" ADD COLUMN IF NOT EXISTS "head_build_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'image_variants_head_build_id_image_variant_builds_id_fk'
  ) THEN
    ALTER TABLE "image_variants"
      ADD CONSTRAINT "image_variants_head_build_id_image_variant_builds_id_fk"
      FOREIGN KEY ("head_build_id") REFERENCES "public"."image_variant_builds"("id") ON DELETE set null;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "image_variants_image_owner_name_idx"
  ON "image_variants" USING btree ("image_id", "owner_user_id", "name");

WITH inserted_builds AS (
  INSERT INTO "image_variant_builds" (
    "id",
    "image_id",
    "variant_id",
    "requested_by_user_id",
    "status",
    "input_hash",
    "input_payload",
    "logs",
    "output_image_id",
    "error_message",
    "started_at",
    "finished_at",
    "created_at",
    "updated_at"
  )
  SELECT
    gen_random_uuid(),
    v."image_id",
    v."id",
    COALESCE(v."owner_user_id", i."created_by"),
    'succeeded',
    'legacy-current-image-id-migration',
    jsonb_build_object('source', 'legacy-current-image-id-migration'),
    '',
    v."current_image_id",
    NULL,
    COALESCE(v."updated_at", now()),
    COALESCE(v."updated_at", now()),
    now(),
    now()
  FROM "image_variants" v
  INNER JOIN "images" i ON i."id" = v."image_id"
  WHERE v."head_build_id" IS NULL
    AND v."current_image_id" IS NOT NULL
    AND btrim(v."current_image_id") <> ''
  RETURNING "id", "variant_id"
)
UPDATE "image_variants" v
SET "head_build_id" = b."id",
    "updated_at" = now()
FROM inserted_builds b
WHERE v."id" = b."variant_id"
  AND v."head_build_id" IS NULL;

ALTER TABLE "image_variants" DROP COLUMN IF EXISTS "current_image_id";
DROP TABLE IF EXISTS "user_image_variant_defaults";
