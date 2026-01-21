import { runAgentStream } from "../coordinator";
import { log } from "../log";

export type AgentStreamEventData = {
  readonly type?:
    | "run_started"
    | "client_tool_request"
    | "text_delta"
    | "tool_call"
    | "tool_result"
    | "error"
    | "done";
  readonly text?: string;
  readonly error?: string;
  readonly done?: boolean;
  readonly coordinatorSessionId?: string;
  readonly runId?: string;
  readonly toolCall?: {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly args: unknown;
  };
  readonly toolCallError?: string;
  readonly toolResult?: {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly result: unknown;
    readonly isError?: boolean;
  };
  readonly clientToolRequest?: {
    readonly runId: string;
    readonly toolCallId: string;
    readonly toolName: string;
    readonly args: unknown;
    readonly timeoutMs: number;
  };
};

type AgentRunStatus = "running" | "completed" | "error" | "canceled";

type StoredEvent = {
  readonly id: number;
  readonly data: AgentStreamEventData;
};

type PendingClientToolRequest = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly timeoutMs: number;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

type AgentRunRecord = {
  readonly runId: string;
  readonly coordinatorSessionId: string;
  readonly createdBy: string;
  readonly createdAtMs: number;
  readonly browserAvailable: boolean;
  updatedAtMs: number;
  status: AgentRunStatus;
  errorMessage: string | null;
  nextEventId: number;
  readonly events: StoredEvent[];
  readonly subscribers: Set<AsyncQueue<StoredEvent>>;
  readonly toolNameByCallId: Map<string, string>;
  readonly pendingClientToolRequests: Map<string, PendingClientToolRequest>;
  readonly settledClientToolResults: Map<string, { readonly ok: boolean }>;
  abortController: AbortController | null;
  cancelRequestedAtMs: number | null;
  cancelReason: string | null;
};

class AsyncQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return;
    }
    this.items.push(item);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (waiter) waiter({ value: undefined as unknown as T, done: true });
    }
  }

  async next(): Promise<IteratorResult<T>> {
    const item = this.items.shift();
    if (typeof item !== "undefined") return { value: item, done: false };
    if (this.closed) return { value: undefined as unknown as T, done: true };
    return new Promise<IteratorResult<T>>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
}

function getType(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
}

