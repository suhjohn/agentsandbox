ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "workspace_keybindings" jsonb;

ALTER TABLE "users"
ALTER COLUMN "workspace_keybindings" DROP DEFAULT;

ALTER TABLE "users"
ALTER COLUMN "workspace_keybindings" DROP NOT NULL;

UPDATE "users"
SET "workspace_keybindings" = NULL
WHERE "workspace_keybindings" = '{}'::jsonb;
