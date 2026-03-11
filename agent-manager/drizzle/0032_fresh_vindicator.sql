ALTER TABLE "image_variants" RENAME COLUMN "head_image_id" TO "active_image_id";--> statement-breakpoint
ALTER TABLE "image_variants" ADD COLUMN "draft_image_id" text;--> statement-breakpoint
UPDATE "image_variants" SET "draft_image_id" = "active_image_id" WHERE "draft_image_id" IS NULL;--> statement-breakpoint
ALTER TABLE "image_variants" ALTER COLUMN "draft_image_id" SET DEFAULT 'ghcr.io/suhjohn/agentsandbox:latest';--> statement-breakpoint
ALTER TABLE "image_variants" ALTER COLUMN "draft_image_id" SET NOT NULL;
