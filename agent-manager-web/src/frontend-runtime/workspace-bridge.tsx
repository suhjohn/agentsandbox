// ACTIONS_AND_KEYBINDINGS_SPEC: This file exposes imperative workspace runtime
// methods that canonical actions call into. Keep
// docs/ACTIONS_AND_KEYBINDINGS_SPEC.md in sync with any additions or behavior
// changes here.
import { useEffect } from "react";
import { registerWorkspaceRuntimeController } from "./bridge";
import type {
  WorkspaceLayoutNodeSnapshot,
  WorkspacePanelStateSnapshot,
  WorkspaceStateSnapshot,
} from "./types";
import {
  listAgentDetailTabs,
  type AgentDetailPanelConfig,
} from "@/workspace/panels/agent-detail";
import { listPanelDefinitions } from "@/workspace/panels/registry";
import { useWorkspaceStore } from "@/workspace/store";
import { clampRatio, findLeafNode, listLeafIds } from "@/workspace/layout";
import type { LayoutNode, SplitNode, WindowState } from "@/workspace/types";

type PathStep = {
  readonly node: SplitNode;
  readonly side: "a" | "b";
};

const AGENT_DETAIL_TABS = new Set([
  "session_list",
  "session_detail",
  "terminal",
  "browser",
  "diff",
]);

function assertValidAgentDetailActiveTab(value: unknown): void {
  if (typeof value !== "string" || !AGENT_DETAIL_TABS.has(value)) {
    throw new Error(
      "Invalid agent_detail activeTab. Use one of: session_list, session_detail, terminal, browser, diff",
    );
  }
}

function assertNonEmptyAgentDetailAgentId(value: unknown): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("agent_detail requires a non-empty agentId");
  }
}

function asStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cycleIndex(
  currentIndex: number,
  length: number,
  delta: -1 | 1,
): number {
  if (length <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= length) {
    return delta > 0 ? 0 : length - 1;
  }
  return (currentIndex + delta + length) % length;
}

function agentIdToAgentSessionId(agentId: string): string {
  const trimmed = agentId.trim();
  if (trimmed.length === 0) return "";
  return trimmed.replace(/-/g, "");
}

function clampSessionLimit(value: unknown): number {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : 20;
  return Math.max(1, Math.min(50, n));
}

function normalizeAgentDetailConfigObject(
  value: unknown,
): Record<string, unknown> {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const activeTab =
    typeof record.activeTab === "string"
      ? record.activeTab
      : typeof record.view === "string"
        ? record.view
        : "session_list";
  assertValidAgentDetailActiveTab(activeTab);

  const agentId = asStringOrEmpty(record.agentId);
  const rawSessionId = asStringOrEmpty(record.sessionId);
  const sessionId =
    rawSessionId.trim().length > 0
      ? rawSessionId
      : activeTab === "session_detail"
        ? agentIdToAgentSessionId(agentId)
        : "";

  const { view: _legacyView, ...rest } = record;
  return {
    ...rest,
    agentId,
    agentName: asStringOrEmpty(record.agentName),
    activeTab,
    sessionLimit: clampSessionLimit(record.sessionLimit),
    sessionId,
    sessionTitle: asStringOrEmpty(record.sessionTitle),
    diffBasis: record.diffBasis === "baseline" ? "baseline" : "repo_head",
    diffStyle: record.diffStyle === "unified" ? "unified" : "split",
  };
}

function normalizeAgentDetailPatchObject(
  value: unknown,
): Record<string, unknown> {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const { view: _legacyView, ...rest } = record;
  const out: Record<string, unknown> = { ...rest };

  if (typeof record.activeTab === "string") {
    assertValidAgentDetailActiveTab(record.activeTab);
    out.activeTab = record.activeTab;
  } else if (typeof record.view === "string") {
    assertValidAgentDetailActiveTab(record.view);
    out.activeTab = record.view;
  }

  if ("sessionLimit" in out) {
    out.sessionLimit = clampSessionLimit(out.sessionLimit);
  }
  if ("agentName" in out) {
    out.agentName = asStringOrEmpty(out.agentName);
  }
  if ("sessionId" in out) {
    out.sessionId = asStringOrEmpty(out.sessionId);
  }
  if ("sessionTitle" in out) {
    out.sessionTitle = asStringOrEmpty(out.sessionTitle);
  }
  if ("diffBasis" in out) {
    out.diffBasis = out.diffBasis === "baseline" ? "baseline" : "repo_head";
  }
  if ("diffStyle" in out) {
    out.diffStyle = out.diffStyle === "unified" ? "unified" : "split";
  }

  return out;
}

