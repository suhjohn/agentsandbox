import { useEffect, useState } from "react";
import type { GetSessionId200MessagesItem } from "@/api/generated/agent";
import type { UserInput } from "@openai/codex-sdk";
import type { HarnessMessageSender } from "@/harnesses/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { MessageSenderHeader } from "@/components/messages/message-sender-header";
import { MessageTextBlock } from "@/components/messages/message-text-block";
import { StatusIndicator } from "@/components/messages/status-indicator";

type OpencodeUserInputEvent = {
  readonly type: "user_input";
  readonly input: readonly UserInput[];
};

type OpencodeTextPart = {
  readonly id?: string;
  readonly text?: string;
};

type OpencodeToolPart = {
  readonly id?: string;
  readonly tool?: string;
  readonly status?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly metadata?: unknown;
  readonly error?: unknown;
};

type OpencodeTextEvent = {
  readonly type: "text" | "reasoning";
  readonly part: OpencodeTextPart;
};

type OpencodeToolUseEvent = {
  readonly type: "tool_use";
  readonly part: OpencodeToolPart;
};

type OpencodeErrorEvent = {
  readonly type: "error";
  readonly message?: unknown;
};

type OpencodeRawEvent = {
  readonly type: string;
  readonly [key: string]: unknown;
};

type OpencodeMessageBody =
  | OpencodeUserInputEvent
  | OpencodeTextEvent
  | OpencodeToolUseEvent
  | OpencodeErrorEvent
  | OpencodeRawEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOpencodeUserInput(value: unknown): value is UserInput {
  if (!isRecord(value)) return false;
  if (value.type === "text") return typeof value.text === "string";
  if (value.type === "local_image") return typeof value.path === "string";
  return false;
}

function isOpencodeUserInputEvent(
  value: unknown,
): value is OpencodeUserInputEvent {
  if (!isRecord(value)) return false;
  if (value.type !== "user_input") return false;
  if (!Array.isArray(value.input)) return false;
  return value.input.every(isOpencodeUserInput);
}

function isOpencodeTextPart(value: unknown): value is OpencodeTextPart {
  if (!isRecord(value)) return false;
  if (value.id !== undefined && typeof value.id !== "string") return false;
  if (value.text !== undefined && typeof value.text !== "string") return false;
  return true;
}

function isOpencodeToolPart(value: unknown): value is OpencodeToolPart {
  if (!isRecord(value)) return false;
  if (value.id !== undefined && typeof value.id !== "string") return false;
  if (value.tool !== undefined && typeof value.tool !== "string") return false;
  if (value.status !== undefined && typeof value.status !== "string")
    return false;
  return true;
}

function isOpencodeTextEvent(value: unknown): value is OpencodeTextEvent {
  return (
    isRecord(value) &&
    (value.type === "text" || value.type === "reasoning") &&
    isOpencodeTextPart(value.part)
  );
}

function isOpencodeToolUseEvent(value: unknown): value is OpencodeToolUseEvent {
  return (
    isRecord(value) &&
    value.type === "tool_use" &&
    isOpencodeToolPart(value.part)
  );
}

function isOpencodeErrorEvent(value: unknown): value is OpencodeErrorEvent {
  return isRecord(value) && value.type === "error";
}

export function isOpencodeMessageBody(
  value: unknown,
): value is OpencodeMessageBody {
  if (isOpencodeUserInputEvent(value)) return true;
  if (isOpencodeTextEvent(value)) return true;
  if (isOpencodeToolUseEvent(value)) return true;
  if (isOpencodeErrorEvent(value)) return true;
  return isRecord(value) && typeof value.type === "string";
}

function parseOpencodeBody(raw: unknown): OpencodeMessageBody | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isOpencodeMessageBody(parsed)) return parsed;
    } catch {
      return null;
    }
    return null;
  }
  if (isOpencodeMessageBody(raw)) return raw;
  return null;
}

function formatUserInput(input: readonly UserInput[]): string | null {
  const parts: string[] = [];
  for (const item of input) {
    if (item.type === "text") {
      if (item.text.trim().length > 0) parts.push(item.text);
      continue;
    }
    if (item.type === "local_image") {
      const path = item.path.trim();
      if (path.length > 0) parts.push(`[image: ${path}]`);
    }
  }
  const content = parts.join("\n\n").trim();
  return content.length > 0 ? content : null;
}

function formatMaybeJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return "";
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatArgsFlat(args: unknown, prefix = ""): string[] {
  if (args == null) return [];
  if (typeof args === "string") {
    return prefix ? [`${prefix}: ${args}`] : [args];
  }
  if (Array.isArray(args)) {
    const items = args.map((item) =>
      typeof item === "object" && item !== null
        ? JSON.stringify(item)
        : String(item),
    );
    return prefix ? [`${prefix}: ${items.join(", ")}`] : [items.join(", ")];
  }
  if (typeof args === "object") {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(
      args as Record<string, unknown>,
    )) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value === null || value === undefined) {
        lines.push(`${fullKey}: null`);
      } else if (typeof value === "object" && !Array.isArray(value)) {
        lines.push(...formatArgsFlat(value, fullKey));
      } else if (Array.isArray(value)) {
        lines.push(
          `${fullKey}: ${value.map((item) => String(item)).join(", ")}`,
        );
      } else {
        lines.push(`${fullKey}: ${String(value)}`);
      }
    }
    return lines;
  }
  return prefix ? [`${prefix}: ${String(args)}`] : [String(args)];
}

function truncateArgs(args: unknown, maxLen = 60): string {
  const lines = formatArgsFlat(args);
  if (lines.length === 0) return "";
  let text = lines.join(", ");
  if (lines.length === 1 && lines[0].includes(": ")) {
    text = lines[0].split(": ").slice(1).join(": ");
  }
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

function useCollapsibleToggleAll(initial = false) {
  const [isOpen, setIsOpen] = useState(initial);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean }>).detail;
      if (detail && typeof detail.open === "boolean") {
        setIsOpen(detail.open);
      }
    };
    window.addEventListener("collapsible:toggle-all", handler);
    return () => window.removeEventListener("collapsible:toggle-all", handler);
  }, []);
  return [isOpen, setIsOpen] as const;
}

function normalizeToolStatus(status: string | undefined): string {
  if (status === "completed") return "completed";
  if (status === "error") return "failed";
  if (status === "running") return "started";
  return status ?? "completed";
}

function extractText(body: OpencodeMessageBody): string | null {
  if (isOpencodeUserInputEvent(body)) return formatUserInput(body.input);
  if (isOpencodeTextEvent(body)) {
    const text = body.part.text?.trim() ?? "";
    return text.length > 0 ? text : null;
  }
  if (isOpencodeErrorEvent(body)) {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    return message.length > 0 ? message : null;
  }
  const raw = body as Record<string, unknown>;
  const part = isRecord(raw.part) ? raw.part : null;
  const partText = typeof part?.text === "string" ? part.text.trim() : "";
  if (partText.length > 0) return partText;
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  if (message.length > 0) return message;
  const error = isRecord(raw.error) ? raw.error : null;
  const errorMessage =
    typeof error?.message === "string" ? error.message.trim() : "";
  if (errorMessage.length > 0) return errorMessage;
  return null;
}

function summarizeRawEvent(body: OpencodeRawEvent): string {
  const text = extractText(body);
  if (text) return text.length > 80 ? text.slice(0, 80) + "…" : text;

  const part = isRecord(body.part) ? body.part : null;
  const reason = typeof part?.reason === "string" ? part.reason.trim() : "";
  if (reason.length > 0) return reason;

  const tokens = isRecord(part?.tokens) ? part.tokens : null;
  if (tokens) {
    const input = typeof tokens.input === "number" ? tokens.input : null;
    const output = typeof tokens.output === "number" ? tokens.output : null;
    if (input !== null || output !== null) {
      const pieces: string[] = [];
      if (input !== null) pieces.push(`in ${input}`);
      if (output !== null) pieces.push(`out ${output}`);
      return pieces.join(", ");
    }
  }

  return "";
}

