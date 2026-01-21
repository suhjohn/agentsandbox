import { newId } from "./id";
import { isLayoutNode, listLeafIds, listPanelInstanceIds } from "./layout";
import { getPanelDefinition } from "./panels/registry";
import type {
  LayoutNode,
  PanelInstance,
  WindowPreset,
  WindowState,
  WorkspaceState,
} from "./types";

const STORAGE_NAMESPACE = "agent-manager-web/workspace.v3";

function storageKey(userId: string | null | undefined): string {
  return `${STORAGE_NAMESPACE}:${userId ?? "anon"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPanelInstance(value: unknown): value is PanelInstance {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.configVersion === "number" &&
    "config" in value
  );
}

function isWindowState(value: unknown): value is WindowState {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (!isLayoutNode(value.root)) return false;
  if (!isRecord(value.panelsById)) return false;
  if (typeof value.focusedLeafId !== "string" && value.focusedLeafId !== null) {
    return false;
  }
  for (const panel of Object.values(value.panelsById)) {
    if (!isPanelInstance(panel)) return false;
  }
  return true;
}

function isWindowPreset(value: unknown): value is WindowPreset {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.createdAt !== "string") return false;
  if (!isRecord(value.window)) return false;
  const w = value.window as Record<string, unknown>;
  return (
    typeof w.name === "string" &&
    isLayoutNode(w.root) &&
    isRecord(w.panelsById) &&
    (typeof w.focusedLeafId === "string" || w.focusedLeafId === null)
  );
}

function createDefaultPanelInstance(type = "coordinator"): PanelInstance {
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

export function createDefaultWindowState(name = "Window 1"): WindowState {
  const panel = createDefaultPanelInstance("coordinator");
  const leafId = newId("leaf");
  const root: LayoutNode = {
    kind: "leaf",
    id: leafId,
    panelInstanceId: panel.id,
  };
  return {
    id: newId("win"),
    name,
    root,
    panelsById: { [panel.id]: panel },
    focusedLeafId: leafId,
  };
}

export function createDefaultWorkspaceState(): WorkspaceState {
  const window = createDefaultWindowState();
  return {
    version: 3,
    activeWindowId: window.id,
    lastActiveWindowId: null,
    windowsById: { [window.id]: window },
    presetsById: {},
  };
}

function hydratePanelInstance(instance: PanelInstance): PanelInstance {
  const def = getPanelDefinition(instance.type) ?? getPanelDefinition("coordinator");
  if (!def) return instance;

  const config = def.deserializeConfig(instance.config, instance.configVersion);
  return {
    ...instance,
    type: def.type,
    configVersion: def.configVersion,
    config,
  };
}

function hydrateWindowState(window: WindowState): WindowState {
  const neededPanelIds = new Set(listPanelInstanceIds(window.root));

  const panels: Record<string, PanelInstance> = {};
  for (const [id, panel] of Object.entries(window.panelsById)) {
    if (!neededPanelIds.has(id)) continue;
    panels[id] = hydratePanelInstance(panel);
  }

  for (const id of neededPanelIds) {
    if (panels[id]) continue;
    const replacement = createDefaultPanelInstance("coordinator");
    panels[id] = { ...replacement, id };
  }

  const leafIds = listLeafIds(window.root);
  const focusedLeafId =
    window.focusedLeafId && leafIds.includes(window.focusedLeafId)
      ? window.focusedLeafId
      : leafIds[0] ?? null;

  return {
    ...window,
    panelsById: panels,
    focusedLeafId,
  };
}

function hydratePreset(preset: WindowPreset): WindowPreset {
  const panelsByIdRaw = preset.window.panelsById as Record<string, unknown>;
  const panelsById: Record<string, PanelInstance> = {};
  for (const [id, panel] of Object.entries(panelsByIdRaw)) {
    if (!isPanelInstance(panel)) continue;
    panelsById[id] = hydratePanelInstance(panel);
  }

  const leafIds = listLeafIds(preset.window.root);
  const focusedLeafId =
    preset.window.focusedLeafId && leafIds.includes(preset.window.focusedLeafId)
      ? preset.window.focusedLeafId
      : leafIds[0] ?? null;

  return {
    ...preset,
    window: {
      name: preset.window.name,
      root: preset.window.root,
      panelsById,
      focusedLeafId,
    },
  };
}

export function loadWorkspaceState(
  userId: string | null | undefined,
): WorkspaceState {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return createDefaultWorkspaceState();

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return createDefaultWorkspaceState();
    if (parsed.version !== 3) return createDefaultWorkspaceState();

    const windowsByIdRaw = parsed.windowsById;
    const presetsByIdRaw = parsed.presetsById;
    if (!isRecord(windowsByIdRaw) || !isRecord(presetsByIdRaw)) {
      return createDefaultWorkspaceState();
    }

    const windowsById: Record<string, WindowState> = {};
    for (const window of Object.values(windowsByIdRaw)) {
      if (!isWindowState(window)) continue;
      windowsById[window.id] = hydrateWindowState(window);
    }

    if (Object.keys(windowsById).length === 0) {
      return createDefaultWorkspaceState();
    }

    const presetsById: Record<string, WindowPreset> = {};
    for (const preset of Object.values(presetsByIdRaw)) {
      if (!isWindowPreset(preset)) continue;
      presetsById[preset.id] = hydratePreset(preset);
    }

    const activeWindowId =
      typeof parsed.activeWindowId === "string" && parsed.activeWindowId in windowsById
        ? parsed.activeWindowId
        : Object.keys(windowsById)[0]!;
    const lastActiveWindowId =
      typeof parsed.lastActiveWindowId === "string" &&
      parsed.lastActiveWindowId in windowsById &&
      parsed.lastActiveWindowId !== activeWindowId
        ? parsed.lastActiveWindowId
        : Object.keys(windowsById).find((windowId) => windowId !== activeWindowId) ?? null;

    return {
      version: 3,
      activeWindowId,
      lastActiveWindowId,
      windowsById,
      presetsById,
    };
  } catch {
    return createDefaultWorkspaceState();
  }
}

export function saveWorkspaceState(
  userId: string | null | undefined,
  state: WorkspaceState,
): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // ignore persistence failures
  }
}
