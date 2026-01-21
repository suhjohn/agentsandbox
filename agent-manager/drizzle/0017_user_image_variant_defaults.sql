CREATE TABLE IF NOT EXISTS "user_image_variant_defaults" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "image_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_image_variant_defaults_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  CONSTRAINT "user_image_variant_defaults_image_id_images_id_fk"
    FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade,
  CONSTRAINT "user_image_variant_defaults_variant_id_image_variants_id_fk"
    FOREIGN KEY ("variant_id") REFERENCES "public"."image_variants"("id") ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_image_variant_defaults_user_image_idx"
  ON "user_image_variant_defaults" USING btree ("user_id", "image_id");
CREATE INDEX IF NOT EXISTS "user_image_variant_defaults_user_id_idx"
  ON "user_image_variant_defaults" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "user_image_variant_defaults_image_id_idx"
  ON "user_image_variant_defaults" USING btree ("image_id");
CREATE INDEX IF NOT EXISTS "user_image_variant_defaults_variant_id_idx"
  ON "user_image_variant_defaults" USING btree ("variant_id");
