import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Send, Square, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAuth } from "../lib/auth";
import type {
  GetMessagesResult,
  ListCoordinatorSessionsResult,
  Message,
} from "../lib/api";
import {
  ToolUIMap,
  renderToolArgs,
  renderToolResult,
} from "../components/tool";
import { Loader } from "@/components/loader";
import { CodeBlock } from "../components/code-block";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getUiStateSnapshot } from "@/coordinator-actions/context";
import { executeCoordinatorClientToolRequest } from "@/coordinator-actions/executor";
import { registerChatRuntimeController } from "@/coordinator-actions/runtime-bridge";

const COORDINATOR_COMPOSE_EVENT = "agent-manager-web:coordinator-compose";
const COORDINATOR_PTT_STATE_EVENT = "agent-manager-web:coordinator-ptt-state";
const PTT_TIMELINE_POINTS = 64;
const PTT_TIMELINE_INTERVAL_MS = 80;

type CoordinatorPttStatus = "idle" | "starting" | "recording" | "transcribing";

type CoordinatorPttStateDetail = {
  readonly status: CoordinatorPttStatus;
  readonly level: number;
  readonly microphoneLabel: string | null;
};

function MarkdownCode({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: unknown;
}) {
  const match = /language-(\w+)/.exec(className || "");
  const isInline = !match && !className;
  const text = String(children ?? "").replace(/\n$/, "");

  if (isInline) {
    return (
      <code
        className="bg-muted rounded px-1.5 py-0.5 font-mono text-sm whitespace-pre-wrap break-all"
        style={{ overflowWrap: "anywhere" }}
      >
        {text}
      </code>
    );
  }

  return <CodeBlock code={text} language={match?.[1]} />;
}

function AssistantMessageContent({ content }: { readonly content: string }) {
  type CodeProps = {
    readonly className?: string;
    readonly children?: ReactNode;
  };
  type PreProps = { readonly children?: ReactNode };
  type PProps = { readonly children?: ReactNode };
  type AProps = {
    readonly href?: string;
    readonly children?: ReactNode;
  };
  type ListProps = { readonly children?: ReactNode };

  const components: Components = {
    code(props: CodeProps) {
      return (
        <MarkdownCode className={props.className}>
          {props.children}
        </MarkdownCode>
      );
    },
    pre(props: PreProps) {
      return <>{props.children}</>;
    },
    p(props: PProps) {
      return (
        <p className="mb-3 leading-7 whitespace-pre-wrap">{props.children}</p>
      );
    },
    a(props: AProps) {
      return (
        <a
          href={props.href}
          className="underline break-all"
          target="_blank"
          rel="noopener noreferrer"
        >
          {props.children}
        </a>
      );
    },
    ul(props: ListProps) {
      return (
        <ul className="list-disc list-inside mb-3 space-y-1">
          {props.children}
        </ul>
      );
    },
    ol(props: ListProps) {
      return (
        <ol className="list-decimal list-inside mb-3 space-y-1">
          {props.children}
        </ol>
      );
    },
  };

  return (
    <div className="text-sm" style={{ overflowWrap: "anywhere" }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

interface ToolCallInfo {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
}

interface ToolResultInfo {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly result: unknown;
  readonly isError?: boolean;
}

interface ClientToolRequestInfo {
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly timeoutMs: number;
}

function isToolCallInfo(value: unknown): value is ToolCallInfo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.toolCallId === "string" &&
    typeof v.toolName === "string" &&
    "args" in v
  );
}

function isToolResultInfo(value: unknown): value is ToolResultInfo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.toolCallId === "string" &&
    typeof v.toolName === "string" &&
    "result" in v
  );
}

function isClientToolRequestInfo(value: unknown): value is ClientToolRequestInfo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.runId === "string" &&
    typeof v.toolCallId === "string" &&
    typeof v.toolName === "string" &&
    typeof v.timeoutMs === "number" &&
    Number.isFinite(v.timeoutMs)
  );
}

function isCoordinatorPttStatus(value: unknown): value is CoordinatorPttStatus {
  return (
    value === "idle" ||
    value === "starting" ||
    value === "recording" ||
    value === "transcribing"
  );
}

function formatToolName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function flattenArgs(
  obj: unknown,
  prefix = "",
  result: Array<{ key: string; value: string }> = [],
  maxValueLength = 40,
): Array<{ key: string; value: string }> {
  if (obj === null || obj === undefined) return result;

  if (typeof obj !== "object") {
    const val =
      typeof obj === "string"
        ? `"${obj.length > maxValueLength ? obj.slice(0, maxValueLength) + "…" : obj}"`
        : String(obj);
    result.push({ key: prefix, value: val });
    return result;
  }

  if (Array.isArray(obj)) {
    result.push({
      key: prefix,
      value: `[${obj.length} item${obj.length === 1 ? "" : "s"}]`,
    });
    return result;
  }

  const entries = Object.entries(obj as Record<string, unknown>);
  for (const [key, value] of entries) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    flattenArgs(value, newKey, result, maxValueLength);
  }

  return result;
}

function truncateArgs(args: unknown, maxLength = 100): string {
  if (args === null || args === undefined) return "";
  if (typeof args === "string") {
    if (args.length <= maxLength) return args;
    return args.slice(0, maxLength) + "…";
  }
  if (typeof args !== "object") return String(args);

  const flattened = flattenArgs(args);
  if (flattened.length === 0) return "";

  const parts: string[] = [];
  let totalLength = 0;

  for (const { key, value } of flattened) {
    const formatted = `${key}=${value}`;
    if (totalLength + formatted.length + 2 > maxLength && parts.length > 0) {
      parts.push("…");
      break;
    }
    parts.push(formatted);
    totalLength += formatted.length + 2;
  }

  return parts.join(" ");
}

