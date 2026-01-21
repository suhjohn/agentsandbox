import { SandboxLoader } from "@/components/loader";
import { TerminalPanel } from "@/components/terminal-panel";
import { requestTerminalConnectAuthed } from "@/lib/terminal-connect";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import type { PanelProps } from "./types";

export interface AgentTerminalPanelConfig {
  readonly agentId: string;
  readonly agentName?: string;
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null && "error" in value) {
    const err = (value as { error?: unknown }).error;
    if (typeof err === "string" && err.trim().length > 0) return err;
  }
  if (typeof value === "string" && value.trim().length > 0) return value;
  return "Something went wrong.";
}

export function AgentTerminalPanel(
  props: PanelProps<AgentTerminalPanelConfig>,
) {
  const auth = useAuth();
  const agentId =
    typeof props.config.agentId === "string" ? props.config.agentId.trim() : "";

  const terminalConnectQuery = useQuery({
    queryKey: ["workspace", "agent-terminal", agentId],
    queryFn: async () =>
      requestTerminalConnectAuthed({
        fetchAuthed: auth.fetchAuthed,
        targetType: "agentSandbox",
        targetId: agentId,
      }),
    enabled: Boolean(auth.user) && agentId.length > 0,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const refetchTerminalConnect = terminalConnectQuery.refetch;
  const handleConnectionLost = useCallback(() => {
    void refetchTerminalConnect();
  }, [refetchTerminalConnect]);

  if (agentId.length === 0) {
    return (
      <div className="text-sm text-text-secondary">
        Select an agent to open its terminal.
      </div>
    );
  }

  if (!auth.user) {
    return (
      <div className="text-sm text-text-secondary">
        Sign in to open the terminal.
      </div>
    );
  }

  if (terminalConnectQuery.isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-text-secondary">
        <SandboxLoader label="starting up the sandbox" />
      </div>
    );
  }

  if (terminalConnectQuery.isError) {
    return (
      <div className="text-sm text-destructive">
        {toErrorMessage(terminalConnectQuery.error)}
      </div>
    );
  }

  if (!terminalConnectQuery.data) {
    return (
      <div className="text-sm text-text-secondary">
        Missing terminal connect credentials.
      </div>
    );
  }

  if (terminalConnectQuery.data.wsUrl.trim().length === 0) {
    return (
      <div className="text-sm text-text-secondary">
        Invalid terminal websocket URL.
      </div>
    );
  }

  if (terminalConnectQuery.data.authToken.trim().length === 0) {
    return (
      <div className="text-sm text-text-secondary">
        Invalid terminal websocket auth token.
      </div>
    );
  }

  return (
    <TerminalPanel
      wsUrl={terminalConnectQuery.data.wsUrl}
      wsAuthToken={terminalConnectQuery.data.authToken}
      onConnectionLost={handleConnectionLost}
    />
  );
}
