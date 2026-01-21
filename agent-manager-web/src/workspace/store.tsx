import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useSyncExternalStore } from "react";
import { newId } from "./id";
import {
  areSplitRatiosEqualized,
  clampRatio,
  closeLeaf as closeLeafInLayout,
  equalizeSplitRatios,
  findAdjacentLeafIdByPlacement,
  findLeafNode,
  hasUniformSplitDirection,
  listLeafIds,
  listPanelInstanceIds,
  rebuildLayoutInDirection,
  replaceLeaf,
  resizeLeafByDirection,
  rotateLeafPanels,
  swapLeafNodes,
  updateSplitRatio,
} from "./layout";
import { getPanelDefinition } from "./panels/registry";
import {
  createDefaultWorkspaceState,
  createDefaultWindowState,
  loadWorkspaceState,
  saveWorkspaceState,
} from "./persistence";
import type {
  LayoutNode,
  LeafNode,
  PaneDirection,
  PanelInstance,
  SplitDirection,
  SplitNode,
  WindowPreset,
  WindowState,
  WorkspaceState,
} from "./types";

type Listener = () => void;

export type WorkspaceAction =
  | { readonly type: "window/create" }
  | { readonly type: "window/close"; readonly windowId: string }
  | { readonly type: "window/rename"; readonly windowId: string; readonly name: string }
  | { readonly type: "window/activate"; readonly windowId: string }
  | { readonly type: "window/activate-next" }
  | { readonly type: "window/activate-prev" }
  | { readonly type: "window/activate-last" }
  | { readonly type: "window/activate-index"; readonly index: number }
  | {
      readonly type: "window/split-full";
      readonly dir: SplitDirection;
      readonly insertBefore?: boolean;
    }
  | { readonly type: "leaf/focus"; readonly leafId: string }
  | { readonly type: "pane/focus-next" }
  | { readonly type: "pane/focus-prev" }
  | { readonly type: "pane/focus-direction"; readonly direction: PaneDirection }
  | { readonly type: "pane/swap-next" }
  | { readonly type: "pane/swap-prev" }
  | { readonly type: "pane/rotate" }
  | { readonly type: "pane/break-to-window"; readonly leafId?: string }
  | { readonly type: "leaf/split"; readonly leafId: string; readonly dir: SplitDirection }
  | { readonly type: "leaf/close"; readonly leafId: string }
  | {
      readonly type: "pane/move";
      readonly fromLeafId: string;
      readonly toLeafId: string;
      readonly placement: "left" | "right" | "top" | "bottom";
    }
  | { readonly type: "split/ratio"; readonly splitId: string; readonly ratio: number }
  | {
      readonly type: "split/resize-direction";
      readonly direction: PaneDirection;
      readonly amount?: number;
    }
  | { readonly type: "layout/equalize" }
  | { readonly type: "layout/cycle" }
  | { readonly type: "panel/type"; readonly panelInstanceId: string; readonly panelType: string }
  | {
      readonly type: "panel/config";
      readonly panelInstanceId: string;
      readonly updater: (prev: unknown) => unknown;
    }
  | {
      readonly type: "panel/open";
      readonly fromLeafId: string;
      readonly placement: "self" | "left" | "right" | "top" | "bottom";
      readonly panelType: string;
      readonly config?: unknown;
    }
  | { readonly type: "agent/archive"; readonly agentId: string }
  | { readonly type: "preset/pin"; readonly name: string }
  | { readonly type: "preset/delete"; readonly presetId: string }
  | { readonly type: "preset/open"; readonly presetId: string };

export interface WorkspaceStore {
  getState: () => WorkspaceState;
  subscribe: (listener: Listener) => () => void;
  dispatch: (action: WorkspaceAction) => void;
}

function createPanelInstance(type: string): PanelInstance {
  const def = getPanelDefinition(type) ?? getPanelDefinition("coordinator");
  if (!def) {
    return {
      id: newId("panel"),
      type: "coordinator",
      configVersion: 1,
      config: {},
    };
  }
  return {
    id: newId("panel"),
    type: def.type,
    configVersion: def.configVersion,
    config: def.defaultConfig,
  };
}