function chunkToEventData(
  chunk: unknown,
  toolNameByCallId: Map<string, string>,
): AgentStreamEventData | null {
  const type = getType(chunk);
  if (!type) return null;

  if (type === "text-delta") {
    const delta = (chunk as { delta?: unknown; text?: unknown }).delta;
    const text = (
      typeof delta === "string" ? delta : (chunk as { text?: unknown }).text
    ) as unknown;
    return typeof text === "string" && text.length > 0
      ? { type: "text_delta", text }
      : null;
  }

  if (type === "tool-call") {
    const toolCallId = (chunk as { toolCallId?: unknown }).toolCallId;
    const toolName = (chunk as { toolName?: unknown }).toolName;
    const args = (chunk as { input?: unknown }).input;
    const invalid = (chunk as { invalid?: unknown }).invalid;
    const error = (chunk as { error?: unknown }).error;

    if (typeof toolCallId !== "string" || typeof toolName !== "string") {
      return null;
    }

    toolNameByCallId.set(toolCallId, toolName);
    if (invalid === true) {
      return {
        type: "tool_call",
        toolCall: { toolCallId, toolName, args },
        toolCallError:
          error instanceof Error
            ? error.message
            : String(error ?? "Invalid tool call"),
      };
    }
    return { type: "tool_call", toolCall: { toolCallId, toolName, args } };
  }

  if (type === "tool-result") {
    const toolCallId = (chunk as { toolCallId?: unknown }).toolCallId;
    const toolName = (chunk as { toolName?: unknown }).toolName;
    const output = (chunk as { output?: unknown }).output;
    if (typeof toolCallId !== "string" || typeof toolName !== "string") {
      return null;
    }
    toolNameByCallId.set(toolCallId, toolName);
    return {
      type: "tool_result",
      toolResult: { toolCallId, toolName, result: output, isError: false },
    };
  }

  if (type === "tool-error") {
    const toolCallId = (chunk as { toolCallId?: unknown }).toolCallId;
    const toolName = (chunk as { toolName?: unknown }).toolName;
    const error = (chunk as { error?: unknown }).error;
    if (typeof toolCallId !== "string" || typeof toolName !== "string") {
      return null;
    }
    toolNameByCallId.set(toolCallId, toolName);
    return {
      type: "tool_result",
      toolResult: {
        toolCallId,
        toolName,
        result:
          error instanceof Error
            ? error.message
            : String(error ?? "Tool failed"),
        isError: true,
      },
    };
  }

  if (type === "tool-input-available") {
    const toolCallId = (chunk as { toolCallId?: unknown }).toolCallId;
    const toolName = (chunk as { toolName?: unknown }).toolName;
    const args = (chunk as { input?: unknown }).input;
    if (typeof toolCallId !== "string" || typeof toolName !== "string") {
      return null;
    }
    toolNameByCallId.set(toolCallId, toolName);
    return { type: "tool_call", toolCall: { toolCallId, toolName, args } };
  }

  if (type === "tool-input-error") {
    const toolCallId = (chunk as { toolCallId?: unknown }).toolCallId;
    const toolName = (chunk as { toolName?: unknown }).toolName;
    const args = (chunk as { input?: unknown }).input;
    const errorText = (chunk as { errorText?: unknown }).errorText;
    if (typeof toolCallId !== "string" || typeof toolName !== "string") {
      return null;
    }
    toolNameByCallId.set(toolCallId, toolName);
    return {
      type: "tool_call",
      toolCall: { toolCallId, toolName, args },
      toolCallError:
        typeof errorText === "string" ? errorText : "Invalid tool input",
    };
  }

  if (type === "tool-output-available") {
    const toolCallId = (chunk as { toolCallId?: unknown }).toolCallId;
    const output = (chunk as { output?: unknown }).output;
    if (typeof toolCallId !== "string") return null;
    const toolName = toolNameByCallId.get(toolCallId) ?? "unknown_tool";
    return {
      type: "tool_result",
      toolResult: { toolCallId, toolName, result: output, isError: false },
    };
  }

  if (type === "tool-output-error") {
    const toolCallId = (chunk as { toolCallId?: unknown }).toolCallId;
    const errorText = (chunk as { errorText?: unknown }).errorText;
    if (typeof toolCallId !== "string") return null;
    const toolName = toolNameByCallId.get(toolCallId) ?? "unknown_tool";
    return {
      type: "tool_result",
      toolResult: {
        toolCallId,
        toolName,
        result: typeof errorText === "string" ? errorText : "Tool failed",
        isError: true,
      },
    };
  }

  if (type === "tool-output-denied") {
    const toolCallId =
      (chunk as { toolCallId?: unknown; id?: unknown }).toolCallId ??
      (chunk as { id?: unknown }).id;
    if (typeof toolCallId !== "string") return null;
    const toolName = toolNameByCallId.get(toolCallId) ?? "unknown_tool";
    return {
      type: "tool_result",
      toolResult: {
        toolCallId,
        toolName,
        result: "Tool execution denied",
        isError: true,
      },
    };
  }

  if (type === "error") {
    const err =
      (chunk as { error?: unknown; errorText?: unknown }).error ??
      (chunk as { errorText?: unknown }).errorText;
    return {
      type: "error",
      error: err instanceof Error ? err.message : String(err ?? "Unknown error"),
    };
  }

  return null;
}

const RUNS = new Map<string, AgentRunRecord>();

const COMPLETED_TTL_MS = 30 * 60 * 1000;
const RUNNING_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_EVENTS_PER_RUN = 10_000;
const DEFAULT_CLIENT_TOOL_TIMEOUT_MS = 15_000;
const MAX_CLIENT_TOOL_TIMEOUT_MS = 60_000;
const DEFAULT_CANCEL_REASON = "Run canceled by user";

