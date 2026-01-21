CREATE TABLE "global_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"diffignore" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
