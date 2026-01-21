import { describe, expect, it } from "bun:test";
import type { GetSessionId200MessagesItem } from "@/api/generated/agent";
import { deduplicateMessages } from "./session-message-utils";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isItemEventBody(value: unknown): value is { type: string } {
  if (!isRecord(value)) return false;
  const type = value.type;
  return typeof type === "string" && type.startsWith("item.");
}

function msg(
  id: string,
  body: unknown,
  createdAt: string = "2026-02-12T00:00:00.000Z",
): GetSessionId200MessagesItem {
  return {
    id,
    agentId: "a1",
    sessionId: "s1",
    turnId: null,
    body,
    embeddings: null,
    createdAt,
  };
}

describe("workspace/panels/session-message-utils", () => {
  it("keeps only the latest item event within a turn scope", () => {
    const messages = [
      msg("m1", { type: "turn.started" }),
      msg("m2", {
        type: "item.started",
        item: { id: "item_0", type: "command_execution", status: "in_progress" },
      }),
      msg("m3", {
        type: "item.updated",
        item: { id: "item_0", type: "command_execution", status: "completed" },
      }),
    ];

    const result = deduplicateMessages(messages);
    expect(result.map((m) => m.id)).toEqual(["m1", "m3"]);
  });

  it("does not dedupe items across turns when ids repeat", () => {
    const messages = [
      msg("t1", { type: "turn.started" }),
      msg("t1i1", {
        type: "item.started",
        item: { id: "item_0", type: "command_execution", status: "in_progress" },
      }),
      msg("t1i2", {
        type: "item.completed",
        item: { id: "item_0", type: "command_execution", status: "completed" },
      }),
      msg("t1done", {
        type: "turn.completed",
        usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
      }),
      msg("t2", { type: "turn.started" }),
      msg("t2i1", {
        type: "item.started",
        item: { id: "item_0", type: "command_execution", status: "in_progress", command: "echo hi" },
      }),
      msg("t2i2", {
        type: "item.completed",
        item: { id: "item_0", type: "command_execution", status: "completed", command: "echo hi" },
      }),
    ];

    const result = deduplicateMessages(messages);
    const itemMessages = result.filter((m) => isItemEventBody(m.body));

    expect(itemMessages.map((m) => m.id)).toEqual(["t1i2", "t2i2"]);
  });
});
