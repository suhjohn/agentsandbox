import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { PickerPopover, type PickerItem } from "@/components/ui/picker-popover";
import { StatusBadge } from "./components";
import { getAgents, type GetAgents200 } from "@/api/generated/agent-manager";
import {
  getSession,
  getSessionId,
  type GetSessionId200,
  type GetSession200,
  type GetSessionParams,
} from "@/api/generated/agent";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID_REGEX = /^[0-9a-f]{32}$/i;

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null && "error" in value) {
    const err = (value as { error?: unknown }).error;
    if (typeof err === "string" && err.trim().length > 0) return err;
  }
  if (typeof value === "string" && value.trim().length > 0) return value;
  return "Something went wrong.";
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

function formatSessionUpdatedAt(value?: string | null): ReactNode {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const label = new Date(time).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <span className="text-[11px] text-text-tertiary whitespace-nowrap">
      {label}
    </span>
  );
}

function unwrapAgents(value: unknown): GetAgents200 | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.data)) return v as GetAgents200;
  if (Array.isArray(v.agents)) return v as GetAgents200;
  return null;
}

function unwrapSessions(value: unknown): GetSession200 | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.data === "object" && v.data !== null) {
    const d = v.data as Record<string, unknown>;
    if (Array.isArray(d.sessions)) return d as GetSession200;
  }
  if (Array.isArray(v.sessions)) return v as GetSession200;
  return null;
}

function unwrapSession(value: unknown): GetSessionId200 | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.data === "object" && v.data !== null) {
    const d = v.data as Record<string, unknown>;
    if (
      typeof d.id === "string" &&
      typeof d.agentId === "string" &&
      Array.isArray(d.messages)
    ) {
      return d as GetSessionId200;
    }
  }
  if (
    typeof v.id === "string" &&
    typeof v.agentId === "string" &&
    Array.isArray((v as { messages?: unknown }).messages)
  ) {
    return v as GetSessionId200;
  }
  return null;
}

type AgentOption = {
  readonly id: string;
  readonly name?: string | null;
  readonly status: string;
  readonly imageName?: string | null;
  readonly updatedAt?: string | null;
};

type AgentPickerProps = {
  readonly value: string;
  readonly onChange: (next: {
    readonly agentId: string;
    readonly agentName?: string | null;
  }) => void;
  readonly selectedAgent?: {
    readonly id: string;
    readonly name?: string | null;
    readonly status?: string | null;
  };
  readonly disabled?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
};