function deepClone<T>(value: T): T {
  // Workspace panel configs should be plain data. We still defend against
  // non-serializable values so split/stack doesn't accidentally share pointers.
  try {
    // structuredClone exists in modern browsers and Node.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return structuredClone(value);
  } catch {
    // fall through
  }

  if (value === null) return value;
  const t = typeof value;
  if (t !== "object") return value;

  if (Array.isArray(value)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return value.map((v) => deepClone(v)) as T;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = deepClone(v);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return out as T;
}

function clonePanelInstance(source: PanelInstance): PanelInstance {
  return {
    id: newId("panel"),
    type: source.type,
    configVersion: source.configVersion,
    config: deepClone(source.config),
  };
}

function withPanelConfig(
  panel: PanelInstance,
  config: unknown | undefined,
): PanelInstance {
  if (typeof config === "undefined") return panel;
  const def = getPanelDefinition(panel.type);
  if (!def) return { ...panel, config };
  return {
    ...panel,
    config: def.deserializeConfig(config, panel.configVersion),
  };
}

function createLeafWithPanel(panelInstanceId: string, id?: string): LeafNode {
  return {
    kind: "leaf",
    id: id ?? newId("leaf"),
    panelInstanceId,
  };
}

function updateLeafInLayout(
  root: LayoutNode,
  leafId: string,
  updater: (leaf: LeafNode) => LeafNode,
): LayoutNode {
  const leaf = findLeafNode(root, leafId);
  if (!leaf) return root;
  const nextLeaf = updater(leaf);
  if (nextLeaf === leaf) return root;
  return replaceLeaf(root, leafId, nextLeaf);
}

function findLeafIdByPanelInstanceId(
  root: LayoutNode,
  panelInstanceId: string,
): string | null {
  if (root.kind === "leaf") {
    return root.panelInstanceId === panelInstanceId ? root.id : null;
  }
  return (
    findLeafIdByPanelInstanceId(root.a, panelInstanceId) ??
    findLeafIdByPanelInstanceId(root.b, panelInstanceId)
  );
}

function panelReferencesAgent(panel: PanelInstance | undefined, agentId: string): boolean {
  if (!panel || typeof panel.config !== "object" || panel.config === null) {
    return false;
  }
  const panelConfig = panel.config as { agentId?: unknown };
  return typeof panelConfig.agentId === "string" && panelConfig.agentId.trim() === agentId;
}

function archiveAgentPanelsInWindow(window: WindowState, agentId: string): WindowState {
  const targetAgentId = agentId.trim();
  if (targetAgentId.length === 0) return window;

  let root = window.root;
  const panelsById: Record<string, PanelInstance> = { ...window.panelsById };
  let changed = false;

  while (true) {
    const targetLeafId = listLeafIds(root).find((leafId) => {
      const leaf = findLeafNode(root, leafId);
      if (!leaf) return false;
      return panelReferencesAgent(panelsById[leaf.panelInstanceId], targetAgentId);
    });

    if (!targetLeafId) break;

    const targetLeaf = findLeafNode(root, targetLeafId);
    if (!targetLeaf) break;

    const leafIds = listLeafIds(root);
    if (leafIds.length <= 1) {
      const panel = panelsById[targetLeaf.panelInstanceId];
      const listAgentsDef = getPanelDefinition("agent_list");
      if (!panel || !listAgentsDef) break;

      panelsById[targetLeaf.panelInstanceId] = {
        ...panel,
        type: listAgentsDef.type,
        configVersion: listAgentsDef.configVersion,
        config: listAgentsDef.defaultConfig,
      };
      changed = true;
      break;
    }

    const result = closeLeafInLayout(root, targetLeafId);
    if (!result.removedLeaf) break;

    root = result.root;
    changed = true;
  }

  if (!changed) return window;

  const usedPanelIds = new Set(listPanelInstanceIds(root));
  for (const panelId of Object.keys(panelsById)) {
    if (!usedPanelIds.has(panelId)) delete panelsById[panelId];
  }

  const nextLeafIds = listLeafIds(root);
  const focusedLeafId =
    window.focusedLeafId && nextLeafIds.includes(window.focusedLeafId)
      ? window.focusedLeafId
      : nextLeafIds[0] ?? null;

  return {
    ...window,
    root,
    panelsById,
    focusedLeafId,
  };
}

function getActiveWindow(state: WorkspaceState): WindowState | null {
  return state.windowsById[state.activeWindowId] ?? null;
}

function listWindowIds(state: WorkspaceState): readonly string[] {
  return Object.keys(state.windowsById);
}

function pickLastActiveWindowId(
  windowsById: Readonly<Record<string, WindowState>>,
  activeWindowId: string,
  preferredWindowId: string | null | undefined,
): string | null {
  if (
    preferredWindowId &&
    preferredWindowId in windowsById &&
    preferredWindowId !== activeWindowId
  ) {
    return preferredWindowId;
  }

  return Object.keys(windowsById).find((windowId) => windowId !== activeWindowId) ?? null;
}

function activateWindow(state: WorkspaceState, nextWindowId: string): WorkspaceState {
  if (nextWindowId === state.activeWindowId) return state;
  if (!(nextWindowId in state.windowsById)) return state;

  return {
    ...state,
    activeWindowId: nextWindowId,
    lastActiveWindowId: pickLastActiveWindowId(
      state.windowsById,
      nextWindowId,
      state.activeWindowId,
    ),
  };
}

function activateWindowByOffset(state: WorkspaceState, offset: number): WorkspaceState {
  const windowIds = listWindowIds(state);
  if (windowIds.length <= 1) return state;

  const currentIndex = windowIds.indexOf(state.activeWindowId);
  if (currentIndex === -1) return state;

  const nextIndex = (currentIndex + offset + windowIds.length) % windowIds.length;
  return activateWindow(state, windowIds[nextIndex]!);
}

function cycleFocusedLeaf(window: WindowState, offset: number): WindowState {
  const leafIds = listLeafIds(window.root);
  if (leafIds.length === 0) return window;

  const currentIndex = window.focusedLeafId ? leafIds.indexOf(window.focusedLeafId) : -1;
  const normalizedCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (normalizedCurrentIndex + offset + leafIds.length) % leafIds.length;
  const nextFocusedLeafId = leafIds[nextIndex] ?? null;
  if (!nextFocusedLeafId || nextFocusedLeafId === window.focusedLeafId) return window;

  return {
    ...window,
    focusedLeafId: nextFocusedLeafId,
  };
}

function updateActiveWindow(
  state: WorkspaceState,
  updater: (prev: WindowState) => WindowState,
): WorkspaceState {
  const window = getActiveWindow(state);
  if (!window) return state;
  const nextWindow = updater(window);
  if (nextWindow === window) return state;
  return {
    ...state,
    windowsById: {
      ...state.windowsById,
      [window.id]: nextWindow,
    },
  };
}

function cloneWindowLayout(window: Omit<WindowState, "id" | "name"> & { readonly name: string }): WindowState {
  const panelIdMap = new Map<string, string>();
  const leafIdMap = new Map<string, string>();

  function cloneNode(node: LayoutNode): LayoutNode {
    if (node.kind === "leaf") {
      const nextLeafId = newId("leaf");
      leafIdMap.set(node.id, nextLeafId);

      const existing = panelIdMap.get(node.panelInstanceId);
      const nextPanelInstanceId = existing ?? newId("panel");
      if (!existing) panelIdMap.set(node.panelInstanceId, nextPanelInstanceId);

      return {
        kind: "leaf",
        id: nextLeafId,
        panelInstanceId: nextPanelInstanceId,
      };
    }
    return {
      kind: "split",
      id: newId("split"),
      dir: node.dir,
      ratio: clampRatio(node.ratio),
      a: cloneNode(node.a),
      b: cloneNode(node.b),
    };
  }

  const nextRoot = cloneNode(window.root);
  const nextPanelsById: Record<string, PanelInstance> = {};
  for (const [oldId, oldPanel] of Object.entries(window.panelsById)) {
    const nextId = panelIdMap.get(oldId);
    if (!nextId) continue;
    nextPanelsById[nextId] = { ...oldPanel, id: nextId };
  }

  for (const panelId of listPanelInstanceIds(nextRoot)) {
    if (nextPanelsById[panelId]) continue;
    const replacement = createPanelInstance("coordinator");
    nextPanelsById[panelId] = { ...replacement, id: panelId };
  }

  const focusedLeafId =
    window.focusedLeafId && leafIdMap.get(window.focusedLeafId)
      ? leafIdMap.get(window.focusedLeafId)!
      : listLeafIds(nextRoot)[0] ?? null;

  return {
    id: newId("win"),
    name: window.name,
    root: nextRoot,
    panelsById: nextPanelsById,
    focusedLeafId,
  };
}

function replacePanelInLeaf(
  window: WindowState,
  leafId: string,
  panelType: string,
  config?: unknown,
): WindowState {
  const leaf = findLeafNode(window.root, leafId);
  if (!leaf) return window;

  const panelId = leaf.panelInstanceId;
  const existingPanel = window.panelsById[panelId];
  if (!existingPanel) return window;

  const created = withPanelConfig(createPanelInstance(panelType), config);
  const nextPanel: PanelInstance = {
    ...created,
    id: panelId,
  };

  return {
    ...window,
    panelsById: {
      ...window.panelsById,
      [panelId]: nextPanel,
    },
    focusedLeafId: leafId,
  };
}

function reduce(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "window/create": {
      const windowCount = Object.keys(state.windowsById).length;
      const window = createDefaultWindowState(`Window ${windowCount + 1}`);
      const windowsById = { ...state.windowsById, [window.id]: window };
      return {
        ...state,
        activeWindowId: window.id,
        lastActiveWindowId: pickLastActiveWindowId(
          windowsById,
          window.id,
          state.activeWindowId,
        ),
        windowsById,
      };
    }
    case "window/close": {
      if (!(action.windowId in state.windowsById)) return state;
      const windowIds = Object.keys(state.windowsById);
      if (windowIds.length <= 1) return state;

      const { [action.windowId]: _removed, ...windowsById } = state.windowsById;
      if (state.activeWindowId !== action.windowId) {
        return {
          ...state,
          windowsById,
          lastActiveWindowId: pickLastActiveWindowId(
            windowsById,
            state.activeWindowId,
            state.lastActiveWindowId,
          ),
        };
      }

      const remainingWindowIds = windowIds.filter((windowId) => windowId !== action.windowId);
      const closedIndex = windowIds.indexOf(action.windowId);
      const nextIndex = Math.min(closedIndex, remainingWindowIds.length - 1);
      const nextActiveWindowId = remainingWindowIds[nextIndex] ?? remainingWindowIds[0];
      if (!nextActiveWindowId) return state;

      return {
        ...state,
        activeWindowId: nextActiveWindowId,
        lastActiveWindowId: pickLastActiveWindowId(
          windowsById,
          nextActiveWindowId,
          state.lastActiveWindowId,
        ),
        windowsById,
      };
    }
    case "window/rename": {
      const window = state.windowsById[action.windowId];
      if (!window) return state;
      if (window.name === action.name) return state;
      return {
        ...state,
        windowsById: {
          ...state.windowsById,
          [window.id]: { ...window, name: action.name },
        },
      };
    }
    case "window/activate": {
      return activateWindow(state, action.windowId);
    }
    case "window/activate-next": {
      return activateWindowByOffset(state, 1);
    }
    case "window/activate-prev": {
      return activateWindowByOffset(state, -1);
    }
    case "window/activate-last": {
      if (!state.lastActiveWindowId) return state;
      return activateWindow(state, state.lastActiveWindowId);
    }
    case "window/activate-index": {
      if (!Number.isFinite(action.index)) return state;
      const windowIds = listWindowIds(state);
      const index = Math.trunc(action.index);
      if (index < 0 || index >= windowIds.length) return state;
      return activateWindow(state, windowIds[index]!);
    }
    case "window/split-full": {
      return updateActiveWindow(state, (window) => {
        const sourceLeafId = window.focusedLeafId ?? listLeafIds(window.root)[0] ?? null;
        const sourceLeaf = sourceLeafId ? findLeafNode(window.root, sourceLeafId) : null;
        const sourcePanel = sourceLeaf
          ? window.panelsById[sourceLeaf.panelInstanceId]
          : undefined;
        const newPanel = sourcePanel
          ? clonePanelInstance(sourcePanel)
          : createPanelInstance("coordinator");
        const newLeaf = createLeafWithPanel(newPanel.id);
        const insertBefore = action.insertBefore ?? false;
        const nextRoot: SplitNode = {
          kind: "split",
          id: newId("split"),
          dir: action.dir,
          ratio: 0.5,
          a: insertBefore ? newLeaf : window.root,
          b: insertBefore ? window.root : newLeaf,
        };
        return {
          ...window,
          root: nextRoot,
          panelsById: { ...window.panelsById, [newPanel.id]: newPanel },
          focusedLeafId: newLeaf.id,
        };
      });
    }
    case "leaf/focus": {
      return updateActiveWindow(state, (window) => {
        const leafIds = listLeafIds(window.root);
        if (!leafIds.includes(action.leafId)) return window;
        return { ...window, focusedLeafId: action.leafId };
      });
    }
    case "pane/focus-next": {
      return updateActiveWindow(state, (window) => cycleFocusedLeaf(window, 1));
    }
    case "pane/focus-prev": {
      return updateActiveWindow(state, (window) => cycleFocusedLeaf(window, -1));
    }
    case "pane/focus-direction": {
      return updateActiveWindow(state, (window) => {
        const focusedLeafId = window.focusedLeafId;
        if (!focusedLeafId) return window;

        const placement =
          action.direction === "left"
            ? "left"
            : action.direction === "right"
              ? "right"
              : action.direction === "up"
                ? "top"
                : "bottom";

        const adjacentLeafId = findAdjacentLeafIdByPlacement(
          window.root,
          focusedLeafId,
          placement,
        );
        if (!adjacentLeafId || adjacentLeafId === focusedLeafId) return window;
        return { ...window, focusedLeafId: adjacentLeafId };
      });
    }
    case "pane/swap-next":
    case "pane/swap-prev": {
      return updateActiveWindow(state, (window) => {
        const leafIds = listLeafIds(window.root);
        if (leafIds.length <= 1) return window;

        const focusedLeafId = window.focusedLeafId ?? leafIds[0]!;
        const currentIndex = leafIds.indexOf(focusedLeafId);
        if (currentIndex === -1) return window;

        const delta = action.type === "pane/swap-next" ? 1 : -1;
        const targetIndex = (currentIndex + delta + leafIds.length) % leafIds.length;
        const targetLeafId = leafIds[targetIndex];
        if (!targetLeafId || targetLeafId === focusedLeafId) return window;

        const nextRoot = swapLeafNodes(window.root, focusedLeafId, targetLeafId);
        if (nextRoot === window.root) return window;
        return { ...window, root: nextRoot, focusedLeafId };
      });
    }
    case "pane/rotate": {
      return updateActiveWindow(state, (window) => {
        const focusedPanelInstanceId = window.focusedLeafId
          ? findLeafNode(window.root, window.focusedLeafId)?.panelInstanceId ?? null
          : null;
        const nextRoot = rotateLeafPanels(window.root, "next");
        if (nextRoot === window.root) return window;
        const focusedLeafId =
          focusedPanelInstanceId !== null
            ? findLeafIdByPanelInstanceId(nextRoot, focusedPanelInstanceId)
            : window.focusedLeafId;
        return {
          ...window,
          root: nextRoot,
          focusedLeafId: focusedLeafId ?? window.focusedLeafId,
        };
      });
    }
    case "pane/break-to-window": {
      const activeWindow = getActiveWindow(state);
      if (!activeWindow) return state;

      const sourceLeafId = action.leafId ?? activeWindow.focusedLeafId;
      if (!sourceLeafId) return state;

      const sourceLeaf = findLeafNode(activeWindow.root, sourceLeafId);
      if (!sourceLeaf) return state;

      const activeLeafIds = listLeafIds(activeWindow.root);
      if (activeLeafIds.length <= 1) return state;

      const closeResult = closeLeafInLayout(activeWindow.root, sourceLeafId);
      if (!closeResult.removedLeaf) return state;

      const movedLeaf = closeResult.removedLeaf;
      const movedPanel = activeWindow.panelsById[movedLeaf.panelInstanceId];
      if (!movedPanel) return state;

      const sourcePanelIds = new Set(listPanelInstanceIds(closeResult.root));
      const sourcePanelsById = { ...activeWindow.panelsById };
      for (const panelId of Object.keys(sourcePanelsById)) {
        if (!sourcePanelIds.has(panelId)) delete sourcePanelsById[panelId];
      }

      const remainingLeafIds = listLeafIds(closeResult.root);
      const nextSourceFocusedLeafId =
        activeWindow.focusedLeafId && remainingLeafIds.includes(activeWindow.focusedLeafId)
          ? activeWindow.focusedLeafId
          : remainingLeafIds[0] ?? null;

      const nextSourceWindow: WindowState = {
        ...activeWindow,
        root: closeResult.root,
        panelsById: sourcePanelsById,
        focusedLeafId: nextSourceFocusedLeafId,
      };

      const windowCount = Object.keys(state.windowsById).length;
      const nextWindowId = newId("win");
      const nextWindow: WindowState = {
        id: nextWindowId,
        name: `Window ${windowCount + 1}`,
        root: movedLeaf,
        panelsById: { [movedPanel.id]: movedPanel },
        focusedLeafId: movedLeaf.id,
      };

      const windowsById = {
        ...state.windowsById,
        [activeWindow.id]: nextSourceWindow,
        [nextWindow.id]: nextWindow,
      };

      return {
        ...state,
        activeWindowId: nextWindow.id,
        lastActiveWindowId: pickLastActiveWindowId(
          windowsById,
          nextWindow.id,
          activeWindow.id,
        ),
        windowsById,
      };
    }
    case "leaf/split": {
      return updateActiveWindow(state, (window) => {
        const existingLeaf = findLeafNode(window.root, action.leafId);
        if (!existingLeaf) return window;

        const existingPanel = window.panelsById[existingLeaf.panelInstanceId];
        const newPanel = existingPanel
          ? clonePanelInstance(existingPanel)
          : createPanelInstance("coordinator");
        const newLeaf = createLeafWithPanel(newPanel.id);
        const split: SplitNode = {
          kind: "split",
          id: newId("split"),
          dir: action.dir,
          ratio: 0.5,
          a: existingLeaf,
          b: newLeaf,
        };
        const nextRoot = replaceLeaf(window.root, action.leafId, split);
        return {
          ...window,
          root: nextRoot,
          panelsById: { ...window.panelsById, [newPanel.id]: newPanel },
          focusedLeafId: newLeaf.id,
        };
      });
    }
    case "leaf/close": {
      return updateActiveWindow(state, (window) => {
        const leafIds = listLeafIds(window.root);
        if (leafIds.length <= 1) return window;

        const result = closeLeafInLayout(window.root, action.leafId);
        if (!result.removedLeaf) return window;

        const stillUsedPanelIds = new Set(listPanelInstanceIds(result.root));
        const panelsById = { ...window.panelsById };
        if (!stillUsedPanelIds.has(result.removedLeaf.panelInstanceId)) {
          delete panelsById[result.removedLeaf.panelInstanceId];
        }

        const nextLeafIds = listLeafIds(result.root);
        const focusedLeafId =
          window.focusedLeafId && nextLeafIds.includes(window.focusedLeafId)
            ? window.focusedLeafId
            : nextLeafIds[0] ?? null;

        return {
          ...window,
          root: result.root,
          panelsById,
          focusedLeafId,
        };
      });
    }
    case "pane/move": {
      return updateActiveWindow(state, (window) => {
        if (action.fromLeafId === action.toLeafId) return window;

        const closeResult = closeLeafInLayout(window.root, action.fromLeafId);
        if (!closeResult.removedLeaf) return window;
        const movedLeaf = closeResult.removedLeaf;

        const targetLeaf = findLeafNode(closeResult.root, action.toLeafId);
        if (!targetLeaf) return window;

        const dir: SplitDirection =
          action.placement === "left" || action.placement === "right" ? "row" : "col";
        const insertBefore = action.placement === "left" || action.placement === "top";
        const split: SplitNode = {
          kind: "split",
          id: newId("split"),
          dir,
          ratio: 0.5,
          a: insertBefore ? movedLeaf : targetLeaf,
          b: insertBefore ? targetLeaf : movedLeaf,
        };

        const nextRoot = replaceLeaf(closeResult.root, action.toLeafId, split);
        if (nextRoot === window.root) return window;

        const nextLeafIds = listLeafIds(nextRoot);
        const focusedLeafId = nextLeafIds.includes(movedLeaf.id)
          ? movedLeaf.id
          : nextLeafIds[0] ?? null;

        return {
          ...window,
          root: nextRoot,
          focusedLeafId,
        };
      });
    }
    case "split/ratio": {
      return updateActiveWindow(state, (window) => {
        const nextRoot = updateSplitRatio(window.root, action.splitId, action.ratio);
        if (nextRoot === window.root) return window;
        return { ...window, root: nextRoot };
      });
    }
    case "split/resize-direction": {
      return updateActiveWindow(state, (window) => {
        if (!window.focusedLeafId) return window;
        const amount = typeof action.amount === "number" ? action.amount : 0.05;
        const nextRoot = resizeLeafByDirection(
          window.root,
          window.focusedLeafId,
          action.direction,
          amount,
        );
        if (nextRoot === window.root) return window;
        return { ...window, root: nextRoot };
      });
    }
    case "layout/equalize": {
      return updateActiveWindow(state, (window) => {
        const nextRoot = equalizeSplitRatios(window.root);
        if (nextRoot === window.root) return window;
        return { ...window, root: nextRoot };
      });
    }
    case "layout/cycle": {
      return updateActiveWindow(state, (window) => {
        let nextRoot = window.root;
        const isUniformRow = hasUniformSplitDirection(window.root, "row");
        const isUniformCol = hasUniformSplitDirection(window.root, "col");
        const hasMixedDirections = !isUniformRow && !isUniformCol;
        if (hasMixedDirections && !areSplitRatiosEqualized(window.root)) {
          nextRoot = equalizeSplitRatios(window.root);
        } else if (!isUniformRow) {
          nextRoot = rebuildLayoutInDirection(window.root, "row", () => newId("split"));
        } else if (!isUniformCol) {
          nextRoot = rebuildLayoutInDirection(window.root, "col", () => newId("split"));
        } else {
          nextRoot = equalizeSplitRatios(window.root);
        }

        if (nextRoot === window.root) return window;
        const nextLeafIds = listLeafIds(nextRoot);
        const focusedLeafId =
          window.focusedLeafId && nextLeafIds.includes(window.focusedLeafId)
            ? window.focusedLeafId
            : nextLeafIds[0] ?? null;
        return { ...window, root: nextRoot, focusedLeafId };
      });
    }
    case "panel/type": {
      return updateActiveWindow(state, (window) => {
        const panel = window.panelsById[action.panelInstanceId];
        if (!panel) return window;

        const def = getPanelDefinition(action.panelType) ?? getPanelDefinition("coordinator");
        if (!def) return window;
        if (panel.type === def.type && panel.configVersion === def.configVersion) return window;

        return {
          ...window,
          panelsById: {
            ...window.panelsById,
            [panel.id]: {
              ...panel,
              type: def.type,
              configVersion: def.configVersion,
              config: def.defaultConfig,
            },
          },
        };
      });
    }
    case "panel/config": {
      return updateActiveWindow(state, (window) => {
        const panel = window.panelsById[action.panelInstanceId];
        if (!panel) return window;
        const def = getPanelDefinition(panel.type);
        const normalizedPrev = def
          ? def.deserializeConfig(panel.config, panel.configVersion)
          : panel.config;
        const nextRawConfig = action.updater(normalizedPrev);
        const nextConfig = def
          ? def.deserializeConfig(nextRawConfig, panel.configVersion)
          : nextRawConfig;
        if (nextConfig === panel.config) return window;
        return {
          ...window,
          panelsById: {
            ...window.panelsById,
            [panel.id]: { ...panel, config: nextConfig },
          },
        };
      });
    }
    case "panel/open": {
      return updateActiveWindow(state, (window) => {
        const fromLeaf = findLeafNode(window.root, action.fromLeafId);
        if (!fromLeaf) return window;

        if (action.placement === "self") {
          return replacePanelInLeaf(window, action.fromLeafId, action.panelType, action.config);
        }

        const dir: SplitDirection =
          action.placement === "left" || action.placement === "right" ? "row" : "col";
        const adjacentLeafId = findAdjacentLeafIdByPlacement(
          window.root,
          action.fromLeafId,
          action.placement,
        );
        if (adjacentLeafId) {
          return replacePanelInLeaf(window, adjacentLeafId, action.panelType, action.config);
        }

        const newPanel = withPanelConfig(createPanelInstance(action.panelType), action.config);
        const newLeaf = createLeafWithPanel(newPanel.id);
        const insertBefore = action.placement === "left" || action.placement === "top";
        const split: SplitNode = {
          kind: "split",
          id: newId("split"),
          dir,
          ratio: 0.5,
          a: insertBefore ? newLeaf : fromLeaf,
          b: insertBefore ? fromLeaf : newLeaf,
        };

        const nextRoot = replaceLeaf(window.root, action.fromLeafId, split);
        return {
          ...window,
          root: nextRoot,
          panelsById: { ...window.panelsById, [newPanel.id]: newPanel },
          focusedLeafId: newLeaf.id,
        };
      });
    }
    case "agent/archive": {
      const targetAgentId = action.agentId.trim();
      if (targetAgentId.length === 0) return state;

      let changed = false;
      const windowsById: Record<string, WindowState> = {};
      for (const [windowId, window] of Object.entries(state.windowsById)) {
        const nextWindow = archiveAgentPanelsInWindow(window, targetAgentId);
        windowsById[windowId] = nextWindow;
        if (nextWindow !== window) changed = true;
      }

      if (!changed) return state;
      return {
        ...state,
        windowsById,
      };
    }
    case "preset/pin": {
      const window = getActiveWindow(state);
      if (!window) return state;
      const presetId = newId("preset");
      const preset: WindowPreset = {
        id: presetId,
        name: action.name.trim() || window.name,
        createdAt: new Date().toISOString(),
        window: {
          name: window.name,
          root: window.root,
          panelsById: window.panelsById,
          focusedLeafId: window.focusedLeafId,
        },
      };
      return {
        ...state,
        presetsById: { ...state.presetsById, [presetId]: preset },
      };
    }
    case "preset/delete": {
      if (!(action.presetId in state.presetsById)) return state;
      const { [action.presetId]: _deleted, ...rest } = state.presetsById;
      return { ...state, presetsById: rest };
    }
    case "preset/open": {
      const preset = state.presetsById[action.presetId];
      if (!preset) return state;
      const window = cloneWindowLayout(preset.window);
      const windowsById = { ...state.windowsById, [window.id]: window };
      return {
        ...state,
        activeWindowId: window.id,
        lastActiveWindowId: pickLastActiveWindowId(
          windowsById,
          window.id,
          state.activeWindowId,
        ),
        windowsById,
      };
    }
    default: {
      const _exhaustive: never = action;
      return state;
    }
  }
}

