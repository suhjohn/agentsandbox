import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  usePostAgents,
  type PostAgentsBody,
  type PostAgents201,
} from "@/api/generated/agent-manager";
import type { PanelDefinition, PanelProps, PanelSettingsProps } from "./types";

export interface CreateAgentPanelConfig {
  readonly imageId: string;
  readonly region: string;
  readonly parentAgentId: string;
}

function deserializeCreateAgentConfig(raw: unknown): CreateAgentPanelConfig {
  if (typeof raw !== "object" || raw === null) {
    return { imageId: "", region: "", parentAgentId: "" };
  }
  const v = raw as Record<string, unknown>;
  const imageId = typeof v.imageId === "string" ? v.imageId : "";
  const region = typeof v.region === "string" ? v.region : "";
  const parentAgentId = typeof v.parentAgentId === "string" ? v.parentAgentId : "";
  return { imageId, region, parentAgentId };
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

function unwrapCreatedAgent(value: unknown): PostAgents201 | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.data === "object" && v.data !== null) {
    const d = v.data as Record<string, unknown>;
    if (typeof d.id === "string") return d as PostAgents201;
  }
  if (typeof v.id === "string") return v as PostAgents201;
  return null;
}

function parseRegion(value: string): PostAgentsBody["region"] | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parts = trimmed
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? undefined;
  return parts;
}

export function CreateAgentPanel(props: PanelProps<CreateAgentPanelConfig>) {
  const mutation = usePostAgents();

  const canCreate = useMemo(() => {
    if (mutation.isPending) return false;
    return props.config.imageId.trim().length > 0;
  }, [mutation.isPending, props.config.imageId]);

  const createBody: PostAgentsBody | null = useMemo(() => {
    const imageId = props.config.imageId.trim();
    if (!imageId) return null;

    const parentAgentId = props.config.parentAgentId.trim();

    const body: PostAgentsBody = { imageId };
    if (parentAgentId) body.parentAgentId = parentAgentId;

    const region = parseRegion(props.config.region);
    if (region) body.region = region;

    return body;
  }, [props.config.imageId, props.config.parentAgentId, props.config.region]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs text-text-tertiary">Create agent</div>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="secondary"
          className="h-8"
          onClick={() => props.runtime.replaceSelf("agent_list")}
        >
          Back to agents
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="text-xs text-text-tertiary">Image ID (required)</div>
            <Input
              className="bg-surface-1 border border-border font-mono text-xs"
              value={props.config.imageId}
              onChange={(e) =>
                props.setConfig((prev) => ({ ...prev, imageId: e.target.value }))
              }
              placeholder="imageId"
            />
          </div>
          <div className="space-y-1.5">
            <div className="text-xs text-text-tertiary">Region (optional)</div>
            <Input
              className="bg-surface-1 border border-border font-mono text-xs"
              value={props.config.region}
              onChange={(e) =>
                props.setConfig((prev) => ({ ...prev, region: e.target.value }))
              }
              placeholder='e.g. "us-west-2" or "us-west-2,us-east-1"'
            />
          </div>
          <div className="space-y-1.5">
            <div className="text-xs text-text-tertiary">Parent agent ID (optional)</div>
            <Input
              className="bg-surface-1 border border-border font-mono text-xs"
              value={props.config.parentAgentId}
              onChange={(e) =>
                props.setConfig((prev) => ({ ...prev, parentAgentId: e.target.value }))
              }
              placeholder="parentAgentId"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-8"
            disabled={!canCreate || !createBody}
            onClick={async () => {
              if (!createBody) return;
              try {
                const res = await mutation.mutateAsync({ data: createBody });
                const created = unwrapCreatedAgent(res);
                if (created) {
                  props.runtime.replaceSelf("agent_detail", {
                    agentId: created.id,
                    agentName: created.name?.trim() || "",
                    activeTab: "session_list",
                    sessionLimit: 20,
                    sessionId: "",
                    sessionTitle: "",
                    diffBasis: "repo_head",
                    diffStyle: "split",
                  });
                }
              } catch {
                // Error state is rendered from `mutation.error`.
              }
            }}
          >
            {mutation.isPending ? "Creating…" : "Create"}
          </Button>
          <div
            className={cn(
              "text-xs",
              props.config.imageId.trim().length === 0
                ? "text-text-tertiary"
                : "text-text-secondary",
            )}
          >
            Requires `imageId`.
          </div>
        </div>

        {mutation.isError ? (
          <div className="text-sm text-destructive">
            {toErrorMessage(mutation.error)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CreateAgentSettings(props: PanelSettingsProps<CreateAgentPanelConfig>) {
  return (
    <div className="space-y-3">
      <div className="text-sm text-text-secondary">
        Values persist with the window preset.
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <div className="text-xs text-text-tertiary">Default imageId</div>
          <Input
            value={props.config.imageId}
            onChange={(e) =>
              props.setConfig((prev) => ({ ...prev, imageId: e.target.value }))
            }
            placeholder="imageId"
          />
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-text-tertiary">Default region</div>
          <Input
            value={props.config.region}
            onChange={(e) =>
              props.setConfig((prev) => ({ ...prev, region: e.target.value }))
            }
            placeholder="(optional)"
          />
        </div>
      </div>
    </div>
  );
}

export const createAgentPanelDefinition: PanelDefinition<CreateAgentPanelConfig> = {
  type: "agent_create",
  title: "Create Agent",
  configVersion: 2,
  defaultConfig: { imageId: "", region: "", parentAgentId: "" },
  deserializeConfig: (raw) => deserializeCreateAgentConfig(raw),
  getTitle: () => "Create Agent",
  Component: CreateAgentPanel,
  SettingsComponent: CreateAgentSettings,
};
