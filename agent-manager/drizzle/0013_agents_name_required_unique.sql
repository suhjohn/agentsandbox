UPDATE "agents"
SET "name" = btrim("name")
WHERE "name" IS NOT NULL;
--> statement-breakpoint
UPDATE "agents"
SET "name" = gen_random_uuid()::text
WHERE "name" IS NULL OR "name" = '';
--> statement-breakpoint
WITH duplicate_ids AS (
  SELECT a."id"
  FROM "agents" a
  JOIN (
    SELECT "name"
    FROM "agents"
    GROUP BY "name"
    HAVING COUNT(*) > 1
  ) dup ON dup."name" = a."name"
)
UPDATE "agents" a
SET "name" = gen_random_uuid()::text
FROM duplicate_ids d
WHERE a."id" = d."id";
--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "name" SET DEFAULT gen_random_uuid()::text;
--> statement-breakpoint
CREATE UNIQUE INDEX "agents_name_idx" ON "agents" USING btree ("name");