function createStore(initialState: WorkspaceState): WorkspaceStore {
  let state = initialState;
  const listeners = new Set<Listener>();

  const store: WorkspaceStore = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (action) => {
      const next = reduce(state, action);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
  return store;
}

const WorkspaceStoreContext = createContext<WorkspaceStore | null>(null);

export function WorkspaceProvider(props: {
  readonly userId: string | null | undefined;
  readonly children: React.ReactNode;
}) {
  const store = useMemo(() => {
    const initial = typeof window === "undefined"
      ? createDefaultWorkspaceState()
      : loadWorkspaceState(props.userId);
    return createStore(initial);
  }, [props.userId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let timeout: number | null = null;
    const unsubscribe = store.subscribe(() => {
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        timeout = null;
        saveWorkspaceState(props.userId, store.getState());
      }, 100);
    });
    return () => {
      if (timeout !== null) window.clearTimeout(timeout);
      unsubscribe();
    };
  }, [store, props.userId]);

  return (
    <WorkspaceStoreContext.Provider value={store}>
      {props.children}
    </WorkspaceStoreContext.Provider>
  );
}

export function useWorkspaceStore(): WorkspaceStore {
  const store = useContext(WorkspaceStoreContext);
  if (!store) throw new Error("WorkspaceProvider is missing");
  return store;
}

export function useWorkspaceSelector<T>(selector: (state: WorkspaceState) => T): T {
  const store = useWorkspaceStore();
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const lastRef = useRef<{
    hasValue: boolean;
    state: WorkspaceState | null;
    selector: ((state: WorkspaceState) => T) | null;
    value: T;
  }>({
    hasValue: false,
    state: null,
    selector: null,
    value: undefined as T,
  });

  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const activeSelector = selectorRef.current;
    const cached = lastRef.current;

    if (
      cached.hasValue &&
      cached.state === state &&
      cached.selector === activeSelector
    ) {
      return cached.value;
    }

    const value = activeSelector(state);
    lastRef.current = {
      hasValue: true,
      state,
      selector: activeSelector,
      value,
    };
    return value;
  }, [store]);

  return useSyncExternalStore(
    store.subscribe,
    getSnapshot,
    getSnapshot,
  );
}

export function useWorkspaceActions() {
  const store = useWorkspaceStore();
  const dispatch = useCallback((action: WorkspaceAction) => {
    store.dispatch(action);
  }, [store]);
  return { dispatch };
}
