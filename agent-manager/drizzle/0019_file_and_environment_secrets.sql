-- Rename image_secrets to file_secrets
ALTER TABLE "image_secrets" RENAME TO "file_secrets";
--> statement-breakpoint
-- Drop old constraints and indexes
ALTER TABLE "file_secrets" DROP CONSTRAINT IF EXISTS "image_secrets_image_id_images_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "image_secrets_image_id_path_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "image_secrets_image_id_idx";
--> statement-breakpoint
-- Make imageId nullable
ALTER TABLE "file_secrets" ALTER COLUMN "image_id" DROP NOT NULL;
--> statement-breakpoint
-- Add back the foreign key constraint with new name
ALTER TABLE "file_secrets" ADD CONSTRAINT "file_secrets_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Create new indexes with new names
CREATE UNIQUE INDEX "file_secrets_image_id_path_idx" ON "file_secrets" USING btree ("image_id","path");
--> statement-breakpoint
CREATE INDEX "file_secrets_image_id_idx" ON "file_secrets" USING btree ("image_id");
--> statement-breakpoint
-- Create environment_secrets table
CREATE TABLE "environment_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_id" uuid,
	"modal_secret_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Add foreign key for environment_secrets
ALTER TABLE "environment_secrets" ADD CONSTRAINT "environment_secrets_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Create indexes for environment_secrets
CREATE UNIQUE INDEX "environment_secrets_image_id_name_idx" ON "environment_secrets" USING btree ("image_id","modal_secret_name");
--> statement-breakpoint
CREATE INDEX "environment_secrets_image_id_idx" ON "environment_secrets" USING btree ("image_id");
