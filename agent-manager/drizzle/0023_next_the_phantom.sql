ALTER TABLE "agents" DROP CONSTRAINT "agents_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "coordinator_sessions" DROP CONSTRAINT "coordinator_sessions_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "image_variant_builds" DROP CONSTRAINT "image_variant_builds_requested_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "image_variants" DROP CONSTRAINT "image_variants_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "images" DROP CONSTRAINT "images_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "coordinator_sessions" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "image_variant_builds" ALTER COLUMN "requested_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_sessions" ADD CONSTRAINT "coordinator_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_variant_builds" ADD CONSTRAINT "image_variant_builds_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_variants" ADD CONSTRAINT "image_variants_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;