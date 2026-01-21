import type { GetSessionId200MessagesItem } from "@/api/generated/agent";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseBody(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw.trim()) as unknown;
  } catch {
    return raw;
  }
}

function getEventType(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const type = body.type;
  return typeof type === "string" ? type : null;
}

function getItemMeta(body: unknown): { id: string; itemType: string } | null {
  if (!isRecord(body)) return null;
  const type = body.type;
  if (
    type !== "item.started" &&
    type !== "item.updated" &&
    type !== "item.completed"
  ) {
    return null;
  }
  const item = body.item;
  if (!isRecord(item)) return null;
  const id = item.id;
  if (typeof id !== "string") return null;
  const itemType = item.type;
  return { id, itemType: typeof itemType === "string" ? itemType : "" };
}

function getDedupeScopeIndex(messages: GetSessionId200MessagesItem[]): number[] {
  const scopeByIndex = new Array<number>(messages.length);
  let currentTurn = 0;

  for (let i = 0; i < messages.length; i++) {
    const body = parseBody(messages[i].body);
    const type = getEventType(body);

    if (type === "thread.started") {
      currentTurn = 0;
    } else if (type === "turn.started") {
      currentTurn += 1;
    }

    scopeByIndex[i] = currentTurn;
  }

  return scopeByIndex;
}

export function deduplicateMessages(
  messages: GetSessionId200MessagesItem[],
): GetSessionId200MessagesItem[] {
  const scopeByIndex = getDedupeScopeIndex(messages);
  const latestByKey = new Map<string, number>();

  for (let i = 0; i < messages.length; i++) {
    const body = parseBody(messages[i].body);
    const meta = getItemMeta(body);
    if (!meta) continue;
    const scope = scopeByIndex[i] ?? 0;
    const key = `${scope}:${meta.itemType}:${meta.id}`;
    latestByKey.set(key, i);
  }

  const result: GetSessionId200MessagesItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const body = parseBody(messages[i].body);
    const meta = getItemMeta(body);

    if (!meta) {
      result.push(messages[i]);
      continue;
    }

    const scope = scopeByIndex[i] ?? 0;
    const key = `${scope}:${meta.itemType}:${meta.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const latestIdx = latestByKey.get(key);
    if (latestIdx == null) continue;
    result.push(messages[latestIdx]);
  }

  return result;
}