export function AgentPicker(props: AgentPickerProps) {
  const [open, setOpenRaw] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenRaw(next);
    props.onOpenChange?.(next);
    if (!next) setQuery("");
  };
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const agentsQuery = useInfiniteQuery({
    queryKey: ["agentPicker", debouncedQuery.trim()],
    enabled: open,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const result = await getAgents(
        {
          limit: 20,
          cursor: pageParam ?? undefined,
          q: debouncedQuery.trim() || undefined,
        },
        { signal },
      );
      const parsed: GetAgents200 | null = unwrapAgents(result);
      const agents = parsed?.data ?? [];
      const normalized: AgentOption[] = agents.map((agent) => ({
        id: agent.id,
        name: agent.name ?? null,
        status: agent.status,
        imageName: agent.image?.name ?? null,
        updatedAt: agent.updatedAt ?? null,
      }));
      return { items: normalized, nextCursor: parsed?.nextCursor ?? null };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const items = useMemo<AgentOption[]>(() => {
    const pages = agentsQuery.data?.pages ?? [];
    const out: AgentOption[] = [];
    for (const page of pages) out.push(...page.items);
    return out;
  }, [agentsQuery.data?.pages]);

  const manualAgentId = useMemo(() => {
    const candidate = debouncedQuery.trim();
    if (!UUID_REGEX.test(candidate)) return null;
    if (items.some((item) => item.id === candidate)) return null;
    return candidate;
  }, [debouncedQuery, items]);

  const selectedLabel =
    props.selectedAgent?.name?.trim() || (props.value ? "Agent" : "");
  const pickerItems = useMemo<PickerItem[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        title: item.name?.trim() || item.id,
        subtitle: item.name?.trim() ? item.id : undefined,
        meta: <StatusBadge status={item.status} />,
      })),
    [items],
  );

  function handleSelect(agentId: string) {
    const selected =
      items.find((item) => item.id === agentId) ??
      (props.selectedAgent?.id === agentId
        ? {
            id: props.selectedAgent.id,
            name: props.selectedAgent.name ?? null,
          }
        : null);

    props.onChange({
      agentId,
      agentName: selected?.name?.trim() || null,
    });
    setOpen(false);
  }

  return (
    <PickerPopover
      valueId={props.value}
      placeholder="Select an agent"
      queryPlaceholder="Search agents by name or ID…"
      valueLabel={selectedLabel}
      query={query}
      onQueryChange={setQuery}
      open={open}
      onOpenChange={setOpen}
      items={pickerItems}
      sectionLabel="Agents"
      manualOption={
        manualAgentId
          ? {
              label: `Use agent ID ${manualAgentId}`,
              onSelect: () => handleSelect(manualAgentId),
            }
          : undefined
      }
      loading={open && agentsQuery.isLoading}
      loadingMore={agentsQuery.isFetchingNextPage}
      error={agentsQuery.isError ? toErrorMessage(agentsQuery.error) : null}
      hasMore={agentsQuery.hasNextPage}
      onLoadMore={() => {
        if (agentsQuery.hasNextPage) void agentsQuery.fetchNextPage();
      }}
      onSelect={handleSelect}
      emptyLabel={
        debouncedQuery.trim() ? "No matching agents." : "No agents yet."
      }
      disabled={props.disabled}
    />
  );
}

type SessionOption = {
  readonly id: string;
  readonly harness: string;
  readonly title?: string | null;
  readonly updatedAt?: string | null;
};

type SessionPickerProps = {
  readonly agentId: string;
  readonly value: string;
  readonly onChange: (next: {
    readonly sessionId: string;
    readonly sessionTitle?: string | null;
  }) => void;
  readonly access: {
    readonly agentApiUrl: string;
    readonly agentAuthToken: string;
  } | null;
  readonly disabled?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
};

