import { z } from "zod";
import { getUiActionDescriptor } from "../../../../shared/ui-actions-contract";
import type { UiActionDefinition } from "../types";

const listDialogSessionsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).optional(),
});

const selectDialogSessionSchema = z.object({
  sessionId: z.string().trim().min(1),
});

const createDialogSessionSchema = z.object({
  title: z.string().trim().min(1).optional(),
});

export const coordinatorDialogOpenSessionsListAction: UiActionDefinition<
  Record<string, never>,
  { readonly mode: "sessions" }
> = {
  ...getUiActionDescriptor("coordinator.dialog.open_sessions_list"),
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

export const coordinatorDialogListSessionsAction: UiActionDefinition<
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
  ...getUiActionDescriptor("coordinator.dialog.list_sessions"),
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

export const coordinatorDialogSelectSessionAction: UiActionDefinition<
  z.infer<typeof selectDialogSessionSchema>,
  {
    readonly selected: true;
    readonly sessionId: string;
    readonly mode: "conversation";
  }
> = {
  ...getUiActionDescriptor("coordinator.dialog.select_session"),
  paramsSchema: selectDialogSessionSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["sessionId"],
    properties: {
      sessionId: { type: "string", minLength: 1 },
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
      sessionId: params.sessionId,
    });
  },
};

export const coordinatorDialogCreateSessionAction: UiActionDefinition<
  z.infer<typeof createDialogSessionSchema>,
  {
    readonly created: true;
    readonly sessionId: string;
    readonly mode: "conversation";
  }
> = {
  ...getUiActionDescriptor("coordinator.dialog.create_session"),
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