function clearPendingRequestTimer(pending: PendingClientToolRequest): void {
  if (!pending.timer) return;
  clearTimeout(pending.timer);
  pending.timer = null;
}

function rejectAllPendingClientTools(run: AgentRunRecord, reason: string): void {
  for (const [toolCallId, pending] of run.pendingClientToolRequests.entries()) {
    clearPendingRequestTimer(pending);
    if (!run.settledClientToolResults.has(toolCallId)) {
      run.settledClientToolResults.set(toolCallId, { ok: false });
    }
    pending.reject(new Error(reason));
  }
  run.pendingClientToolRequests.clear();
}

function normalizeCancelReason(reason: string | undefined): string {
  if (typeof reason !== "string") return DEFAULT_CANCEL_REASON;
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_CANCEL_REASON;
}

function markRunCanceled(run: AgentRunRecord, reason: string): void {
  if (run.status === "canceled") return;
  run.status = "canceled";
  run.errorMessage = reason;
  run.cancelRequestedAtMs = Date.now();
  run.cancelReason = reason;
  addEvent(run, {
    type: "done",
    done: true,
    coordinatorSessionId: run.coordinatorSessionId,
    runId: run.runId,
  });
}

function cleanupExpiredRuns(nowMs = Date.now()): void {
  for (const [runId, run] of RUNS) {
    const ageMs = nowMs - run.updatedAtMs;
    const ttl = run.status === "running" ? RUNNING_TTL_MS : COMPLETED_TTL_MS;
    if (ageMs <= ttl) continue;

    rejectAllPendingClientTools(run, "Run expired before client tool completed");
    for (const subscriber of run.subscribers) subscriber.close();
    RUNS.delete(runId);
  }
}

function addEvent(run: AgentRunRecord, data: AgentStreamEventData): void {
  run.updatedAtMs = Date.now();
  const event: StoredEvent = { id: run.nextEventId, data };
  run.nextEventId += 1;

  run.events.push(event);
  if (run.events.length > MAX_EVENTS_PER_RUN) {
    run.events.splice(0, run.events.length - MAX_EVENTS_PER_RUN);
  }

  for (const subscriber of run.subscribers) {
    subscriber.push(event);
  }
}

function clampClientToolTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    return DEFAULT_CLIENT_TOOL_TIMEOUT_MS;
  }
  return Math.max(1_000, Math.min(MAX_CLIENT_TOOL_TIMEOUT_MS, Math.floor(timeoutMs)));
}

async function requestClientToolAndWait(input: {
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly timeoutMs?: number;
}): Promise<unknown> {
  cleanupExpiredRuns();

  const run = RUNS.get(input.runId);
  if (!run) throw new Error("Run not found");
  if (run.status !== "running") {
    throw new Error(`Run is not active (status=${run.status})`);
  }
  if (!run.browserAvailable) {
    throw new Error("Browser unavailable");
  }

  const existingSettled = run.settledClientToolResults.get(input.toolCallId);
  if (existingSettled) {
    throw new Error(`Client tool already resolved: ${input.toolCallId}`);
  }
  if (run.pendingClientToolRequests.has(input.toolCallId)) {
    throw new Error(`Client tool already pending: ${input.toolCallId}`);
  }

  const timeoutMs = clampClientToolTimeout(input.timeoutMs);

  log.info("client_tool.requested", {
    runId: run.runId,
    userId: run.createdBy,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    timeoutMs,
  });

  addEvent(run, {
    type: "client_tool_request",
    runId: run.runId,
    clientToolRequest: {
      runId: run.runId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      args: input.args,
      timeoutMs,
    },
  });

  return await new Promise<unknown>((resolve, reject) => {
    const pending: PendingClientToolRequest = {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      timeoutMs,
      resolve,
      reject,
      timer: null,
    };

    pending.timer = setTimeout(() => {
      run.pendingClientToolRequests.delete(input.toolCallId);
      run.settledClientToolResults.set(input.toolCallId, { ok: false });
      log.warn("client_tool.timeout", {
        runId: run.runId,
        userId: run.createdBy,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        timeoutMs,
      });
      pending.reject(
        new Error(
          `Client tool timed out after ${timeoutMs}ms: ${input.toolName}`,
        ),
      );
    }, timeoutMs);

    run.pendingClientToolRequests.set(input.toolCallId, pending);
  });
}

