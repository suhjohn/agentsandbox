ALTER TABLE "sessions" ADD COLUMN "created_by" text;--> statement-breakpoint
UPDATE "sessions" AS s
SET "created_by" = COALESCE(a."created_by"::text, 'unknown')
FROM "agents" AS a
WHERE s."agent_id" = a."id";--> statement-breakpoint
UPDATE "sessions"
SET "created_by" = 'unknown'
WHERE "created_by" IS NULL OR btrim("created_by") = '';--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_created_by_idx" ON "sessions" USING btree ("created_by");
