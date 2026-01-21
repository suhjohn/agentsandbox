import type { PanelDefinition } from "./types";
import { coordinatorPanelDefinition } from "./coordinator";
import { listAgentsPanelDefinition } from "./list-agents";
import { agentDetailPanelDefinition } from "./agent-detail";
import { createAgentPanelDefinition } from "./create-agent";
import { emptyPanelDefinition } from "./empty";

const definitions = [
  coordinatorPanelDefinition,
  listAgentsPanelDefinition,
  createAgentPanelDefinition,
  agentDetailPanelDefinition,
  emptyPanelDefinition,
] as const;

export type AnyPanelDefinition = (typeof definitions)[number];

const byType: Record<string, PanelDefinition<unknown>> = Object.fromEntries(
  definitions.map((def) => [def.type, def as PanelDefinition<unknown>]),
);

export function listPanelDefinitions(): readonly PanelDefinition<unknown>[] {
  return definitions as readonly PanelDefinition<unknown>[];
}

export function getPanelDefinition(
  type: string,
): PanelDefinition<unknown> | null {
  return byType[type] ?? null;
}
