import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import type { AgentType, AgentVisibility } from "@/lib/api";
import type { PanelDefinition, PanelProps, PanelSettingsProps } from "./types";

export interface CreateAgentPanelConfig {
  readonly imageId: string;
  readonly region: string;
  readonly parentAgentId: string;
  readonly type: AgentType;
  readonly visibility: AgentVisibility;
}

function deserializeCreateAgentConfig(raw: unknown): CreateAgentPanelConfig {
  if (typeof raw !== "object" || raw === null) {
    return {
      imageId: "",
      region: "",
      parentAgentId: "",
      type: "worker",
      visibility: "private",
    };
  }
  const v = raw as Record<string, unknown>;
  const imageId = typeof v.imageId === "string" ? v.imageId : "";
  const region = typeof v.region === "string" ? v.region : "";
  const parentAgentId = typeof v.parentAgentId === "string" ? v.parentAgentId : "";
  const type = v.type === "coordinator" ? "coordinator" : "worker";
  const visibility = v.visibility === "shared" ? "shared" : "private";
  return { imageId, region, parentAgentId, type, visibility };
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

function parseRegion(value: string): string | readonly string[] | undefined {
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
  const auth = useAuth();
  const mutation = useMutation({
    mutationFn: async (input: {
      readonly imageId: string;
      readonly parentAgentId?: string;
      readonly region?: string | readonly string[];
      readonly type: AgentType;
      readonly visibility: AgentVisibility;
    }) => await auth.api.createAgent(input),
  });

  const canCreate = useMemo(() => {
    if (mutation.isPending) return false;
    return props.config.imageId.trim().length > 0;
  }, [mutation.isPending, props.config.imageId]);

  const createBody: {
    readonly imageId: string;
    readonly parentAgentId?: string;
    readonly region?: string | readonly string[];
    readonly type: AgentType;
    readonly visibility: AgentVisibility;
  } | null = useMemo(() => {
    const imageId = props.config.imageId.trim();
    if (!imageId) return null;

    const parentAgentId = props.config.parentAgentId.trim();

    const body: {
      imageId: string;
      parentAgentId?: string;
      region?: string | readonly string[];
      type: AgentType;
      visibility: AgentVisibility;
    } = {
      imageId,
      type: props.config.type,
      visibility: props.config.visibility,
    };
    if (parentAgentId) body.parentAgentId = parentAgentId;

    const region = parseRegion(props.config.region);
    if (region) body.region = region;

    return body;
  }, [
    props.config.imageId,
    props.config.parentAgentId,
    props.config.region,
    props.config.type,
    props.config.visibility,
  ]);

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
          <div className="space-y-1.5">
            <div className="text-xs text-text-tertiary">Type</div>
            <select
              className="h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-xs"
              value={props.config.type}
              onChange={(e) =>
                props.setConfig((prev) => ({
                  ...prev,
                  type: e.target.value === "coordinator" ? "coordinator" : "worker",
                }))
              }
            >
              <option value="worker">worker</option>
              <option value="coordinator">coordinator</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs text-text-tertiary">Visibility</div>
            <select
              className="h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-xs"
              value={props.config.visibility}
              onChange={(e) =>
                props.setConfig((prev) => ({
                  ...prev,
                  visibility: e.target.value === "shared" ? "shared" : "private",
                }))
              }
            >
              <option value="private">private</option>
              <option value="shared">shared</option>
            </select>
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
                const created = await mutation.mutateAsync(createBody);
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
        <div className="space-y-1.5">
          <div className="text-xs text-text-tertiary">Default type</div>
          <select
            className="h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-xs"
            value={props.config.type}
            onChange={(e) =>
              props.setConfig((prev) => ({
                ...prev,
                type: e.target.value === "coordinator" ? "coordinator" : "worker",
              }))
            }
          >
            <option value="worker">worker</option>
            <option value="coordinator">coordinator</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-text-tertiary">Default visibility</div>
          <select
            className="h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-xs"
            value={props.config.visibility}
            onChange={(e) =>
              props.setConfig((prev) => ({
                ...prev,
                visibility: e.target.value === "shared" ? "shared" : "private",
              }))
            }
          >
            <option value="private">private</option>
            <option value="shared">shared</option>
          </select>
        </div>
      </div>
    </div>
  );
}

export const createAgentPanelDefinition: PanelDefinition<CreateAgentPanelConfig> = {
  type: "agent_create",
  title: "Create Agent",
  configVersion: 3,
  defaultConfig: {
    imageId: "",
    region: "",
    parentAgentId: "",
    type: "worker",
    visibility: "private",
  },
  deserializeConfig: (raw) => deserializeCreateAgentConfig(raw),
  getTitle: () => "Create Agent",
  Component: CreateAgentPanel,
  SettingsComponent: CreateAgentSettings,
};
