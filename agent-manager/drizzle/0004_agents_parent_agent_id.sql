DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agents'
      AND column_name = 'parent_agent_id'
  ) THEN
    EXECUTE 'ALTER TABLE "agents" ADD COLUMN "parent_agent_id" uuid';
  END IF;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agents_parent_agent_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE "agents" ADD CONSTRAINT "agents_parent_agent_id_fkey" FOREIGN KEY ("parent_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL';
  END IF;
END
$$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agents_parent_agent_id_idx" ON "agents" ("parent_agent_id");