function RawEventBlock(props: { readonly body: OpencodeRawEvent }) {
  const [isOpen, setIsOpen] = useCollapsibleToggleAll();
  const payload = formatMaybeJson(props.body);
  const summary = summarizeRawEvent(props.body);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="w-full text-sm"
      data-collapsible-toggle-all="true"
      data-collapsible-open={isOpen ? "true" : "false"}
    >
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-1 border-none cursor-pointer">
        <span className="font-mono text-text-primary truncate">
          <span className="font-bold">{props.body.type}</span>
          {summary ? (
            <span className="text-text-tertiary ml-3">{summary}</span>
          ) : null}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-4 mt-1 px-3 py-2 bg-surface-3 text-xs">
        <pre className="m-0 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
          {payload}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolUseBlock(props: { readonly part: OpencodeToolPart }) {
  const [isOpen, setIsOpen] = useCollapsibleToggleAll();
  const requestJson = formatMaybeJson(props.part.input);
  const outputJson = formatMaybeJson(props.part.output);
  const metadataJson = formatMaybeJson(props.part.metadata);
  const errorText =
    typeof props.part.error === "string"
      ? props.part.error.trim()
      : formatMaybeJson(props.part.error).trim();
  const hasResponse =
    outputJson.length > 0 || metadataJson.length > 0 || errorText.length > 0;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="w-full text-sm"
      data-collapsible-toggle-all="true"
      data-collapsible-open={isOpen ? "true" : "false"}
    >
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-1 border-none cursor-pointer">
        <StatusIndicator status={normalizeToolStatus(props.part.status)} />
        <span className="font-mono text-text-primary truncate">
          <span className="font-bold">{props.part.tool ?? "tool"}</span>
          {props.part.input !== undefined ? (
            <span className="text-text-tertiary ml-3">
              {truncateArgs(props.part.input)}
            </span>
          ) : null}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-4 mt-1 px-3 py-2 bg-surface-3 text-xs">
        {requestJson.length > 0 ? (
          <>
            <div className="text-[11px] uppercase tracking-wide text-text-tertiary">
              Request
            </div>
            <pre className="m-0 pt-1 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">
              {requestJson}
            </pre>
          </>
        ) : null}
        {hasResponse ? (
          <>
            <div className="pt-2 text-[11px] uppercase tracking-wide text-text-tertiary">
              Response
            </div>
            {outputJson.length > 0 ? (
              <pre className="m-0 pt-1 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                {outputJson}
              </pre>
            ) : null}
            {metadataJson.length > 0 ? (
              <pre className="m-0 pt-1 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                {metadataJson}
              </pre>
            ) : null}
            {errorText.length > 0 ? (
              <div className="pt-1 text-xs text-[var(--color-destructive)]">
                Error: {errorText}
              </div>
            ) : null}
          </>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function OpencodeMessages(props: {
  readonly messages: readonly GetSessionId200MessagesItem[];
  readonly senderById?: Readonly<Record<string, HarnessMessageSender>>;
}) {
  const displayMessages = props.messages
    .map((message) => ({
      key: message.id,
      message,
      body: parseOpencodeBody(message.body),
    }))
    .filter(
      (
        item,
      ): item is {
        readonly key: string;
        readonly message: GetSessionId200MessagesItem;
        readonly body: OpencodeMessageBody;
      } => item.body !== null,
    );

  return (
    <>
      {displayMessages.map(({ key, message, body }, index) => (
        <OpencodeMessage
          key={key}
          message={message}
          body={body}
          isFirst={index === 0}
          sender={getMessageSender(message, props.senderById)}
        />
      ))}
    </>
  );
}

function OpencodeMessage(props: {
  readonly message: GetSessionId200MessagesItem;
  readonly body: OpencodeMessageBody;
  readonly isFirst?: boolean;
  readonly sender?: HarnessMessageSender;
}) {
  const { body } = props;

  if (isOpencodeUserInputEvent(body)) {
    const text = formatUserInput(body.input);
    if (!text) return null;
    return (
      <div className={props.isFirst ? "" : "mt-8"}>
        {props.sender ? <MessageSenderHeader sender={props.sender} /> : null}
        <div className="w-full bg-surface-4 px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {text}
        </div>
      </div>
    );
  }

  if (isOpencodeToolUseEvent(body)) {
    return <ToolUseBlock part={body.part} />;
  }

  if (isOpencodeErrorEvent(body)) {
    const text = extractText(body);
    if (!text) return null;
    return <div className="text-sm text-red-500">{text}</div>;
  }

  if (isOpencodeTextEvent(body)) {
    const text = extractText(body);
    if (!text) return null;
    return (
      <MessageTextBlock
        text={text}
        className={
          body.type === "reasoning" ? "py-2 text-text-secondary" : undefined
        }
      />
    );
  }

  return <RawEventBlock body={body} />;
}

function getMessageSender(
  message: GetSessionId200MessagesItem,
  senderById: Readonly<Record<string, HarnessMessageSender>> | undefined,
): HarnessMessageSender | undefined {
  if (typeof message.createdBy !== "string" || message.createdBy.length === 0) {
    return undefined;
  }
  return senderById?.[message.createdBy];
}