export function submitAgentRunClientToolResult(input: {
  readonly runId: string;
  readonly userId: string;
  readonly toolCallId: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}):
  | { readonly accepted: true; readonly status: "accepted" | "already_resolved" }
  | { readonly accepted: false; readonly reason: string } {
  cleanupExpiredRuns();

  const run = RUNS.get(input.runId);
  if (!run || run.createdBy !== input.userId) {
    return { accepted: false, reason: "Run not found" };
  }

  const settled = run.settledClientToolResults.get(input.toolCallId);
  if (settled) {
    return { accepted: true, status: "already_resolved" };
  }

  const pending = run.pendingClientToolRequests.get(input.toolCallId);
  if (!pending) {
    return {
      accepted: false,
      reason: "Tool call is not pending for this run",
    };
  }

  clearPendingRequestTimer(pending);
  run.pendingClientToolRequests.delete(input.toolCallId);
  run.settledClientToolResults.set(input.toolCallId, { ok: input.ok });

  if (input.ok) {
    log.info("client_tool.resolved", {
      runId: input.runId,
      userId: input.userId,
      toolCallId: input.toolCallId,
      toolName: pending.toolName,
      timeoutMs: pending.timeoutMs,
    });
    pending.resolve(input.result);
    return { accepted: true, status: "accepted" };
  }

  if (typeof input.result !== "undefined") {
    const errorMessage =
      typeof input.error === "string" && input.error.trim().length > 0
        ? input.error
        : "Client tool reported failure details in result payload";

    log.warn("client_tool.resolved_with_error_payload", {
      runId: input.runId,
      userId: input.userId,
      toolCallId: input.toolCallId,
      toolName: pending.toolName,
      timeoutMs: pending.timeoutMs,
      error: errorMessage,
    });

    pending.resolve(input.result);
    return { accepted: true, status: "accepted" };
  }

  const errorMessage =
    typeof input.error === "string" && input.error.trim().length > 0
      ? input.error
      : "Client tool execution failed";

  log.warn("client_tool.rejected", {
    runId: input.runId,
    userId: input.userId,
    toolCallId: input.toolCallId,
    toolName: pending.toolName,
    timeoutMs: pending.timeoutMs,
    error: errorMessage,
  });

  pending.reject(new Error(errorMessage));
  return { accepted: true, status: "accepted" };
}

export function cancelAgentRun(input: {
  readonly runId: string;
  readonly userId: string;
  readonly reason?: string;
}):
  | { readonly accepted: true; readonly status: "canceled" | "already_canceled" | "already_finished" }
  | { readonly accepted: false; readonly reason: string } {
  cleanupExpiredRuns();

  const run = RUNS.get(input.runId);
  if (!run || run.createdBy !== input.userId) {
    return { accepted: false, reason: "Run not found" };
  }

  if (run.status === "completed" || run.status === "error") {
    return { accepted: true, status: "already_finished" };
  }

  if (run.status === "canceled") {
    return { accepted: true, status: "already_canceled" };
  }

  const reason = normalizeCancelReason(input.reason);
  log.info("coordinator.run.cancel.requested", {
    runId: run.runId,
    coordinatorSessionId: run.coordinatorSessionId,
    userId: input.userId,
    reason,
  });

  markRunCanceled(run, reason);
  rejectAllPendingClientTools(run, reason);
  run.abortController?.abort(new Error(reason));
  run.abortController = null;

  for (const subscriber of run.subscribers) subscriber.close();
  run.subscribers.clear();

  return { accepted: true, status: "canceled" };
}