function readStoredRunId(storageKey: string): string | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function writeStoredRunId(storageKey: string, runId: string): void {
  try {
    localStorage.setItem(storageKey, runId);
  } catch {
    // ignore
  }
}

function clearStoredRunId(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
}

const DIALOG_PLACEHOLDERS = [
  // Keyboard hints
  "Message coordinator…\n↵ send  ·  ⇧↵ newline  ·  Ctrl+O expand tools",
  // Prompt suggestions
  "Open panels for my backend agent…",
  "List available agents and their status…",
  "Start a deep dive on the server implementation…",
  "What images are available to create agents from?",
  "Check if my agent runtime is healthy…",
  "Spin up a new agent and run a first prompt…",
  "Build and validate the latest image…",
  "Archive all idle agents…",
  "Export coordinator session data to the agent sandbox…",
  "Which agents are currently running?",
  "Inspect the agent SQLite database…",
];

export function ChatConversationPage(props: {
  readonly coordinatorSessionId: string | null;
  readonly variant?: "page" | "dialog";
  readonly showDelete?: boolean;
  readonly showTitle?: boolean;
  readonly allowCoordinatorComposeEvents?: boolean;
  readonly onDeleted?: () => void | Promise<void>;
  readonly onSessionCreated?: (coordinatorSessionId: string) => void;
}) {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [localCoordinatorSessionId, setLocalCoordinatorSessionId] = useState<
    string | null
  >(null);
  const coordinatorSessionId = props.coordinatorSessionId ?? localCoordinatorSessionId;
  const variant = props.variant ?? "page";
  const showDelete = props.showDelete ?? true;
  const showTitle = props.showTitle ?? true;
  const allowCoordinatorComposeEvents =
    props.allowCoordinatorComposeEvents ?? false;
  const canRenameSession = showTitle && !!coordinatorSessionId;
  const canDeleteSession = showDelete && !!coordinatorSessionId;
  const runStorageKey = coordinatorSessionId
    ? `agent-run:${coordinatorSessionId}`
    : null;
  const [message, setMessage] = useState("");
  const [coordinatorPttState, setCoordinatorPttState] =
    useState<CoordinatorPttStateDetail>({
      status: "idle",
      level: 0,
      microphoneLabel: null,
    });
  const [pttLevelTimeline, setPttLevelTimeline] = useState<readonly number[]>(
    [],
  );
  const pttLatestLevelRef = useRef(0);
  const [assistantText, setAssistantText] = useState("");
  const [streamingToolCalls, setStreamingToolCalls] = useState<
    readonly ToolCallInfo[]
  >([]);
  const [streamingToolResults, setStreamingToolResults] = useState<
    Record<string, ToolResultInfo>
  >({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [optimisticUserMessage, setOptimisticUserMessage] = useState<Message | null>(
    null,
  );
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string>("");
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamTokenRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const handledClientToolCallIdsRef = useRef<Set<string>>(new Set());
  const resumeSuppressedRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      // Draft -> real session id transition should not tear down active stream state.
      if (!runStorageKey) return;
      streamTokenRef.current += 1;
      reconnectAttemptRef.current = 0;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      handledClientToolCallIdsRef.current.clear();
    };
  }, [runStorageKey]);

  const setIsNearBottom = useCallback((next: boolean): void => {
    isNearBottomRef.current = next;
  }, []);

  const scrollToBottom = useCallback((): void => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const requestScrollToBottom = useCallback((): void => {
    if (!isNearBottomRef.current) return;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      scrollToBottom();
    });
  }, [scrollToBottom]);

  const conversationQuery = useQuery({
    queryKey: ["coordinatorSession", coordinatorSessionId],
    queryFn: async () => {
      if (!coordinatorSessionId) throw new Error("Coordinator session unavailable");
      return auth.api.getCoordinatorSession(coordinatorSessionId);
    },
    enabled: !!auth.user && !!coordinatorSessionId,
  });

  const messagesQuery = useQuery({
    queryKey: ["messages", coordinatorSessionId],
    queryFn: async () => {
      if (!coordinatorSessionId) throw new Error("Coordinator session unavailable");
      return auth.api.getCoordinatorSessionMessages(coordinatorSessionId);
    },
    enabled: !!auth.user && !!coordinatorSessionId,
  });
  const title = conversationQuery.data?.title ?? "New session";
  const displayedMessages = useMemo(() => {
    const persisted = messagesQuery.data?.data ?? [];
    if (!optimisticUserMessage) return persisted;
    const exists = persisted.some(
      (m) =>
        m.role === "user" &&
        m.content === optimisticUserMessage.content &&
        m.coordinatorSessionId === optimisticUserMessage.coordinatorSessionId,
    );
    if (exists) return persisted;
    return [...persisted, optimisticUserMessage];
  }, [messagesQuery.data?.data, optimisticUserMessage]);
  const displayedMessageCount = displayedMessages.length;

  const toolResultsMap = useMemo(() => {
    const map = new Map<string, ToolResultInfo>();
    for (const m of messagesQuery.data?.data ?? []) {
      if (!m.toolResults) continue;
      if (!Array.isArray(m.toolResults)) continue;
      for (const item of m.toolResults) {
        if (!isToolResultInfo(item)) continue;
        map.set(item.toolCallId, item);
      }
    }
    return map;
  }, [messagesQuery.data?.data]);

  const persistedToolCallIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of messagesQuery.data?.data ?? []) {
      if (!m.toolCalls) continue;
      if (!Array.isArray(m.toolCalls)) continue;
      for (const item of m.toolCalls) {
        if (!isToolCallInfo(item)) continue;
        ids.add(item.toolCallId);
      }
    }
    return ids;
  }, [messagesQuery.data?.data]);

  useEffect(() => {
    requestScrollToBottom();
  }, [displayedMessageCount, requestScrollToBottom]);

  const updateTitleMutation = useMutation({
    mutationFn: async (nextTitle: string) => {
      if (!coordinatorSessionId) {
        throw new Error("Coordinator session unavailable");
      }
      if (nextTitle.trim().length === 0)
        throw new Error("Title cannot be empty");
      return auth.api.updateCoordinatorSessionTitle(coordinatorSessionId, {
        title: nextTitle.trim(),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["coordinatorSession", coordinatorSessionId],
        }),
        queryClient.invalidateQueries({ queryKey: ["coordinatorSessions"] }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!coordinatorSessionId) {
        throw new Error("Coordinator session unavailable");
      }
      return auth.api.deleteCoordinatorSession(coordinatorSessionId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["coordinatorSessions"] });
      if (props.onDeleted) {
        await props.onDeleted();
        return;
      }
      if (variant === "page") {
        await navigate({ to: "/chat" });
      }
    },
  });

  const handleClientToolRequest = useCallback(
    (request: ClientToolRequestInfo): void => {
      const handled = handledClientToolCallIdsRef.current;
      if (handled.has(request.toolCallId)) return;
      handled.add(request.toolCallId);

      void (async () => {
        try {
          const actionResult = await executeCoordinatorClientToolRequest({
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            args: request.args,
            timeoutMs: request.timeoutMs,
            auth,
            navigate: async (input) => await navigate(input as never),
            queryClient,
          });
          await auth.api.submitCoordinatorToolResult({
            runId: request.runId,
            toolCallId: request.toolCallId,
            ok: actionResult.ok,
            result: actionResult,
            error: actionResult.ok ? undefined : actionResult.error?.message,
          });
        } catch (error) {
          const msg =
            error instanceof Error
              ? error.message
              : "Failed to submit client tool result";
          const uiState = getUiStateSnapshot(auth);
          try {
            await auth.api.submitCoordinatorToolResult({
              runId: request.runId,
              toolCallId: request.toolCallId,
              ok: false,
              result: {
                toolCallId: request.toolCallId,
                ok: false,
                error: {
                  code: "ACTION_EXECUTION_FAILED",
                  message: msg,
                  retryable: true,
                },
                uiStateBefore: uiState,
                uiStateAfter: getUiStateSnapshot(auth),
              },
              error: msg,
            });
          } catch {
            handled.delete(request.toolCallId);
          }
          setLocalError(msg);
        }
      })();
    },
    [auth, navigate, queryClient],
  );

  const addSessionToListCache = useCallback(
    (sessionId: string, updatedAtIso: string): void => {
      queryClient.setQueryData<ListCoordinatorSessionsResult>(
        ["coordinatorSessions"],
        (prev) => {
          const existing = prev?.data ?? [];
          if (existing.some((session) => session.id === sessionId)) return prev;
          return {
            data: [
              {
                id: sessionId,
                title: null,
                createdBy: auth.user?.id ?? "",
                createdAt: updatedAtIso,
                updatedAt: updatedAtIso,
              },
              ...existing,
            ],
            nextCursor: prev?.nextCursor ?? null,
          };
        },
      );
    },
    [auth.user?.id, queryClient],
  );

  const onStreamEvent = useCallback(
    (
      data: {
        readonly type?: string;
        readonly text?: string;
        readonly error?: string;
        readonly done?: boolean;
        readonly coordinatorSessionId?: string;
        readonly runId?: string;
        readonly toolCall?: unknown;
        readonly toolCallError?: unknown;
        readonly toolResult?: unknown;
        readonly clientToolRequest?: unknown;
      },
      activeRunStorageKey: string | null = runStorageKey,
    ): void => {
      if (typeof data.runId === "string" && data.runId.trim().length > 0) {
        if (activeRunStorageKey) {
          writeStoredRunId(activeRunStorageKey, data.runId);
        }
        resumeSuppressedRunIdRef.current = null;
      }
      if (
        data.type === "client_tool_request" &&
        isClientToolRequestInfo(data.clientToolRequest)
      ) {
        handleClientToolRequest(data.clientToolRequest);
      }
      if (data.text) {
        setAssistantText((prev) => prev + data.text);
        requestScrollToBottom();
      }
      if (data.error) {
        setLocalError(data.error);
        setIsStreaming(false);
        if (activeRunStorageKey) {
          clearStoredRunId(activeRunStorageKey);
        }
      }
      if (data.toolCall && isToolCallInfo(data.toolCall)) {
        const toolCall = data.toolCall;
        setStreamingToolCalls((prev) => {
          if (prev.some((p) => p.toolCallId === toolCall.toolCallId))
            return prev;
          return [...prev, toolCall];
        });
        requestScrollToBottom();

        if (typeof data.toolCallError === "string") {
          const toolCallId = toolCall.toolCallId;
          setStreamingToolResults((prev) => ({
            ...prev,
            [toolCallId]: {
              toolCallId,
              toolName: toolCall.toolName,
              result: data.toolCallError,
              isError: true,
            },
          }));
        }
      }
      if (data.toolResult && isToolResultInfo(data.toolResult)) {
        const toolResult = data.toolResult;
        const toolCallId = toolResult.toolCallId;
        setStreamingToolResults((prev) => ({
          ...prev,
          [toolCallId]: toolResult,
        }));
        requestScrollToBottom();
        // Tool results often correspond to filesystem changes; refresh diff panel if open.
        window.dispatchEvent(new Event("workspace-diff:refresh"));
      }

      if (data.done === true) {
        if (activeRunStorageKey) {
          clearStoredRunId(activeRunStorageKey);
        }
        resumeSuppressedRunIdRef.current = null;
        setIsStreaming(false);
      }
    },
    [handleClientToolRequest, requestScrollToBottom, runStorageKey],
  );

  const stopStream = useCallback(async (): Promise<{ readonly stopped: boolean }> => {
    const runId = runStorageKey ? readStoredRunId(runStorageKey) : null;
    if (runId) {
      resumeSuppressedRunIdRef.current = runId;
    }
    const stopped = isStreaming || runId !== null;

    streamTokenRef.current += 1;
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    handledClientToolCallIdsRef.current.clear();
    setIsStreaming(false);

    if (!runId) return { stopped };

    if (!auth.user) {
      if (runStorageKey) {
        clearStoredRunId(runStorageKey);
      }
      resumeSuppressedRunIdRef.current = null;
      return { stopped };
    }

    try {
      await auth.api.cancelRun(runId);
      if (runStorageKey) {
        clearStoredRunId(runStorageKey);
      }
      resumeSuppressedRunIdRef.current = null;
      setLocalError(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to cancel run";
      setLocalError(`Failed to cancel run (${msg}). It may still be running.`);
    }

    return { stopped };
  }, [auth.api, auth.user, isStreaming, runStorageKey]);

  const sleepMs = useCallback(
    (ms: number, signal?: AbortSignal): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        let id: number | null = null;
        const onAbort = () => {
          if (id !== null) window.clearTimeout(id);
          signal?.removeEventListener("abort", onAbort);
          reject(new Error("aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        id = window.setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, ms);
      });
    },
    [],
  );

  const resumeRunStream = useCallback(
    async (input: {
      readonly runId: string;
      readonly coordinatorSessionId: string;
      readonly runStorageKey: string;
      readonly token: number;
      readonly signal: AbortSignal;
    }): Promise<void> => {
      while (true) {
        if (input.signal.aborted) return;
        if (streamTokenRef.current !== input.token) return;

        let info: {
          readonly status: "running" | "completed" | "error" | "canceled";
          readonly errorMessage: string | null;
        } | null = null;
        try {
          info = await auth.api.getRun(input.runId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Failed to check run";
          if (msg === "Run not found") {
            clearStoredRunId(input.runStorageKey);
            resumeSuppressedRunIdRef.current = null;
            reconnectAttemptRef.current = 0;
            setLocalError(null);
            setIsStreaming(false);
            return;
          }
          const attempt = reconnectAttemptRef.current;
          const delayMs = Math.min(10_000, 1000 * Math.pow(2, attempt));
          reconnectAttemptRef.current = Math.min(attempt + 1, 4);
          setLocalError(`Stream disconnected (${msg}). Reconnecting…`);
          try {
            await sleepMs(delayMs, input.signal);
          } catch {
            return;
          }
          continue;
        }

        if (info.status === "completed") {
          clearStoredRunId(input.runStorageKey);
          resumeSuppressedRunIdRef.current = null;
          reconnectAttemptRef.current = 0;
          setLocalError(null);
          setIsStreaming(false);
          return;
        }

        if (info.status === "error") {
          clearStoredRunId(input.runStorageKey);
          resumeSuppressedRunIdRef.current = null;
          reconnectAttemptRef.current = 0;
          setLocalError(info.errorMessage ?? "Run failed");
          setIsStreaming(false);
          return;
        }

        if (info.status === "canceled") {
          clearStoredRunId(input.runStorageKey);
          resumeSuppressedRunIdRef.current = null;
          reconnectAttemptRef.current = 0;
          setLocalError(null);
          setIsStreaming(false);
          return;
        }

        setLocalError(null);
        try {
          await auth.api.runStream({
            runId: input.runId,
            signal: input.signal,
            onEvent: (data) => {
              if (streamTokenRef.current !== input.token) return;
              onStreamEvent(data, input.runStorageKey);
            },
          });
          reconnectAttemptRef.current = 0;
          setLocalError(null);
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: ["messages", input.coordinatorSessionId],
            }),
            queryClient.invalidateQueries({ queryKey: ["coordinatorSessions"] }),
          ]);
          setAssistantText("");
          // If the server closes without a `{done:true}` event, stop resuming.
          clearStoredRunId(input.runStorageKey);
          resumeSuppressedRunIdRef.current = null;
          setIsStreaming(false);
          return;
        } catch (e) {
          if (input.signal.aborted) return;
          const msg = e instanceof Error ? e.message : "Stream disconnected";
          const attempt = reconnectAttemptRef.current;
          const delayMs = Math.min(10_000, 1000 * Math.pow(2, attempt));
          reconnectAttemptRef.current = Math.min(attempt + 1, 4);
          setLocalError(`Stream disconnected (${msg}). Reconnecting…`);
          try {
            await sleepMs(delayMs, input.signal);
          } catch {
            return;
          }
          continue;
        }
      }
    },
    [
      auth.api,
      onStreamEvent,
      queryClient,
      sleepMs,
    ],
  );

  const storedRunId = runStorageKey ? readStoredRunId(runStorageKey) : null;
  useEffect(() => {
    if (!auth.user) return;
    if (!coordinatorSessionId || !runStorageKey) return;
    if (isStreaming) return;
    if (!storedRunId) return;
    if (storedRunId === resumeSuppressedRunIdRef.current) return;

    const token = streamTokenRef.current + 1;
    streamTokenRef.current = token;
    reconnectAttemptRef.current = 0;

    streamAbortRef.current?.abort();
    const abort = new AbortController();
    streamAbortRef.current = abort;

    handledClientToolCallIdsRef.current.clear();
    setAssistantText("");
    setStreamingToolCalls([]);
    setStreamingToolResults({});
    setIsStreaming(true);
    setIsNearBottom(true);

    void resumeRunStream({
      runId: storedRunId,
      coordinatorSessionId,
      runStorageKey,
      token,
      signal: abort.signal,
    });

    return () => {
      abort.abort();
      if (streamAbortRef.current === abort) streamAbortRef.current = null;
    };
  }, [
    auth.user,
    coordinatorSessionId,
    isStreaming,
    resumeRunStream,
    runStorageKey,
    setIsNearBottom,
    storedRunId,
  ]);

  const runSendFlow = useCallback(
    async (rawText: string): Promise<void> => {
      const trimmed = rawText.trim();
      if (!trimmed) return;

      let activeCoordinatorSessionId = coordinatorSessionId;
      if (!activeCoordinatorSessionId) {
        try {
          const createdSession = await auth.api.createCoordinatorSession();
          activeCoordinatorSessionId = createdSession.id;
          setLocalCoordinatorSessionId(createdSession.id);
          addSessionToListCache(createdSession.id, createdSession.updatedAt);
          props.onSessionCreated?.(createdSession.id);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Failed to create session";
          setLocalError(msg);
          return;
        }
      }
      const activeRunStorageKey = `agent-run:${activeCoordinatorSessionId}`;

      const token = streamTokenRef.current + 1;
      streamTokenRef.current = token;
      streamAbortRef.current?.abort();
      const abort = new AbortController();
      streamAbortRef.current = abort;
      reconnectAttemptRef.current = 0;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      handledClientToolCallIdsRef.current.clear();
      clearStoredRunId(activeRunStorageKey);
      resumeSuppressedRunIdRef.current = null;
      setLocalError(null);
      setAssistantText("");
      setStreamingToolCalls([]);
      setStreamingToolResults({});
      setIsStreaming(true);
      setMessage("");
      setIsNearBottom(true);

      let shouldStopStreaming = true;
      try {
        const optimisticUserMessage: Message = {
          id: `optimistic-${crypto.randomUUID()}`,
          coordinatorSessionId: activeCoordinatorSessionId,
          role: "user",
          content: trimmed,
          createdAt: new Date().toISOString(),
        };
        setOptimisticUserMessage(optimisticUserMessage);
        queryClient.setQueryData<GetMessagesResult>(
          ["messages", activeCoordinatorSessionId],
          (prev) => ({
            data: [...(prev?.data ?? []), optimisticUserMessage],
          }),
        );
        requestScrollToBottom();

        const started = await auth.api.startCoordinatorRun({
          coordinatorSessionId: activeCoordinatorSessionId,
          message: trimmed,
          browserAvailable: true,
        });
        writeStoredRunId(activeRunStorageKey, started.runId);
        resumeSuppressedRunIdRef.current = null;

        await auth.api.runStream({
          runId: started.runId,
          signal: abort.signal,
          onEvent: (data) => {
            if (streamTokenRef.current !== token) return;
            onStreamEvent(data, activeRunStorageKey);
          },
        });
        await queryClient.invalidateQueries({
          queryKey: ["messages", activeCoordinatorSessionId],
        });
        await queryClient.invalidateQueries({ queryKey: ["coordinatorSessions"] });
        setAssistantText("");
        setOptimisticUserMessage(null);
      } catch (e) {
        if (abort.signal.aborted) return;
        const msg = e instanceof Error ? e.message : "Chat failed";
        const runId = readStoredRunId(activeRunStorageKey);
        if (runId) {
          setLocalError(`Stream disconnected (${msg}). Reconnecting…`);
          shouldStopStreaming = false;
          void resumeRunStream({
            runId,
            coordinatorSessionId: activeCoordinatorSessionId,
            runStorageKey: activeRunStorageKey,
            token,
            signal: abort.signal,
          });
          return;
        }
        setOptimisticUserMessage(null);
        setLocalError(msg);
      } finally {
        if (shouldStopStreaming && streamTokenRef.current === token) {
          setIsStreaming(false);
        }
        if (streamAbortRef.current === abort) streamAbortRef.current = null;
      }
    },
    [
      addSessionToListCache,
      auth.api,
      coordinatorSessionId,
      onStreamEvent,
      props.onSessionCreated,
      queryClient,
      requestScrollToBottom,
      resumeRunStream,
      setIsNearBottom,
    ],
  );

  const onSend = useCallback(() => {
    void runSendFlow(message);
  }, [message, runSendFlow]);

  const [openToolCalls, setOpenToolCalls] = useState<Set<string>>(new Set());
  const [inputPlaceholder] = useState(() =>
    DIALOG_PLACEHOLDERS[Math.floor(Math.random() * DIALOG_PLACEHOLDERS.length)],
  );
  const lastAutoOpenedStreamingToolCallIdRef = useRef<string | null>(null);

  const allToolCallIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const ids: string[] = [];
    for (const m of messagesQuery.data?.data ?? []) {
      if (!Array.isArray(m.toolCalls)) continue;
      for (const tc of m.toolCalls) {
        if (isToolCallInfo(tc)) ids.push(tc.toolCallId);
      }
    }
    for (const tc of streamingToolCalls) ids.push(tc.toolCallId);
    allToolCallIdsRef.current = ids;
  }, [messagesQuery.data?.data, streamingToolCalls]);

  const latestStreamingToolCallId =
    streamingToolCalls[streamingToolCalls.length - 1]?.toolCallId ?? null;
  const streamingToolCallIds = useMemo(
    () => streamingToolCalls.map((tc) => tc.toolCallId),
    [streamingToolCalls],
  );

  useEffect(() => {
    if (variant !== "dialog") {
      lastAutoOpenedStreamingToolCallIdRef.current = null;
      return;
    }
    if (!isStreaming) {
      lastAutoOpenedStreamingToolCallIdRef.current = null;
      return;
    }
    if (!latestStreamingToolCallId) return;
    if (
      lastAutoOpenedStreamingToolCallIdRef.current === latestStreamingToolCallId
    ) {
      return;
    }
    lastAutoOpenedStreamingToolCallIdRef.current = latestStreamingToolCallId;
    setOpenToolCalls((prev) => {
      const next = new Set(prev);
      for (const toolCallId of streamingToolCallIds) {
        if (toolCallId !== latestStreamingToolCallId) {
          next.delete(toolCallId);
        }
      }
      next.add(latestStreamingToolCallId);
      if (next.size === prev.size) {
        let changed = false;
        for (const id of prev) {
          if (!next.has(id)) {
            changed = true;
            break;
          }
        }
        if (!changed) return prev;
      }
      return next;
    });
  }, [isStreaming, latestStreamingToolCallId, streamingToolCallIds, variant]);

  useEffect(() => {
    if (variant !== "dialog") return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        const ids = allToolCallIdsRef.current;
        setOpenToolCalls((prev) => {
          const allOpen = ids.length > 0 && ids.every((id) => prev.has(id));
          if (allOpen) return new Set<string>();
          return new Set<string>(ids);
        });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [variant]);

  useEffect(() => {
    if (!allowCoordinatorComposeEvents) return;

    const onCompose = (
      event: Event,
    ): void => {
      const detail = (event as CustomEvent<{
        readonly text?: unknown;
        readonly replace?: unknown;
        readonly focus?: unknown;
        readonly send?: unknown;
      }>).detail;
      const text = typeof detail?.text === "string" ? detail.text : "";
      if (!text.trim()) return;

      const replace = detail?.replace === true;
      const composedText = replace
        ? text
        : !message.trim()
          ? text
          : `${message.trimEnd()} ${text}`;
      if (detail?.send === true) {
        if (!isStreaming) {
          void runSendFlow(composedText);
        } else {
          setMessage(composedText);
        }
      } else {
        setMessage(composedText);
      }

      if (detail?.focus === true) {
        requestAnimationFrame(() => {
          const input = messageInputRef.current;
          if (!input) return;
          input.focus();
          const at = input.value.length;
          input.setSelectionRange(at, at);
        });
      }
    };

    window.addEventListener(COORDINATOR_COMPOSE_EVENT, onCompose as EventListener);
    return () => {
      window.removeEventListener(
        COORDINATOR_COMPOSE_EVENT,
        onCompose as EventListener,
      );
    };
  }, [allowCoordinatorComposeEvents, isStreaming, message, runSendFlow]);

  useEffect(() => {
    if (!allowCoordinatorComposeEvents) {
      setCoordinatorPttState({ status: "idle", level: 0, microphoneLabel: null });
      return;
    }

    const onPttState = (event: Event): void => {
      const detail = (event as CustomEvent<{
        readonly status?: unknown;
        readonly level?: unknown;
        readonly microphoneLabel?: unknown;
      }>).detail;
      if (!isCoordinatorPttStatus(detail?.status)) return;
      const rawLevel =
        typeof detail?.level === "number" && Number.isFinite(detail.level)
          ? detail.level
          : 0;
      const microphoneLabel =
        typeof detail?.microphoneLabel === "string" &&
        detail.microphoneLabel.trim().length > 0
          ? detail.microphoneLabel.trim()
          : null;
      setCoordinatorPttState({
        status: detail.status,
        level: Math.max(0, Math.min(1, rawLevel)),
        microphoneLabel,
      });
    };

    window.addEventListener(COORDINATOR_PTT_STATE_EVENT, onPttState as EventListener);
    return () => {
      window.removeEventListener(
        COORDINATOR_PTT_STATE_EVENT,
        onPttState as EventListener,
      );
    };
  }, [allowCoordinatorComposeEvents]);

  useEffect(() => {
    pttLatestLevelRef.current = coordinatorPttState.level;
  }, [coordinatorPttState.level]);

  useEffect(() => {
    if (coordinatorPttState.status !== "recording") {
      setPttLevelTimeline([]);
      return;
    }

    const timer = window.setInterval(() => {
      setPttLevelTimeline((prev) => {
        const next = [...prev, Math.max(0, Math.min(1, pttLatestLevelRef.current))];
        if (next.length <= PTT_TIMELINE_POINTS) return next;
        return next.slice(next.length - PTT_TIMELINE_POINTS);
      });
    }, PTT_TIMELINE_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [coordinatorPttState.status]);

  useEffect(() => {
    return registerChatRuntimeController(variant, {
      sendMessage: async (text: string) => {
        if (isStreaming) {
          throw new Error("Chat is currently streaming");
        }
        void runSendFlow(text);
        return { accepted: true, streamingStarted: true };
      },
      stopStream: async () => {
        return await stopStream();
      },
      isStreaming: () => isStreaming,
      hasConversation: () => coordinatorSessionId !== null,
    });
  }, [coordinatorSessionId, isStreaming, runSendFlow, stopStream, variant]);

  const formatJson = (value: unknown): string | null => {
    if (typeof value === "undefined") return null;
    if (value === null) return "null";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const ToolCallRow = (input: {
    readonly toolCall: ToolCallInfo;
    readonly toolResult: ToolResultInfo | null;
    readonly isOpen?: boolean;
    readonly onOpenChange?: (open: boolean) => void;
  }) => {
    const tc = input.toolCall;
    const toolResult = input.toolResult;
    const hasCustomUI = !!ToolUIMap[tc.toolName];
    const isPending = toolResult === null;

    const toolBadge = (() => {
      const lower = tc.toolName.toLowerCase();
      if (lower.includes("bash") || lower.includes("shell")) return "bash";
      if (lower.startsWith("ui")) return "ui";
      const words = tc.toolName.replace(/([A-Z])/g, " $1").trim().split(" ");
      return words[0].toLowerCase();
    })();

    return (
      <Collapsible
        open={input.isOpen}
        onOpenChange={input.onOpenChange}
        className="flex flex-col min-w-0 w-full"
      >
        <CollapsibleTrigger className="flex items-center gap-2 w-full min-w-0 text-left group py-0.5 cursor-pointer">
          <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90" />
          <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-px font-mono shrink-0 leading-tight">
            {toolBadge}
          </span>
          <span className="text-xs text-muted-foreground font-mono truncate flex-1 min-w-0">
            {truncateArgs(tc.args, 120)}
          </span>
          {isPending ? (
            <span className="h-2.5 w-2.5 rounded-full border border-muted-foreground/30 border-t-muted-foreground animate-spin shrink-0" />
          ) : toolResult.isError ? (
            <span className="text-destructive text-xs shrink-0">✗</span>
          ) : (
            <Check className="h-3 w-3 text-green-500 shrink-0" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pl-5 mt-1 mb-1 space-y-2">
            {hasCustomUI ? (
              <>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Args
                  </p>
                  {renderToolArgs(tc.toolName, tc.args)}
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Result
                  </p>
                  {toolResult ? (
                    renderToolResult(tc.toolName, toolResult.result)
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Running...
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Args
                  </p>
                  <pre className="whitespace-pre-wrap overflow-auto rounded-none border bg-muted/30 p-2 text-xs">
                    {formatJson(tc.args)}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Result
                  </p>
                  <pre
                    className={
                      toolResult?.isError
                        ? "whitespace-pre-wrap overflow-auto rounded-none border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
                        : "whitespace-pre-wrap overflow-auto rounded-none border bg-muted/30 p-2 text-xs"
                    }
                  >
                    {toolResult ? formatJson(toolResult.result) : "Running..."}
                  </pre>
                </div>
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  if (!auth.user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Please log in.</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  const saveTitleIfChanged = async () => {
    if (!conversationQuery.data) return;

    const nextTitle = titleDraft.trim();
    const currentTitle = (conversationQuery.data.title ?? "").trim();

    if (nextTitle.length === 0 || nextTitle === currentTitle) {
      setTitleDraft(conversationQuery.data.title ?? "");
      return;
    }

    try {
      await updateTitleMutation.mutateAsync(nextTitle);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to rename";
      setLocalError(msg);
      setTitleDraft(conversationQuery.data.title ?? "");
    }
  };

  if (!showTitle && isEditingTitle) {
    setIsEditingTitle(false);
  }

  const showPttIndicator =
    allowCoordinatorComposeEvents && coordinatorPttState.status !== "idle";
  const pttStatusText =
    coordinatorPttState.status === "starting"
      ? "Starting microphone..."
      : coordinatorPttState.status === "recording"
        ? "Recording... release Cmd/Ctrl + . to finish"
        : "Transcribing...";

  return (
    <div
      className={[
        "flex flex-col",
        variant === "dialog" ? "h-full gap-0" : "h-[calc(100vh-100px)] gap-4",
      ].join(" ")}
    >
      {canRenameSession || canDeleteSession ? (
        <div className="flex items-start justify-between gap-3">
          <div className="w-full">
            {canRenameSession ? (
              isEditingTitle ? (
                <input
                  ref={titleInputRef}
                  value={titleDraft}
                  className="active:outline-none focus:outline-none"
                  onChange={(e) => setTitleDraft(e.target.value)}
                  disabled={updateTitleMutation.isPending}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={() => {
                    setIsEditingTitle(false);
                    void saveTitleIfChanged();
                  }}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      titleInputRef.current?.blur();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setIsEditingTitle(false);
                      setTitleDraft(conversationQuery.data?.title ?? "");
                      titleInputRef.current?.blur();
                    }
                  }}
                />
              ) : (
                <button
                  className="flex justify-start w-full cursor-text"
                  onClick={() => {
                    setLocalError(null);
                    setTitleDraft(conversationQuery.data?.title ?? "");
                    setIsEditingTitle(true);
                  }}
                >
                  {title}
                </button>
              )
            ) : null}
          </div>
          {canDeleteSession ? (
            <Button
              className="w-auto"
              size="icon"
              variant="icon"
              onClick={() => {
                const ok = window.confirm("Delete this coordinator session?");
                if (!ok) return;
                void deleteMutation.mutateAsync();
              }}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className={["flex flex-col overflow-auto", variant === "dialog" ? "h-full" : "gap-4 h-full"].join(" ")}>
        {updateTitleMutation.isError ? (
          <div className={["border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive", variant === "dialog" ? "mx-4 mt-3 rounded-lg" : "rounded-none"].join(" ")}>
            {(updateTitleMutation.error as Error).message}
          </div>
        ) : null}

        {localError ? (
          <div className={["border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive", variant === "dialog" ? "mx-4 mt-3 rounded-lg" : "rounded-none"].join(" ")}>
            {localError}
          </div>
        ) : null}

        <div
          ref={scrollContainerRef}
          className="flex h-full overflow-y-auto overflow-x-hidden min-w-0"
          onScroll={() => {
            const el = scrollContainerRef.current;
            if (!el) return;
            const distanceFromBottom =
              el.scrollHeight - el.scrollTop - el.clientHeight;
            setIsNearBottom(distanceFromBottom <= 100);
          }}
        >
          <div className={["flex flex-col flex-1 min-w-0 w-full", variant === "dialog" ? "px-4 py-3 gap-3" : ""].join(" ")}>
            {messagesQuery.isLoading &&
            displayedMessages.length === 0 &&
            !isStreaming &&
            assistantText.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Loading messages...
              </div>
            ) : messagesQuery.isError ? (
              <div className="text-sm text-destructive">
                {(messagesQuery.error as Error).message}
              </div>
            ) : (
              <div className={variant === "dialog" ? "flex flex-col gap-2" : "space-y-3"}>
                {displayedMessages
                  .filter((m) => m.role !== "tool")
                  .map((m) => (
                    <div key={m.id} className={variant === "dialog" ? "flex flex-col gap-0.5 min-w-0 w-full" : ""}>
                      {m.content.trim().length > 0 ? (
                        variant === "dialog" ? (
                          m.role === "user" ? (
                            <div className="flex justify-end">
                              <div className="max-w-[82%] bg-primary text-primary-foreground px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed">
                                {m.content}
                              </div>
                            </div>
                          ) : (
                            <div className="max-w-[92%] text-sm">
                              <AssistantMessageContent content={m.content} />
                            </div>
                          )
                        ) : (
                          <div
                            className={
                              m.role === "user"
                                ? "whitespace-pre-wrap text-sm w-full border bg-muted px-3 py-2"
                                : "text-sm"
                            }
                          >
                            {m.role === "assistant" ? (
                              <AssistantMessageContent content={m.content} />
                            ) : (
                              m.content
                            )}
                          </div>
                        )
                      ) : null}
                      {m.toolCalls
                        ? Array.isArray(m.toolCalls)
                          ? m.toolCalls
                              .filter(isToolCallInfo)
                              .map((tc) => (
                                <ToolCallRow
                                  key={tc.toolCallId}
                                  toolCall={tc}
                                  toolResult={
                                    toolResultsMap.get(tc.toolCallId) ?? null
                                  }
                                  isOpen={openToolCalls.has(tc.toolCallId)}
                                  onOpenChange={(open) =>
                                    setOpenToolCalls((prev) => {
                                      const next = new Set(prev);
                                      if (open) next.add(tc.toolCallId);
                                      else next.delete(tc.toolCallId);
                                      return next;
                                    })
                                  }
                                />
                              ))
                          : null
                        : null}
                    </div>
                  ))}
                {isStreaming &&
                streamingToolCalls.filter(
                  (tc) => !persistedToolCallIds.has(tc.toolCallId),
                ).length > 0 ? (
                  <div className="flex flex-col">
                    {streamingToolCalls
                      .filter((tc) => !persistedToolCallIds.has(tc.toolCallId))
                      .map((tc) => (
                        <ToolCallRow
                          key={tc.toolCallId}
                          toolCall={tc}
                          toolResult={
                            streamingToolResults[tc.toolCallId] ?? null
                          }
                          isOpen={openToolCalls.has(tc.toolCallId)}
                          onOpenChange={(open) =>
                            setOpenToolCalls((prev) => {
                              const next = new Set(prev);
                              if (open) next.add(tc.toolCallId);
                              else next.delete(tc.toolCallId);
                              return next;
                            })
                          }
                        />
                      ))}
                  </div>
                ) : null}
                {isStreaming && assistantText ? (
                  <div className={variant === "dialog" ? "max-w-[92%] text-sm" : ""}>
                    {variant !== "dialog" ? (
                      <div className="mb-1 font-mono text-xs text-muted-foreground">
                        assistant (streaming)
                      </div>
                    ) : null}
                    <AssistantMessageContent content={assistantText} />
                  </div>
                ) : null}
                {isStreaming && variant === "dialog" ? (
                  <div className="pt-1 pb-3">
                    <Loader label="Working…" />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
        <div
          className={[
            "relative",
            variant === "dialog" ? "border-t border-border/60 shrink-0" : "",
          ].join(" ")}
        >
          {showPttIndicator ? (
            <div
              className={[
                "pointer-events-none absolute z-20",
                variant === "dialog"
                  ? "left-4 right-4 -top-16"
                  : "left-0 right-0 -top-16",
              ].join(" ")}
            >
              <div className="rounded-lg border border-border/70 bg-surface-1/95 px-3 py-2 text-xs text-text-primary shadow-md backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={
                        coordinatorPttState.status === "recording"
                          ? "h-2 w-2 rounded-full bg-red-500 animate-pulse"
                          : "h-2 w-2 rounded-full bg-amber-500 animate-pulse"
                      }
                    />
                    {pttStatusText}
                  </span>
                </div>
                {coordinatorPttState.microphoneLabel ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Mic: {coordinatorPttState.microphoneLabel}
                  </div>
                ) : null}
                {coordinatorPttState.status === "recording" ? (
                  <div className="mt-2 flex h-6 items-end gap-[2px]">
                    {Array.from({ length: PTT_TIMELINE_POINTS }, (_, index) => {
                      const sample = pttLevelTimeline[index] ?? null;
                      const intensity = sample ?? 0;
                      const height = 2 + intensity * 18;
                      const opacity = sample === null ? 0.15 : 0.3 + intensity * 0.7;
                      return (
                        <span
                          key={index}
                          className="h-0 w-full flex-1 rounded-full bg-emerald-500/90 transition-[height,opacity] duration-75"
                          style={{ height, opacity }}
                        />
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <Textarea
            ref={messageInputRef}
            rows={variant === "dialog" ? 2 : 3}
            value={message}
            placeholder={variant === "dialog" ? inputPlaceholder : "Type your message..."}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!isStreaming) void onSend();
              }
            }}
            disabled={variant !== "dialog" && isStreaming}
            className={["resize-none", variant === "dialog" ? "bg-transparent border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 px-4 py-3 text-sm" : "bg-surface-4 pr-20"].join(" ")}
            autoFocus
          />
          {variant !== "dialog" ? (
            <Button
              disabled={isStreaming ? false : !message.trim()}
              onClick={() => (isStreaming ? void stopStream() : void onSend())}
              className="rounded-full absolute bottom-2 right-2 h-6 w-6"
              size="icon"
            >
              {isStreaming ? (
                <Square className="h-3 w-3" />
              ) : (
                <Send className="h-3 w-3" />
              )}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
