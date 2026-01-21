import { z } from "zod";
import type { SemanticActionDefinition } from "../types";

const sendMessageSchema = z.object({
  text: z.string().min(1),
});

export const chatSendMessageAction: SemanticActionDefinition<
  z.infer<typeof sendMessageSchema>,
  { readonly accepted: boolean; readonly streamingStarted: boolean }
> = {
  id: "chat.send_message",
  version: 1,
  description: "Send one user message in current coordinator session.",
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

export const chatStopStreamAction: SemanticActionDefinition<
  Record<string, never>,
  { readonly stopped: boolean }
> = {
  id: "chat.stop_stream",
  version: 1,
  description: "Stop currently streaming assistant response.",
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

export const chatClearDialogConversationAction: SemanticActionDefinition<
  z.infer<typeof clearDialogConversationSchema>,
  { readonly cleared: boolean }
> = {
  id: "chat.clear_dialog_conversation",
  version: 1,
  description: "Clear current dialog coordinator session via dialog clear flow.",
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
