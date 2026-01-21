CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_agent_id_trgm_idx"
  ON "sessions" USING gin (("agent_id"::text) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_id_trgm_idx"
  ON "sessions" USING gin ("id" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_external_session_id_trgm_idx"
  ON "sessions" USING gin ("external_session_id" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_title_trgm_idx"
  ON "sessions" USING gin ("title" gin_trgm_ops);
