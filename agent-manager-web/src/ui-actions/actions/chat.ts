import { z } from "zod";
import { getUiActionDescriptor } from "../../../../shared/ui-actions-contract";
import type { UiActionDefinition } from "../types";

const sendMessageSchema = z.object({
  text: z.string().min(1),
});

export const chatSendMessageAction: UiActionDefinition<
  z.infer<typeof sendMessageSchema>,
  { readonly accepted: boolean; readonly streamingStarted: boolean }
> = {
  ...getUiActionDescriptor("chat.send_message"),
  paramsSchema: sendMessageSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: {
      text: { type: "string", minLength: 1 },
    },
  },
  canRun: (ctx) => {
    if (!ctx.isAuthenticated) return { ok: false, reason: "NOT_AUTHENTICATED" };
    if (!(ctx.routePath.startsWith("/chat") || ctx.chatDialogOpen)) {
      return { ok: false, reason: "WRONG_ROUTE" };
    }
    if (!ctx.chatHasConversation) {
      return { ok: false, reason: "MISSING_REQUIRED_ENTITY" };
    }
    if (ctx.chatStreaming) return { ok: false, reason: "STREAM_IN_PROGRESS" };
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = ctx.chatController;
    if (!controller) throw new Error("Chat controller unavailable");
    return await controller.sendMessage(params.text);
  },
};

export const chatStopStreamAction: UiActionDefinition<
  Record<string, never>,
  { readonly stopped: boolean }
> = {
  ...getUiActionDescriptor("chat.stop_stream"),
  paramsSchema: z.object({}),
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  canRun: (ctx) =>
    ctx.chatStreaming
      ? { ok: true }
      : { ok: false, reason: "MISSING_REQUIRED_ENTITY" },
  run: async (ctx) => {
    const controller = ctx.chatController;
    if (!controller) throw new Error("Chat controller unavailable");
    return await controller.stopStream();
  },
};

const clearDialogConversationSchema = z.object({
  confirm: z.literal(true),
});

export const chatClearDialogConversationAction: UiActionDefinition<
  z.infer<typeof clearDialogConversationSchema>,
  { readonly cleared: boolean }
> = {
  ...getUiActionDescriptor("chat.clear_dialog_conversation"),
  paramsSchema: clearDialogConversationSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["confirm"],
    properties: {
      confirm: { const: true },
    },
  },
  canRun: (ctx) => {
    if (!ctx.isAuthenticated) return { ok: false, reason: "NOT_AUTHENTICATED" };
    if (!ctx.chatDialogOpen) return { ok: false, reason: "DIALOG_CLOSED" };
    if (!ctx.chatHasConversation) {
      return { ok: false, reason: "MISSING_REQUIRED_ENTITY" };
    }
    return { ok: true };
  },
  run: async (ctx) => {
    const controller = ctx.dialogController;
    if (!controller) throw new Error("Dialog controller unavailable");
    if (!controller.canClearConversation()) {
      throw new Error("Dialog clear action unavailable");
    }
    return await controller.clearConversation();
  },
};
