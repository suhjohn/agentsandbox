ALTER TABLE "agents" RENAME COLUMN "snapshot_image_id" TO "modal_image_id";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "modal_app_name" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "agent_api_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_modal_app_name_idx" ON "agents" USING btree ("modal_app_name");