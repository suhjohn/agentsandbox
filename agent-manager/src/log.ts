import { env } from "./env";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

function normalizeLogLevel(value: string): LogLevel {
  const v = value.trim().toLowerCase();
  if (v === "debug" || v === "info" || v === "warn" || v === "error" || v === "silent") return v;
  return "info";
}

const currentLevel: LogLevel = normalizeLogLevel(env.LOG_LEVEL);

function isEnabled(level: Exclude<LogLevel, "silent">): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[currentLevel];
}

type LogMeta = Readonly<Record<string, unknown>>;

const REDACTED_VALUE = "[REDACTED]";

const SENSITIVE_KEY_PATTERN =
  /(?:^|[-_])(password|passwd|passphrase|secret|token|api[-_]?key|authorization|cookie|set-cookie|x-agent-auth|x-agent-manager-api-key)(?:$|[-_])/i;

const SENSITIVE_QUERY_KEYS = new Set([
  "tkn",
  "password",
  "_modal_connect_token",
  "access_token",
  "refresh_token",
  "token",
  "auth",
  "authorization",
  "api_key",
  "x-agent-auth",
  "x-agent-manager-api-key",
  "cookie",
  "set-cookie",
]);

function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "path" || normalized === "url") return false;
  return SENSITIVE_KEY_PATTERN.test(normalized);
}

function maybeRedactAbsoluteOrRelativeUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || !trimmed.includes("?")) return value;

  const redact = (url: URL): string => {
    for (const [key] of url.searchParams.entries()) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, REDACTED_VALUE);
      }
    }
    return url.toString();
  };

  try {
    const absolute = new URL(trimmed);
    return redact(absolute);
  } catch {
    // Continue to relative-path attempt below.
  }

  if (!trimmed.startsWith("/")) return value;

  try {
    const base = new URL("https://log.redaction.local");
    const relative = new URL(trimmed, base);
    const redacted = redact(relative);
    const asUrl = new URL(redacted);
    return `${asUrl.pathname}${asUrl.search}${asUrl.hash}`;
  } catch {
    return value;
  }
}

function redactInlineAuthArtifacts(value: string): string {
  let next = value;
  next = next.replace(
    /\b(Bearer)\s+[A-Za-z0-9\-._~+/=]+\b/gi,
    `$1 ${REDACTED_VALUE}`,
  );
  next = next.replace(
    /\b(auth\.bearer\.|agent-auth\.|bearer\.)[A-Za-z0-9\-._~+/=]+\b/gi,
    `$1${REDACTED_VALUE}`,
  );
  next = next.replace(
    /([?&](?:tkn|password|_modal_connect_token|access_token|refresh_token|token|auth|authorization|api_key)=)[^&#\s]*/gi,
    `$1${REDACTED_VALUE}`,
  );
  return next;
}

function sanitizeStringForLog(key: string, value: string): string {
  if (isSensitiveKey(key)) return REDACTED_VALUE;
  const withUrlRedaction = maybeRedactAbsoluteOrRelativeUrl(value);
  return redactInlineAuthArtifacts(withUrlRedaction);
}

function serializeError(err: unknown): unknown {
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number): unknown => {
    if (!(value instanceof Error)) return value;
    if (depth > 5) return { name: value.name, message: value.message };
    if (seen.has(value)) return { name: value.name, message: value.message, stack: "[Circular]" };
    seen.add(value);

    const out: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };

    const errAny = value as unknown as Record<string, unknown>;
    const extraKeys: readonly string[] = [
      "code",
      "detail",
      "hint",
      "schema",
      "table",
      "column",
      "constraint",
      "severity",
      "where",
    ];

    for (const key of extraKeys) {
      const v = errAny[key];
      if (typeof v === "string" && v.trim().length > 0) out[key] = v;
    }

    if ("cause" in errAny) {
      out.cause = visit(errAny.cause, depth + 1);
    }

    return out;
  };

  return visit(err, 0);
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, v) => {
    if (v instanceof Error) return serializeError(v);
    if (typeof v === "string") return sanitizeStringForLog(_key, v);
    if (isSensitiveKey(_key) && v !== null && v !== undefined) {
      return REDACTED_VALUE;
    }
    if (typeof v === "object" && v !== null) {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
    }
    return v;
  });
}

function write(level: Exclude<LogLevel, "silent">, msg: string, meta?: LogMeta): void {
  if (!isEnabled(level)) return;
  const line = meta ? `${msg} ${safeStringify(meta)}` : msg;
  const prefix = `${new Date().toISOString()} ${level.toUpperCase()}`;
  if (level === "error") console.error(prefix, line);
  else if (level === "warn") console.warn(prefix, line);
  else console.log(prefix, line);
}

export const log = {
  debug(msg: string, meta?: LogMeta) {
    write("debug", msg, meta);
  },
  info(msg: string, meta?: LogMeta) {
    write("info", msg, meta);
  },
  warn(msg: string, meta?: LogMeta) {
    write("warn", msg, meta);
  },
  error(msg: string, meta?: LogMeta) {
    write("error", msg, meta);
  },
} as const;
