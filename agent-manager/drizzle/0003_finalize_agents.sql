DO $$
BEGIN
  -- If the legacy agent-app registry table still occupies the name "agents", move it out of the way.
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
  -- Ensure the legacy "sessions" table is renamed to the new canonical "agents" name.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'sessions'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'agents'
  ) THEN
    EXECUTE 'ALTER TABLE "sessions" RENAME TO "agents"';
  END IF;
END
$$;--> statement-breakpoint