function getPathToLeaf(
  root: LayoutNode,
  leafId: string,
): readonly PathStep[] | null {
  const steps: PathStep[] = [];

  function walk(node: LayoutNode): boolean {
    if (node.kind === "leaf") return node.id === leafId;
    if (walk(node.a)) {
      steps.push({ node, side: "a" });
      return true;
    }
    if (walk(node.b)) {
      steps.push({ node, side: "b" });
      return true;
    }
    return false;
  }

  if (!walk(root)) return null;
  return steps;
}

function toLayoutSnapshot(node: LayoutNode): WorkspaceLayoutNodeSnapshot {
  if (node.kind === "leaf") {
    return {
      kind: "leaf",
      leafId: node.id,
      panelInstanceId: node.panelInstanceId,
    };
  }
  return {
    kind: "split",
    splitId: node.id,
    direction: node.dir,
    ratio: clampRatio(node.ratio),
    a: toLayoutSnapshot(node.a),
    b: toLayoutSnapshot(node.b),
  };
}

function summarizePanelConfig(
  panelType: WorkspacePanelStateSnapshot["panelType"],
  config: unknown,
): Readonly<Record<string, unknown>> {
  const record =
    typeof config === "object" && config !== null
      ? (config as Record<string, unknown>)
      : {};

  switch (panelType) {
    case "agent_detail":
      return {
        agentId: asStringOrEmpty(record.agentId),
        agentName: asStringOrEmpty(record.agentName),
        activeTab:
          typeof record.activeTab === "string"
            ? record.activeTab
            : "session_list",
        sessionId: asStringOrEmpty(record.sessionId),
        sessionTitle: asStringOrEmpty(record.sessionTitle),
        diffBasis: record.diffBasis === "baseline" ? "baseline" : "repo_head",
        diffStyle: record.diffStyle === "unified" ? "unified" : "split",
      };
    case "agent_list":
      return {
        status: typeof record.status === "string" ? record.status : "all",
        archived: typeof record.archived === "string" ? record.archived : "all",
        noImage: typeof record.noImage === "string" ? record.noImage : "all",
        imageId: asStringOrEmpty(record.imageId),
        groupBy: typeof record.groupBy === "string" ? record.groupBy : "none",
        limit:
          typeof record.limit === "number" && Number.isFinite(record.limit)
            ? Math.round(record.limit)
            : 20,
      };
    case "agent_create":
      return {
        name: asStringOrEmpty(record.name),
        imageId: asStringOrEmpty(record.imageId),
        region: asStringOrEmpty(record.region),
        parentAgentId: asStringOrEmpty(record.parentAgentId),
      };
    case "empty":
    case "coordinator":
    default:
      return {};
  }
}

