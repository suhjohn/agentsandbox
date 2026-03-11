ALTER TABLE "agents"
  ADD COLUMN "type" text NOT NULL DEFAULT 'worker',
  ADD COLUMN "visibility" text NOT NULL DEFAULT 'private';

CREATE INDEX "agents_type_idx" ON "agents" ("type");
CREATE INDEX "agents_visibility_idx" ON "agents" ("visibility");
