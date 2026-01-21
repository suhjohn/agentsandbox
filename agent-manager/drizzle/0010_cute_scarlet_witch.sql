ALTER TABLE "sessions" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_is_archived_idx" ON "sessions" USING btree ("is_archived");