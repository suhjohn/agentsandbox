import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  uniqueIndex,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type {
  Visibility,
  AgentStatus,
  MessageRole,
} from "./enums";

// ── Users ───────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    githubId: text("github_id"),
    avatar: text("avatar"),
    defaultRegion: text("default_region").notNull().default("us-west-2"),
    workspaceKeybindings: jsonb("workspace_keybindings")
      .$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    uniqueIndex("users_github_id_idx").on(table.githubId),
  ],
);

export const globalSettings = pgTable("global_settings", {
  id: text("id").primaryKey().notNull().default("default"),
  diffignore: jsonb("diffignore")
    .$type<readonly string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── Images ──────────────────────────────────────────────────────────────────

export const images = pgTable(
  "images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    visibility: text("visibility")
      .$type<Visibility>()
      .notNull()
      .default("private"),
    name: text("name").default(sql`gen_random_uuid()::text`).notNull(),
    description: text("description"),
    setupScript: text("setup_script"),
    runScript: text("run_script"),
    defaultVariantId: uuid("default_variant_id"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("images_visibility_idx").on(table.visibility),
    index("images_created_by_idx").on(table.createdBy),
  ],
);

// ── Image Variants ──────────────────────────────────────────────────────────

export const imageVariants = pgTable(
  "image_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().default("Default"),
    scope: text("scope").notNull().default("shared"),
    imageId: uuid("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    baseImageId: text("base_image_id"),
    headBuildId: uuid("head_build_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("image_variants_image_id_idx").on(table.imageId),
    index("image_variants_owner_user_id_idx").on(table.ownerUserId),
    index("image_variants_scope_idx").on(table.scope),
    uniqueIndex("image_variants_image_owner_name_idx").on(
      table.imageId,
      table.ownerUserId,
      table.name,
    ),
  ],
);

// ── Image Variant Builds (append-only build history) ────────────────────────

export const imageVariantBuilds = pgTable(
  "image_variant_builds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    imageId: uuid("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => imageVariants.id, { onDelete: "cascade" }),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("running"),
    inputHash: text("input_hash").notNull(),
    inputPayload: jsonb("input_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    logs: text("logs").notNull().default(""),
    outputImageId: text("output_image_id"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("image_variant_builds_image_id_idx").on(table.imageId),
    index("image_variant_builds_variant_id_idx").on(table.variantId),
    index("image_variant_builds_requested_by_user_id_idx").on(
      table.requestedByUserId,
    ),
    index("image_variant_builds_status_idx").on(table.status),
    index("image_variant_builds_started_at_idx").on(table.startedAt),
  ],
);

// ── File Secrets (per-path secret bindings, loaded as exact files) ──────────

export const fileSecrets = pgTable(
  "file_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    imageId: uuid("image_id").references(() => images.id, {
      onDelete: "cascade",
    }),
    path: text("path").notNull(),
    modalSecretName: text("modal_secret_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("file_secrets_image_id_path_idx").on(table.imageId, table.path),
    index("file_secrets_image_id_idx").on(table.imageId),
  ],
);

// ── Environment Secrets (loaded into entire environment) ───────────────────

export const environmentSecrets = pgTable(
  "environment_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    imageId: uuid("image_id").references(() => images.id, {
      onDelete: "cascade",
    }),
    modalSecretName: text("modal_secret_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("environment_secrets_image_id_name_idx").on(
      table.imageId,
      table.modalSecretName,
    ),
    index("environment_secrets_image_id_idx").on(table.imageId),
  ],
);

// ── Agents ──────────────────────────────────────────────────────────────────

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").default(sql`gen_random_uuid()::text`).notNull(),
    parentAgentId: uuid("parent_agent_id"),
    imageId: uuid("image_id").references(() => images.id, {
      onDelete: "set null",
    }),
    imageVariantId: uuid("image_variant_id").references(() => imageVariants.id, {
      onDelete: "set null",
    }),
    currentSandboxId: text("current_sandbox_id"),
    sandboxName: text("sandbox_name"),
    snapshotImageId: text("snapshot_image_id"),
    sandboxAccessToken: text("sandbox_access_token"),
    runtimeInternalSecret: text("runtime_internal_secret"),
    region: text("region").default("us-west-2"),
    status: text("status").$type<AgentStatus>().notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agents_name_idx").on(table.name),
    index("agents_image_idx").on(table.imageId),
    index("agents_image_variant_idx").on(table.imageVariantId),
    index("agents_parent_agent_id_idx").on(table.parentAgentId),
    index("agents_status_idx").on(table.status),
    index("agents_created_by_idx").on(table.createdBy),
  ],
);

