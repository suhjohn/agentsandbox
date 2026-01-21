import { z } from "zod";
import type { SemanticActionDefinition } from "../types";

const listDialogSessionsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).optional(),
});

const selectDialogSessionSchema = z.object({
  coordinatorSessionId: z.string().trim().min(1),
});

const createDialogSessionSchema = z.object({
  title: z.string().trim().min(1).optional(),
});

export const coordinatorDialogOpenSessionsListAction: SemanticActionDefinition<
  Record<string, never>,
  { readonly mode: "sessions" }
> = {
  id: "coordinator.dialog.open_sessions_list",
  version: 1,
  description: "Switch coordinator dialog to sessions list mode.",
  paramsSchema: z.object({}),
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  canRun: (ctx) => {
    if (!ctx.isAuthenticated) return { ok: false, reason: "NOT_AUTHENTICATED" };
    if (!ctx.chatDialogOpen) return { ok: false, reason: "DIALOG_CLOSED" };
    return { ok: true };
  },
  run: async (ctx) => {
    const controller = ctx.dialogController;
    if (!controller) throw new Error("Dialog controller unavailable");
    return await controller.openSessionsList();
  },
};

export const coordinatorDialogListSessionsAction: SemanticActionDefinition<
  z.infer<typeof listDialogSessionsSchema>,
  {
    readonly sessions: readonly {
      readonly id: string;
      readonly title: string | null;
      readonly createdBy: string;
      readonly createdAt: string;
      readonly updatedAt: string;
    }[];
    readonly nextCursor: string | null;
    readonly selectedSessionId: string | null;
    readonly mode: "conversation" | "sessions";
    readonly isDraftingNewSession: boolean;
  }
> = {
  id: "coordinator.dialog.list_sessions",
  version: 1,
  description: "List coordinator sessions in dialog context.",
  paramsSchema: listDialogSessionsSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 100 },
      cursor: { type: "string", minLength: 1 },
    },
  },
  canRun: (ctx) => {
    if (!ctx.isAuthenticated) return { ok: false, reason: "NOT_AUTHENTICATED" };
    if (!ctx.chatDialogOpen) return { ok: false, reason: "DIALOG_CLOSED" };
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = ctx.dialogController;
    if (!controller) throw new Error("Dialog controller unavailable");
    return await controller.listSessions(params);
  },
};

export const coordinatorDialogSelectSessionAction: SemanticActionDefinition<
  z.infer<typeof selectDialogSessionSchema>,
  {
    readonly selected: true;
    readonly coordinatorSessionId: string;
    readonly mode: "conversation";
  }
> = {
  id: "coordinator.dialog.select_session",
  version: 1,
  description: "Select a coordinator session in dialog conversation view.",
  paramsSchema: selectDialogSessionSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["coordinatorSessionId"],
    properties: {
      coordinatorSessionId: { type: "string", minLength: 1 },
    },
  },
  canRun: (ctx) => {
    if (!ctx.isAuthenticated) return { ok: false, reason: "NOT_AUTHENTICATED" };
    if (!ctx.chatDialogOpen) return { ok: false, reason: "DIALOG_CLOSED" };
    if (ctx.chatStreaming) return { ok: false, reason: "STREAM_IN_PROGRESS" };
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = ctx.dialogController;
    if (!controller) throw new Error("Dialog controller unavailable");
    return await controller.selectSession({
      coordinatorSessionId: params.coordinatorSessionId,
    });
  },
};

export const coordinatorDialogCreateSessionAction: SemanticActionDefinition<
  z.infer<typeof createDialogSessionSchema>,
  {
    readonly created: true;
    readonly coordinatorSessionId: string;
    readonly mode: "conversation";
  }
> = {
  id: "coordinator.dialog.create_session",
  version: 1,
  description: "Create and select a new coordinator session in dialog.",
  paramsSchema: createDialogSessionSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", minLength: 1 },
    },
  },
  canRun: (ctx) => {
    if (!ctx.isAuthenticated) return { ok: false, reason: "NOT_AUTHENTICATED" };
    if (!ctx.chatDialogOpen) return { ok: false, reason: "DIALOG_CLOSED" };
    if (ctx.chatStreaming) return { ok: false, reason: "STREAM_IN_PROGRESS" };
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = ctx.dialogController;
    if (!controller) throw new Error("Dialog controller unavailable");
    return await controller.createSession(params);
  },
};