function listPanelStates(
  activeWindow: WindowState,
): WorkspacePanelStateSnapshot[] {
  return listLeafIds(activeWindow.root)
    .map((leafId) => {
      const leaf = findLeafNode(activeWindow.root, leafId);
      if (!leaf) return null;
      const panel = activeWindow.panelsById[leaf.panelInstanceId];
      if (!panel) return null;
      const panelType = panel.type as WorkspacePanelStateSnapshot["panelType"];
      return {
        panelInstanceId: panel.id,
        panelType,
        leafId: leaf.id,
        focused: activeWindow.focusedLeafId === leaf.id,
        configSummary: summarizePanelConfig(panelType, panel.config),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function findLeafIdByPanelInstanceId(
  activeWindow: WindowState,
  panelInstanceId: string,
): string | null {
  const targetPanelInstanceId = panelInstanceId.trim();
  if (targetPanelInstanceId.length === 0) return null;
  for (const leafId of listLeafIds(activeWindow.root)) {
    const leaf = findLeafNode(activeWindow.root, leafId);
    if (!leaf) continue;
    if (leaf.panelInstanceId === targetPanelInstanceId) return leaf.id;
  }
  return null;
}

function resolvePaneLeafIdFromInput(input: {
  readonly activeWindow: WindowState;
  readonly leafId?: string;
  readonly panelInstanceId?: string;
  readonly side: "from" | "to";
}): string {
  const leafCandidate = (input.leafId ?? "").trim();
  const panelCandidate = (input.panelInstanceId ?? "").trim();
  const leafProvided = leafCandidate.length > 0;
  const panelProvided = panelCandidate.length > 0;
  if (leafProvided === panelProvided) {
    throw new Error(
      `${input.side} requires exactly one of leafId or panelInstanceId`,
    );
  }
  if (leafProvided) {
    const leaf = findLeafNode(input.activeWindow.root, leafCandidate);
    if (!leaf)
      throw new Error(`${input.side} leaf not found: ${leafCandidate}`);
    return leaf.id;
  }
  const leafId = findLeafIdByPanelInstanceId(
    input.activeWindow,
    panelCandidate,
  );
  if (!leafId) {
    throw new Error(
      `${input.side} panel instance not found: ${panelCandidate}`,
    );
  }
  return leafId;
}

export function CoordinatorWorkspaceBridge() {
  const store = useWorkspaceStore();

  useEffect(() => {
    return registerWorkspaceRuntimeController({
      getSnapshot: () => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        const panelTypes = activeWindow
          ? Object.values(activeWindow.panelsById).map((panel) => panel.type)
          : [];
        const workspaceWindowCount = Object.keys(state.windowsById).length;
        const workspaceLeafCount = activeWindow
          ? listLeafIds(activeWindow.root).length
          : 0;
        return {
          workspaceReady: activeWindow !== null,
          workspaceWindowCount,
          workspaceLeafCount,
          workspaceFocusedLeafId: activeWindow?.focusedLeafId ?? null,
          workspacePanelTypes: panelTypes,
        };
      },
      getStateSnapshot: (): WorkspaceStateSnapshot | null => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindow) return null;
        return {
          workspaceReady: true,
          workspaceFocusedLeafId: activeWindow.focusedLeafId,
          workspacePanelTypes: Object.values(activeWindow.panelsById).map(
            (panel) => panel.type,
          ),
          layout: toLayoutSnapshot(activeWindow.root),
          panels: listPanelStates(activeWindow),
        };
      },
      listPanels: () => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindow) return [];
        return listPanelStates(activeWindow).map((panel) => ({
          panelInstanceId: panel.panelInstanceId,
          panelType: panel.panelType,
          leafId: panel.leafId,
          focused: panel.focused,
        }));
      },
      focusPane: async (input) => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindow) throw new Error("Workspace is not ready");

        let targetLeafId: string | null = null;
        if (input.target === "leaf") {
          const providedLeafId = (input.leafId ?? "").trim();
          if (providedLeafId.length === 0) {
            throw new Error("leafId is required for target=leaf");
          }
          const leaf = findLeafNode(activeWindow.root, providedLeafId);
          if (!leaf) throw new Error(`Leaf not found: ${providedLeafId}`);
          targetLeafId = leaf.id;
        } else {
          const providedPanelId = (input.panelInstanceId ?? "").trim();
          if (providedPanelId.length === 0) {
            throw new Error(
              "panelInstanceId is required for target=panel_instance",
            );
          }
          targetLeafId = findLeafIdByPanelInstanceId(
            activeWindow,
            providedPanelId,
          );
          if (!targetLeafId) {
            throw new Error(`Panel instance not found: ${providedPanelId}`);
          }
        }

        store.dispatch({
          type: "leaf/focus",
          leafId: targetLeafId,
        });

        const afterState = store.getState();
        const afterWindow =
          afterState.windowsById[afterState.activeWindowId] ?? null;
        const focusedLeafId = afterWindow?.focusedLeafId ?? null;
        if (!afterWindow || !focusedLeafId) {
          throw new Error("Failed to focus workspace pane");
        }
        const focusedLeaf = findLeafNode(afterWindow.root, focusedLeafId);
        if (!focusedLeaf) throw new Error("Focused leaf is unavailable");

        return {
          focused: true as const,
          leafId: focusedLeaf.id,
          panelInstanceId: focusedLeaf.panelInstanceId,
        };
      },
      movePane: async (input) => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindow) throw new Error("Workspace is not ready");

        const fromLeafId = resolvePaneLeafIdFromInput({
          activeWindow,
          leafId: input.fromLeafId,
          panelInstanceId: input.fromPanelInstanceId,
          side: "from",
        });
        const toLeafId = resolvePaneLeafIdFromInput({
          activeWindow,
          leafId: input.toLeafId,
          panelInstanceId: input.toPanelInstanceId,
          side: "to",
        });
        if (fromLeafId === toLeafId) {
          throw new Error("from and to must reference different panes");
        }

        store.dispatch({
          type: "pane/move",
          fromLeafId,
          toLeafId,
          placement: input.placement,
        });

        const afterState = store.getState();
        const afterWindow =
          afterState.windowsById[afterState.activeWindowId] ?? null;
        if (!afterWindow) throw new Error("Workspace is not ready");
        const movedLeaf = findLeafNode(afterWindow.root, fromLeafId);
        if (!movedLeaf) throw new Error("Pane move did not resolve in layout");

        return {
          moved: true as const,
          fromLeafId,
          toLeafId,
          placement: input.placement,
          focusedLeafId: afterWindow.focusedLeafId,
        };
      },
      closePane: async (input) => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindow) throw new Error("Workspace is not ready");

        let targetLeafId: string | null = null;
        if (input.target === "focused") {
          targetLeafId = activeWindow.focusedLeafId;
          if (!targetLeafId) throw new Error("No focused workspace pane");
        } else if (input.target === "leaf") {
          const providedLeafId = (input.leafId ?? "").trim();
          if (providedLeafId.length === 0) {
            throw new Error("leafId is required for target=leaf");
          }
          const leaf = findLeafNode(activeWindow.root, providedLeafId);
          if (!leaf) throw new Error(`Leaf not found: ${providedLeafId}`);
          targetLeafId = leaf.id;
        } else {
          const providedPanelId = (input.panelInstanceId ?? "").trim();
          if (providedPanelId.length === 0) {
            throw new Error(
              "panelInstanceId is required for target=panel_instance",
            );
          }
          targetLeafId = findLeafIdByPanelInstanceId(
            activeWindow,
            providedPanelId,
          );
          if (!targetLeafId) {
            throw new Error(`Panel instance not found: ${providedPanelId}`);
          }
        }

        const currentLeafIds = listLeafIds(activeWindow.root);
        if (currentLeafIds.length <= 1) {
          throw new Error("Cannot close the last workspace pane");
        }

        const leaf = findLeafNode(activeWindow.root, targetLeafId);
        if (!leaf) throw new Error("Target workspace pane not found");
        const closedPanelInstanceId = leaf.panelInstanceId;

        store.dispatch({
          type: "leaf/close",
          leafId: targetLeafId,
        });

        const afterState = store.getState();
        const afterWindow =
          afterState.windowsById[afterState.activeWindowId] ?? null;
        if (!afterWindow) throw new Error("Workspace is not ready");
        if (findLeafNode(afterWindow.root, targetLeafId)) {
          throw new Error(
            "Workspace pane close did not remove the target pane",
          );
        }

        return {
          closed: true as const,
          closedLeafId: targetLeafId,
          closedPanelInstanceId,
          focusedLeafId: afterWindow.focusedLeafId,
        };
      },
      openPanel: async (input) => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        const focusedLeafId = activeWindow?.focusedLeafId ?? null;
        if (!activeWindow || !focusedLeafId) {
          throw new Error("Workspace is not ready");
        }
        const nextConfig =
          input.panelType === "agent_detail"
            ? normalizeAgentDetailConfigObject(input.config)
            : input.config;
        if (input.panelType === "agent_detail") {
          assertNonEmptyAgentDetailAgentId(
            (nextConfig as { agentId?: unknown }).agentId,
          );
        }
        store.dispatch({
          type: "panel/open",
          fromLeafId: focusedLeafId,
          placement: input.placement,
          panelType: input.panelType,
          config: nextConfig,
        });

        const afterState = store.getState();
        const afterWindow =
          afterState.windowsById[afterState.activeWindowId] ?? null;
        const openedLeafId = afterWindow?.focusedLeafId ?? null;
        const openedPanel =
          openedLeafId && afterWindow
            ? (() => {
                const leaf = findLeafNode(afterWindow.root, openedLeafId);
                if (!leaf) return null;
                return afterWindow.panelsById[leaf.panelInstanceId] ?? null;
              })()
            : null;
        if (!openedLeafId || !openedPanel) {
          throw new Error("Failed to resolve opened workspace panel");
        }

        return {
          opened: true as const,
          panelType: input.panelType,
          placement: input.placement,
          panelInstanceId: openedPanel.id,
          leafId: openedLeafId,
        };
      },
      setPanelConfig: async (input) => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindow) {
          throw new Error("Workspace is not ready");
        }

        let panelInstanceId: string | null = null;
        if (input.target === "panel_instance") {
          const providedId = (input.panelInstanceId ?? "").trim();
          if (providedId.length === 0) {
            throw new Error(
              "panelInstanceId is required for target=panel_instance",
            );
          }
          panelInstanceId = providedId;
        } else if (input.target === "focused") {
          const focusedLeafId = activeWindow.focusedLeafId;
          if (!focusedLeafId) throw new Error("No focused workspace panel");
          const leaf = findLeafNode(activeWindow.root, focusedLeafId);
          if (!leaf) throw new Error("Focused workspace panel is unavailable");
          panelInstanceId = leaf.panelInstanceId;
        } else {
          if (!input.panelType) {
            throw new Error("panelType is required for target=first_of_type");
          }
          // Prefer focused panel when it already matches the requested type.
          const focusedLeafId = activeWindow.focusedLeafId;
          if (focusedLeafId) {
            const focusedLeaf = findLeafNode(activeWindow.root, focusedLeafId);
            const focusedPanel = focusedLeaf
              ? activeWindow.panelsById[focusedLeaf.panelInstanceId]
              : null;
            if (focusedPanel?.type === input.panelType) {
              panelInstanceId = focusedPanel.id;
            }
          }

          // Otherwise pick first visible panel of type in leaf traversal order.
          if (!panelInstanceId) {
            for (const leafId of listLeafIds(activeWindow.root)) {
              const leaf = findLeafNode(activeWindow.root, leafId);
              if (!leaf) continue;
              const panel = activeWindow.panelsById[leaf.panelInstanceId];
              if (!panel) continue;
              if (panel.type === input.panelType) {
                panelInstanceId = panel.id;
                break;
              }
            }
          }

          if (!panelInstanceId) {
            throw new Error(`No panel of type ${input.panelType} is open`);
          }
        }

        const existing = activeWindow.panelsById[panelInstanceId];
        if (!existing) throw new Error("Target workspace panel not found");
        if (
          input.target !== "first_of_type" &&
          input.panelType &&
          existing.type !== input.panelType
        ) {
          throw new Error(
            `Target panel type mismatch (expected ${input.panelType}, got ${existing.type})`,
          );
        }
        if (existing.type === "agent_detail" && "activeTab" in input.patch) {
          assertValidAgentDetailActiveTab(input.patch.activeTab);
        }

        const nextPatch =
          existing.type === "agent_detail"
            ? normalizeAgentDetailPatchObject(input.patch)
            : input.patch;

        store.dispatch({
          type: "panel/config",
          panelInstanceId,
          updater: (prev) => {
            const base =
              typeof prev === "object" && prev !== null
                ? (prev as Record<string, unknown>)
                : {};
            if (existing.type === "agent_detail") {
              const nextConfig = normalizeAgentDetailConfigObject({
                ...base,
                ...nextPatch,
              });
              assertNonEmptyAgentDetailAgentId(nextConfig.agentId);
              return nextConfig;
            }
            return {
              ...base,
              ...nextPatch,
            };
          },
        });

        return {
          updated: true as const,
          panelType: existing.type as
            | "coordinator"
            | "agent_list"
            | "agent_create"
            | "agent_detail"
            | "empty",
          panelInstanceId,
        };
      },
      resizeFocusedPanel: async (input) => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindow) throw new Error("Workspace is not ready");

        const focusedLeafId = activeWindow.focusedLeafId;
        if (!focusedLeafId) throw new Error("No focused workspace panel");

        const steps = getPathToLeaf(activeWindow.root, focusedLeafId);
        if (!steps || steps.length === 0) {
          throw new Error("Focused panel path is unavailable");
        }

        const targetDir = input.dimension === "width" ? "row" : "col";
        const targetStep = steps.find((step) => step.node.dir === targetDir);
        if (!targetStep) {
          throw new Error(
            `Focused panel has no ${input.dimension} split to resize`,
          );
        }

        const currentRatio = clampRatio(targetStep.node.ratio);
        const orientedFocusedSize =
          targetStep.side === "a" ? currentRatio : 1 - currentRatio;

        let nextFocusedSize = orientedFocusedSize;
        if (input.mode === "set_fraction") {
          nextFocusedSize = clampRatio(input.value);
        } else {
          nextFocusedSize = clampRatio(orientedFocusedSize + input.value);
        }

        const nextRatio =
          targetStep.side === "a" ? nextFocusedSize : 1 - nextFocusedSize;
        const clampedNextRatio = clampRatio(nextRatio);

        store.dispatch({
          type: "split/ratio",
          splitId: targetStep.node.id,
          ratio: clampedNextRatio,
        });

        return {
          resized: true as const,
          splitId: targetStep.node.id,
          ratio: clampedNextRatio,
          dimension: input.dimension,
        };
      },
      splitFocusedPane: async (direction: "row" | "col") => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        const focusedLeafId = activeWindow?.focusedLeafId ?? null;
        if (!activeWindow || !focusedLeafId) {
          throw new Error("Workspace is not ready");
        }
        store.dispatch({
          type: "leaf/split",
          leafId: focusedLeafId,
          dir: direction,
        });
        return { split: true as const };
      },
      splitWindowFull: async (direction: "row" | "col") => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindow) throw new Error("Workspace is not ready");
        store.dispatch({ type: "window/split-full", dir: direction });
        return { split: true as const };
      },
      focusTraversal: async (direction: "next" | "prev") => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindow) throw new Error("Workspace is not ready");
        store.dispatch({
          type: direction === "next" ? "pane/focus-next" : "pane/focus-prev",
        });
        return { focused: true as const };
      },
      focusDirection: async (direction: "left" | "right" | "up" | "down") => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindow) throw new Error("Workspace is not ready");
        store.dispatch({ type: "pane/focus-direction", direction });
        return { focused: true as const };
      },
      focusPaneByIndex: async (index) => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindow) throw new Error("Workspace is not ready");
        const paneLeafIds = listLeafIds(activeWindow.root);
        const targetLeafId = paneLeafIds[index];
        if (!targetLeafId) throw new Error(`Pane index out of range: ${index}`);
        store.dispatch({ type: "leaf/focus", leafId: targetLeafId });
        return { focused: true as const };
      },
      swapTraversal: async (direction: "next" | "prev") => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindow) throw new Error("Workspace is not ready");
        store.dispatch({
          type: direction === "next" ? "pane/swap-next" : "pane/swap-prev",
        });
        return { swapped: true as const };
      },
      rotatePanes: async () => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindow) throw new Error("Workspace is not ready");
        store.dispatch({ type: "pane/rotate" });
        return { rotated: true as const };
      },
      breakFocusedPaneToWindow: async () => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        const focusedLeafId = activeWindow?.focusedLeafId ?? null;
        if (!activeWindow || !focusedLeafId) {
          throw new Error("Workspace is not ready");
        }
        store.dispatch({ type: "pane/break-to-window" });
        return { broken: true as const };
      },
      resizeDirection: async (
        direction: "left" | "right" | "up" | "down",
        amount: number,
      ) => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        const focusedLeafId = activeWindow?.focusedLeafId ?? null;
        if (!activeWindow || !focusedLeafId) {
          throw new Error("Workspace is not ready");
        }
        store.dispatch({ type: "split/resize-direction", direction, amount });
        return { resized: true as const };
      },
      cycleFocusedPaneType: async (delta: -1 | 1) => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        const focusedLeafId = activeWindow?.focusedLeafId ?? null;
        if (!activeWindow || !focusedLeafId) {
          throw new Error("Workspace is not ready");
        }
        const focusedLeaf = findLeafNode(activeWindow.root, focusedLeafId);
        const focusedPanel = focusedLeaf
          ? (activeWindow.panelsById[focusedLeaf.panelInstanceId] ?? null)
          : null;
        if (!focusedPanel)
          throw new Error("Focused workspace pane is unavailable");

        const panelTypes = listPanelDefinitions().map(
          (definition) => definition.type,
        );
        const currentIndex = panelTypes.indexOf(focusedPanel.type);
        const nextIndex = cycleIndex(currentIndex, panelTypes.length, delta);
        const nextType = panelTypes[nextIndex];
        if (!nextType || nextType === focusedPanel.type) {
          return { changed: false as const };
        }
        store.dispatch({
          type: "panel/type",
          panelInstanceId: focusedPanel.id,
          panelType: nextType,
        });
        return { changed: true as const };
      },
      cycleFocusedAgentView: async (delta: -1 | 1) => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        const focusedLeafId = activeWindow?.focusedLeafId ?? null;
        if (!activeWindow || !focusedLeafId) {
          throw new Error("Workspace is not ready");
        }
        const focusedLeaf = findLeafNode(activeWindow.root, focusedLeafId);
        const focusedPanel = focusedLeaf
          ? (activeWindow.panelsById[focusedLeaf.panelInstanceId] ?? null)
          : null;
        if (!focusedPanel || focusedPanel.type !== "agent_detail") {
          return { changed: false as const };
        }
        const config = focusedPanel.config as AgentDetailPanelConfig;
        const tabs = listAgentDetailTabs();
        const currentIndex = tabs.indexOf(config.activeTab);
        const nextIndex = cycleIndex(currentIndex, tabs.length, delta);
        const nextTab = tabs[nextIndex];
        if (!nextTab || nextTab === config.activeTab) {
          return { changed: false as const };
        }
        store.dispatch({
          type: "panel/config",
          panelInstanceId: focusedPanel.id,
          updater: (prev) => ({
            ...(prev as AgentDetailPanelConfig),
            activeTab: nextTab,
          }),
        });
        return { changed: true as const };
      },
      createWindow: async () => {
        store.dispatch({ type: "window/create" });
        return { created: true as const };
      },
      closeActiveWindow: async () => {
        const state = store.getState();
        const activeWindow = state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindow) throw new Error("Workspace is not ready");
        if (Object.keys(state.windowsById).length <= 1) {
          throw new Error("Cannot close the last workspace window");
        }
        store.dispatch({ type: "window/close", windowId: activeWindow.id });
        return { closed: true as const };
      },
      activateWindow: async (
        target: "next" | "prev" | "last" | { readonly index: number },
      ) => {
        if (target === "next") {
          store.dispatch({ type: "window/activate-next" });
        } else if (target === "prev") {
          store.dispatch({ type: "window/activate-prev" });
        } else if (target === "last") {
          store.dispatch({ type: "window/activate-last" });
        } else {
          store.dispatch({
            type: "window/activate-index",
            index: target.index,
          });
        }
        return { activated: true as const };
      },
      equalizeLayout: async () => {
        store.dispatch({ type: "layout/equalize" });
        return { equalized: true as const };
      },
      cycleLayout: async () => {
        store.dispatch({ type: "layout/cycle" });
        return { cycled: true as const };
      },
    });
  }, [store]);

  return null;
}