async function consumeAgentStream(input: {
  readonly run: AgentRunRecord;
  readonly result: Awaited<ReturnType<typeof runAgentStream>>;
}): Promise<void> {
  log.info("coordinator.run.consume.start", {
    runId: input.run.runId,
    coordinatorSessionId: input.run.coordinatorSessionId,
    userId: input.run.createdBy,
  });
  let chunkCount = 0;
  try {
    for await (const chunk of input.result.fullStream) {
      if (input.run.status === "canceled") break;
      chunkCount += 1;
      const data = chunkToEventData(chunk, input.run.toolNameByCallId);
      if (!data) continue;
      addEvent(input.run, data);
      if (chunkCount === 1 || chunkCount % 50 === 0) {
        log.debug("coordinator.run.consume.progress", {
          runId: input.run.runId,
          chunkCount,
          status: input.run.status,
        });
      }
    }

    if (input.run.status === "canceled") {
      log.info("coordinator.run.consume.canceled_after_stream_end", {
        runId: input.run.runId,
        coordinatorSessionId: input.run.coordinatorSessionId,
        chunkCount,
        reason: input.run.cancelReason ?? DEFAULT_CANCEL_REASON,
      });
      return;
    }

    addEvent(input.run, {
      type: "done",
      done: true,
      coordinatorSessionId: input.run.coordinatorSessionId,
      runId: input.run.runId,
    });
    input.run.status = "completed";
    log.info("coordinator.run.consume.completed", {
      runId: input.run.runId,
      coordinatorSessionId: input.run.coordinatorSessionId,
      chunkCount,
      eventCount: input.run.events.length,
    });
  } catch (error) {
    if (input.run.status === "canceled") {
      log.info("coordinator.run.consume.canceled", {
        runId: input.run.runId,
        coordinatorSessionId: input.run.coordinatorSessionId,
        chunkCount,
        reason: input.run.cancelReason ?? DEFAULT_CANCEL_REASON,
      });
    } else {
      const message = toErrorMessage(error);
      input.run.status = "error";
      input.run.errorMessage = message;
      addEvent(input.run, {
        type: "error",
        error: message,
        runId: input.run.runId,
      });
      log.error("coordinator.run.consume.error", {
        runId: input.run.runId,
        coordinatorSessionId: input.run.coordinatorSessionId,
        chunkCount,
        error,
      });
    }
  } finally {
    input.run.updatedAtMs = Date.now();
    input.run.abortController = null;
    rejectAllPendingClientTools(input.run, "Run finished before client tool completed");
    for (const subscriber of input.run.subscribers) subscriber.close();
    input.run.subscribers.clear();
    log.debug("coordinator.run.consume.finally", {
      runId: input.run.runId,
      status: input.run.status,
      errorMessage: input.run.errorMessage,
      subscriberCount: input.run.subscribers.size,
    });
  }
}

