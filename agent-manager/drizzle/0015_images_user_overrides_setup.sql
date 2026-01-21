ALTER TABLE "images" RENAME COLUMN "image_build_script" TO "setup_script";
ALTER TABLE "images" ADD COLUMN IF NOT EXISTS "base_image_id" text;

CREATE TABLE IF NOT EXISTS "user_images" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "image_id" uuid NOT NULL,
  "base_image_id" text,
  "current_image_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  CONSTRAINT "user_images_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_images_user_id_image_id_idx" ON "user_images" USING btree ("user_id","image_id");
CREATE INDEX IF NOT EXISTS "user_images_user_id_idx" ON "user_images" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "user_images_image_id_idx" ON "user_images" USING btree ("image_id");