// ── Sessions ────────────────────────────────────────────────────────────────

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    agentId: uuid("agent_id").notNull(),
    createdBy: text("created_by").notNull(),
    // Cosmetic only. Suggested values: initial | processing | blocked | completed.
    status: text("status").notNull().default("initial"),
    isArchived: boolean("is_archived").notNull().default(false),
    harness: text("harness").notNull().default("codex"),
    externalSessionId: text("external_session_id"),
    title: text("title"),
    firstUserMessageBody: text("first_user_message_body"),
    lastMessageBody: text("last_message_body"),
    model: text("model"),
    modelReasoningEffort: text("model_reasoning_effort"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("sessions_agent_id_idx").on(table.agentId),
    index("sessions_created_by_idx").on(table.createdBy),
    index("sessions_status_idx").on(table.status),
    index("sessions_is_archived_idx").on(table.isArchived),
    index("sessions_harness_idx").on(table.harness),
    index("sessions_external_session_id_idx").on(table.externalSessionId),
  ],
);

// ── Relations ───────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  createdAgents: many(agents),
  createdImages: many(images),
  imageVariants: many(imageVariants),
  imageVariantBuilds: many(imageVariantBuilds),
}));

export const imagesRelations = relations(images, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [images.createdBy],
    references: [users.id],
  }),
  agents: many(agents),
  fileSecrets: many(fileSecrets),
  environmentSecrets: many(environmentSecrets),
  variants: many(imageVariants),
  variantBuilds: many(imageVariantBuilds),
}));

export const fileSecretsRelations = relations(fileSecrets, ({ one }) => ({
  image: one(images, {
    fields: [fileSecrets.imageId],
    references: [images.id],
  }),
}));

export const environmentSecretsRelations = relations(
  environmentSecrets,
  ({ one }) => ({
    image: one(images, {
      fields: [environmentSecrets.imageId],
      references: [images.id],
    }),
  }),
);

export const imageVariantsRelations = relations(imageVariants, ({ one, many }) => ({
  ownerUser: one(users, {
    fields: [imageVariants.ownerUserId],
    references: [users.id],
  }),
  image: one(images, {
    fields: [imageVariants.imageId],
    references: [images.id],
  }),
  headBuild: one(imageVariantBuilds, {
    fields: [imageVariants.headBuildId],
    references: [imageVariantBuilds.id],
  }),
  agents: many(agents),
  builds: many(imageVariantBuilds),
}));

export const imageVariantBuildsRelations = relations(
  imageVariantBuilds,
  ({ one }) => ({
    user: one(users, {
      fields: [imageVariantBuilds.requestedByUserId],
      references: [users.id],
    }),
    image: one(images, {
      fields: [imageVariantBuilds.imageId],
      references: [images.id],
    }),
    variant: one(imageVariants, {
      fields: [imageVariantBuilds.variantId],
      references: [imageVariants.id],
    }),
  }),
);

export const agentsRelations = relations(agents, ({ one }) => ({
  parentAgent: one(agents, {
    fields: [agents.parentAgentId],
    references: [agents.id],
  }),
  image: one(images, {
    fields: [agents.imageId],
    references: [images.id],
  }),
  imageVariant: one(imageVariants, {
    fields: [agents.imageVariantId],
    references: [imageVariants.id],
  }),
  createdByUser: one(users, {
    fields: [agents.createdBy],
    references: [users.id],
  }),
}));

// ── Coordinator Sessions ───────────────────────────────────────────────────

export const coordinatorSessions = pgTable(
  "coordinator_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("coordinator_sessions_created_by_idx").on(table.createdBy)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    coordinatorSessionId: uuid("coordinator_session_id")
      .notNull()
      .references(() => coordinatorSessions.id, { onDelete: "cascade" }),
    role: text("role").$type<MessageRole>().notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls").$type<unknown | null>(),
    toolResults: jsonb("tool_results").$type<unknown | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("messages_coordinator_session_idx").on(table.coordinatorSessionId)],
);

// ── Generated UI ───────────────────────────────────────────────────────────

export const generatedUi = pgTable(
  "generated_ui",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    code: text("code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("generated_ui_key_idx").on(table.key)],
);

export const coordinatorSessionsRelations = relations(
  coordinatorSessions,
  ({ one, many }) => ({
    createdByUser: one(users, {
      fields: [coordinatorSessions.createdBy],
      references: [users.id],
    }),
    messages: many(messages),
  }),
);

export const messagesRelations = relations(messages, ({ one }) => ({
  coordinatorSession: one(coordinatorSessions, {
    fields: [messages.coordinatorSessionId],
    references: [coordinatorSessions.id],
  }),
}));
