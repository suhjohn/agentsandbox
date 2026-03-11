CREATE TABLE IF NOT EXISTS "global_settings" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "diffignore" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "global_settings"
ADD COLUMN IF NOT EXISTS "default_coordinator_image_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'global_settings_default_coordinator_image_id_images_id_fk'
  ) THEN
    ALTER TABLE "global_settings"
    ADD CONSTRAINT "global_settings_default_coordinator_image_id_images_id_fk"
    FOREIGN KEY ("default_coordinator_image_id") REFERENCES "public"."images"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