export function SessionPicker(props: SessionPickerProps) {
  const [open, setOpenRaw] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenRaw(next);
    props.onOpenChange?.(next);
    if (!next) setQuery("");
  };
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const sessionsQuery = useInfiniteQuery({
    queryKey: [
      "sessionPicker",
      props.agentId,
      props.access?.agentApiUrl ?? null,
      debouncedQuery.trim(),
    ],
    enabled: open && Boolean(props.agentId) && Boolean(props.access),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      if (!props.access) throw new Error("Missing runtime access");

      const params: GetSessionParams = {
        limit: 20,
        cursor: pageParam ?? undefined,
        q: debouncedQuery.trim() || undefined,
      };

      const result = await getSession(params, {
        signal,
        baseUrl: props.access.agentApiUrl,
        agentAuthToken: props.access.agentAuthToken,
      } as unknown as RequestInit);

      const parsed = unwrapSessions(result);
      const sessions = parsed?.sessions ?? [];
      const normalized: SessionOption[] = sessions.map((session) => ({
        id: session.id,
        harness: session.harness,
        title: session.title ?? null,
        updatedAt: session.updatedAt ?? null,
      }));
      return { items: normalized, nextCursor: parsed?.nextCursor ?? null };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const items = useMemo<SessionOption[]>(() => {
    const pages = sessionsQuery.data?.pages ?? [];
    const out: SessionOption[] = [];
    for (const page of pages) out.push(...page.items);
    return out;
  }, [sessionsQuery.data?.pages]);

  const currentSessionQuery = useQuery({
    queryKey: [
      "agentRuntime",
      props.agentId,
      "session",
      props.value,
      props.access?.agentApiUrl ?? null,
    ],
    enabled: Boolean(
      props.agentId &&
      props.value.trim().length > 0 &&
      props.access?.agentApiUrl &&
      props.access?.agentAuthToken,
    ),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!props.access) {
        throw new Error("Missing runtime access");
      }
      const response = await getSessionId(props.value, {
        signal,
        baseUrl: props.access.agentApiUrl,
        agentAuthToken: props.access.agentAuthToken,
      } as unknown as RequestInit);
      const session = unwrapSession(response);
      if (!session) throw new Error("Unexpected response shape (getSessionId).");
      return session;
    },
  });

  const manualSessionId = useMemo(() => {
    const candidate = debouncedQuery.trim();
    if (!SESSION_ID_REGEX.test(candidate)) return null;
    if (items.some((item) => item.id === candidate)) return null;
    return candidate;
  }, [debouncedQuery, items]);

  const pickerItems = useMemo<PickerItem[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        title: item.title?.trim() || "Untitled session",
        subtitle: `${item.id} · ${item.harness}`,
        meta: formatSessionUpdatedAt(item.updatedAt),
      })),
    [items],
  );

  const currentItem = currentSessionQuery.data
    ? {
        id: currentSessionQuery.data.id,
        harness: currentSessionQuery.data.harness,
        title: currentSessionQuery.data.title ?? null,
        updatedAt: currentSessionQuery.data.updatedAt ?? null,
      }
    : null;

  const currentItems = useMemo<PickerItem[]>(
    () =>
      currentItem
        ? [
            {
              id: currentItem.id,
              title: currentItem.title?.trim() || "Untitled session",
              subtitle: `${currentItem.id} · ${currentItem.harness}`,
              meta: formatSessionUpdatedAt(currentItem.updatedAt),
            },
          ]
        : [],
    [currentItem],
  );

  function handleSelect(sessionId: string) {
    const selected =
      items.find((item) => item.id === sessionId) ??
      (currentItem?.id === sessionId ? currentItem : null);
    props.onChange({
      sessionId,
      sessionTitle: selected?.title ?? null,
    });
    setOpen(false);
  }

  const selectedSession = props.value
    ? (items.find((s) => s.id === props.value) ??
      (currentItem?.id === props.value ? currentItem : null))
    : null;
  const selectedLabel = selectedSession
    ? selectedSession.title?.trim() || `${selectedSession.harness}`
    : props.value
      ? "Session"
      : "New session";

  return (
    <PickerPopover
      valueId={props.value}
      placeholder="Select a session"
      queryPlaceholder="Search sessions by title…"
      valueLabel={selectedLabel}
      query={query}
      onQueryChange={setQuery}
      open={open}
      onOpenChange={setOpen}
      items={pickerItems}
      recentItems={currentItems}
      recentSectionLabel="Current"
      sectionLabel="List"
      manualOption={
        manualSessionId
          ? {
              label: `Use session ID ${manualSessionId}`,
              onSelect: () => handleSelect(manualSessionId),
            }
          : undefined
      }
      loading={open && sessionsQuery.isLoading}
      loadingMore={sessionsQuery.isFetchingNextPage}
      error={
        open && !props.access
          ? "Missing runtime access"
          : sessionsQuery.isError
            ? toErrorMessage(sessionsQuery.error)
            : null
      }
      hasMore={sessionsQuery.hasNextPage}
      onLoadMore={() => {
        if (sessionsQuery.hasNextPage) void sessionsQuery.fetchNextPage();
      }}
      onSelect={handleSelect}
      emptyLabel={
        debouncedQuery.trim() ? "No matching sessions." : "No sessions yet."
      }
      disabled={props.disabled}
      footer={
        <div className="text-[11px] text-text-tertiary">
          {props.agentId ? `Agent ${props.agentId.slice(0, 8)}…` : ""}
        </div>
      }
    />
  );
}
