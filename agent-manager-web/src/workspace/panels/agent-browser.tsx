import { SandboxLoader } from "@/components/loader";
import { useAuth } from "@/lib/auth";
import { useAgentRuntimeAccess } from "../hooks/use-agent-runtime-access";
import type { PanelProps } from "./types";

export interface AgentBrowserPanelConfig {
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

export function AgentBrowserPanel(props: PanelProps<AgentBrowserPanelConfig>) {
  const auth = useAuth();
  const agentId =
    typeof props.config.agentId === "string" ? props.config.agentId.trim() : "";
  const { accessQuery, access } = useAgentRuntimeAccess(agentId, {
    caller: "agent-browser-panel",
    enabled: agentId.length > 0,
    staleTime: 10_000,
  });

  if (agentId.length === 0) {
    return (
      <div className="text-sm text-text-secondary">
        Select an agent to open its browser.
      </div>
    );
  }

  if (!auth.user) {
    return (
      <div className="text-sm text-text-secondary">
        Sign in to open the browser.
      </div>
    );
  }

  if (accessQuery.isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-text-secondary">
        <SandboxLoader label="starting up the sandbox" />
      </div>
    );
  }

  if (accessQuery.isError) {
    return (
      <div className="text-sm text-destructive">
        {toErrorMessage(accessQuery.error)}
      </div>
    );
  }

  if (!access) {
    return (
      <div className="text-sm text-text-secondary">Missing runtime access.</div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden">
      <iframe
        title="Browser"
        className="w-full h-full bg-surface-1"
        src={access.noVncUrl}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
