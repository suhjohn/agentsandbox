DO $$
BEGIN
  -- In some upgraded DBs, this index name may still be attached to "agents".
  IF EXISTS (
    SELECT 1
    FROM pg_class idx
    JOIN pg_namespace ns ON ns.oid = idx.relnamespace
    JOIN pg_index i ON i.indexrelid = idx.oid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    WHERE ns.nspname = 'public'
      AND idx.relname = 'sessions_status_idx'
      AND tbl.relname = 'agents'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_class idx
      JOIN pg_namespace ns ON ns.oid = idx.relnamespace
      WHERE ns.nspname = 'public'
        AND idx.relname = 'agents_status_idx'
    ) THEN
      EXECUTE 'DROP INDEX "public"."sessions_status_idx"';
    ELSE
      EXECUTE 'ALTER INDEX "public"."sessions_status_idx" RENAME TO "agents_status_idx"';
    END IF;
  END IF;
END
$$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "agent_id" uuid NOT NULL,
  "status" text DEFAULT 'initial' NOT NULL,
  "harness" text DEFAULT 'codex' NOT NULL,
  "external_session_id" text,
  "title" text,
  "first_user_message_body" text,
  "last_message_body" text,
  "model" text,
  "model_reasoning_effort" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sessions_agent_id_idx" ON "sessions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_status_idx" ON "sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_harness_idx" ON "sessions" USING btree ("harness");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_external_session_id_idx" ON "sessions" USING btree ("external_session_id");