export function startAgentRun(input: {
  readonly coordinatorSessionId: string;
  readonly userId: string;
  readonly userMessage: string;
  readonly baseUrl: string;
  readonly userAuthHeader: string;
  readonly browserAvailable?: boolean;
}): { readonly runId: string } {
  cleanupExpiredRuns();

  const runId = crypto.randomUUID();
  const nowMs = Date.now();
  const abortController = new AbortController();
  const run: AgentRunRecord = {
    runId,
    coordinatorSessionId: input.coordinatorSessionId,
    createdBy: input.userId,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    browserAvailable: input.browserAvailable === true,
    status: "running",
    errorMessage: null,
    nextEventId: 1,
    events: [],
    subscribers: new Set(),
    toolNameByCallId: new Map(),
    pendingClientToolRequests: new Map(),
    settledClientToolResults: new Map(),
    abortController,
    cancelRequestedAtMs: null,
    cancelReason: null,
  };
  RUNS.set(runId, run);
  log.info("coordinator.run.start", {
    runId,
    coordinatorSessionId: input.coordinatorSessionId,
    userId: input.userId,
    userMessageChars: input.userMessage.length,
    browserAvailable: run.browserAvailable,
  });

  addEvent(run, {
    type: "run_started",
    runId,
    coordinatorSessionId: input.coordinatorSessionId,
  });

  void (async () => {
    try {
      log.debug("coordinator.run.stream.create.begin", {
        runId,
        coordinatorSessionId: input.coordinatorSessionId,
      });
      const result = await runAgentStream({
        userId: input.userId,
        coordinatorSessionId: input.coordinatorSessionId,
        userMessage: input.userMessage,
        baseUrl: input.baseUrl,
        userAuthHeader: input.userAuthHeader,
        abortSignal: abortController.signal,
        clientTools: run.browserAvailable
          ? {
              requestClientTool: async (request) =>
                await requestClientToolAndWait({
                  runId,
                  toolCallId: request.toolCallId,
                  toolName: request.toolName,
                  args: request.args,
                  timeoutMs: request.timeoutMs,
                }),
            }
          : undefined,
      });
      log.debug("coordinator.run.stream.create.done", {
        runId,
        coordinatorSessionId: input.coordinatorSessionId,
      });
      await consumeAgentStream({ run, result });
    } catch (error) {
      run.abortController = null;
      if (run.status === "canceled") {
        log.info("coordinator.run.stream.create.canceled", {
          runId,
          coordinatorSessionId: input.coordinatorSessionId,
          reason: run.cancelReason ?? DEFAULT_CANCEL_REASON,
        });
      } else {
        const message = toErrorMessage(error);
        run.status = "error";
        run.errorMessage = message;
        addEvent(run, { type: "error", error: message, runId });
        log.error("coordinator.run.stream.create.error", {
          runId,
          coordinatorSessionId: input.coordinatorSessionId,
          error,
        });
      }
      rejectAllPendingClientTools(run, "Run failed before client tool completed");
      for (const subscriber of run.subscribers) subscriber.close();
      run.subscribers.clear();
    }
  })();

  return { runId };
}

export function getAgentRunInfo(runId: string): {
  readonly runId: string;
  readonly coordinatorSessionId: string;
  readonly createdBy: string;
  readonly status: AgentRunStatus;
  readonly errorMessage: string | null;
} | null {
  cleanupExpiredRuns();
  const run = RUNS.get(runId);
  if (!run) return null;
  return {
    runId: run.runId,
    coordinatorSessionId: run.coordinatorSessionId,
    createdBy: run.createdBy,
    status: run.status,
    errorMessage: run.errorMessage,
  };
}

export async function* subscribeAgentRunEvents(input: {
  readonly runId: string;
  readonly userId: string;
  readonly afterEventId?: number;
}): AsyncGenerator<StoredEvent, void, void> {
  cleanupExpiredRuns();
  const run = RUNS.get(input.runId);
  if (!run) return;
  if (run.createdBy !== input.userId) return;
  log.debug("coordinator.run.subscribe.open", {
    runId: input.runId,
    userId: input.userId,
    afterEventId: input.afterEventId ?? 0,
    currentEvents: run.events.length,
    status: run.status,
  });

  let cursor = input.afterEventId ?? 0;

  for (const event of run.events) {
    if (event.id > cursor) {
      cursor = event.id;
      yield event;
    }
  }

  if (run.status !== "running") {
    // Guard against a race where the run completes while we're iterating.
    for (const event of run.events) {
      if (event.id > cursor) {
        cursor = event.id;
        yield event;
      }
    }
    return;
  }

  const queue = new AsyncQueue<StoredEvent>();
  run.subscribers.add(queue);

  try {
    while (true) {
      const next = await queue.next();
      if (next.done) return;
      const event = next.value;
      if (event.id > cursor) {
        cursor = event.id;
        yield event;
      }
    }
  } finally {
    run.subscribers.delete(queue);
    queue.close();
    log.debug("coordinator.run.subscribe.closed", {
      runId: input.runId,
      userId: input.userId,
      status: run.status,
      bufferedEvents: run.events.length,
    });
  }
}
