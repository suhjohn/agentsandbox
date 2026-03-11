ALTER TABLE "image_variants" ALTER COLUMN "head_image_id" SET DEFAULT 'ghcr.io/suhjohn/agentsandbox:latest';--> statement-breakpoint
ALTER TABLE "images" DROP COLUMN "setup_script";--> statement-breakpoint
ALTER TABLE "images" DROP COLUMN "run_script";