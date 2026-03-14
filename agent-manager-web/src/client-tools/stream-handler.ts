import type {
  ClientToolCancelEvent,
  ClientToolName,
  ClientToolRequestEvent,
  ClientToolResponsePayload,
} from "../../../shared/client-tools-contract";
import { isClientToolName } from "../../../shared/client-tools-contract";
import {
  executeClientTool,
  toClientToolExecutionError,
  type ClientToolExecutorDeps,
} from "./executor";

type PendingRequest = {
  readonly controller: AbortController;
};

function parseSseChunk(
  raw: string,
): { readonly eventType: string; readonly data: string } | null {
  let eventType = "message";
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return { eventType, data: dataLines.join("\n") };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function isRequestEvent(value: unknown): value is ClientToolRequestEvent {
  const record = asRecord(value);
  const request = asRecord(record.request);
  return (
    record.type === "client_tool_request" &&
    typeof record.runId === "string" &&
    typeof request.requestId === "string" &&
    isClientToolName(request.toolName) &&
    typeof request.targetDeviceId === "string"
  );
}

function isCancelEvent(value: unknown): value is ClientToolCancelEvent {
  const record = asRecord(value);
  return (
    record.type === "client_tool_cancel" &&
    typeof record.runId === "string" &&
    typeof record.requestId === "string" &&
    typeof record.targetDeviceId === "string"
  );
}

async function postResponse(input: {
  readonly agentApiUrl: string;
  readonly agentAuthToken: string;
  readonly body: ClientToolResponsePayload;
}): Promise<void> {
  await fetch(new URL("/client-tools/respond", input.agentApiUrl).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Auth": `Bearer ${input.agentAuthToken}`,
    },
    body: JSON.stringify(input.body),
  });
}

export function createClientToolStreamHandler(input: {
  readonly agentApiUrl: string;
  readonly agentAuthToken: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly deps: ClientToolExecutorDeps;
  readonly onError?: (err: unknown) => void;
}) {
  const pending = new Map<string, PendingRequest>();

  async function handleRequest(event: ClientToolRequestEvent): Promise<void> {
    if (event.request.targetDeviceId !== input.deviceId) return;
    const controller = new AbortController();
    pending.set(event.request.requestId, { controller });
    try {
      const result = await executeClientTool({
        toolName: event.request.toolName as ClientToolName,
        args: event.request.args,
        deps: input.deps,
      });
      if (controller.signal.aborted) return;
      await postResponse({
        agentApiUrl: input.agentApiUrl,
        agentAuthToken: input.agentAuthToken,
        body: {
          requestId: event.request.requestId,
          userId: input.userId,
          deviceId: input.deviceId,
          ok: true,
          result,
        },
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      await postResponse({
        agentApiUrl: input.agentApiUrl,
        agentAuthToken: input.agentAuthToken,
        body: {
          requestId: event.request.requestId,
          userId: input.userId,
          deviceId: input.deviceId,
          ok: false,
          error: toClientToolExecutionError(err),
        },
      });
    } finally {
      pending.delete(event.request.requestId);
    }
  }

  function handleCancel(event: ClientToolCancelEvent): void {
    if (event.targetDeviceId !== input.deviceId) return;
    pending.get(event.requestId)?.controller.abort();
    pending.delete(event.requestId);
  }

  return {
    async consumeRunStream(
      stream: ReadableStream<Uint8Array>,
      signal: AbortSignal,
    ): Promise<void> {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf("\n\n");
        while (idx !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const chunk = parseSseChunk(raw);
          if (chunk) {
            const payload = parseJson(chunk.data);
            if (
              chunk.eventType === "client_tool_request" &&
              isRequestEvent(payload)
            ) {
              void handleRequest(payload).catch(input.onError);
            }
            if (
              chunk.eventType === "client_tool_cancel" &&
              isCancelEvent(payload)
            ) {
              handleCancel(payload);
            }
          }
          idx = buffer.indexOf("\n\n");
        }
      }
    },
    cancelAll(): void {
      for (const entry of pending.values()) {
        entry.controller.abort();
      }
      pending.clear();
    },
  };
}
