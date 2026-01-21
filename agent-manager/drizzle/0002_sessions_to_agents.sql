DO $$
BEGIN
  -- Rename the pre-existing agent-app registry table (created in 0000_init.sql as "agents").
  -- Guard on the presence of agent_app-specific columns added in 0001_* so we don't accidentally
  -- rename the (new) "agents" table that comes from renaming "sessions".
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agents'
      AND column_name = 'agent_api_url'
  ) THEN
    EXECUTE 'ALTER TABLE "agents" RENAME TO "agent_apps"';
  END IF;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  -- Rename the session table to "agents" (the new canonical name).
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'sessions'
  ) THEN
    EXECUTE 'ALTER TABLE "sessions" RENAME TO "agents"';
  END IF;
END
$$;--> statement-breakpoint
