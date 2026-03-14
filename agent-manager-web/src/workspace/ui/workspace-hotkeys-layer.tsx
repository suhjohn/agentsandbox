// ACTIONS_AND_KEYBINDINGS_SPEC: This file mounts live workspace keyboard
// handling and transient keyboard UI. Keep
// docs/ACTIONS_AND_KEYBINDINGS_SPEC.md in sync with any additions or behavior
// changes here.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { buildUiExecutionContext } from "@/ui-actions/context";
import { executeUiAction } from "@/ui-actions/execute";
import { registerWorkspaceKeyboardRuntimeController } from "@/frontend-runtime/bridge";
import { listUiActionsForSurface } from "@/ui-actions/registry";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { findLeafNode, listLeafIds } from "../layout";
import { useWorkspaceSelector, useWorkspaceStore } from "../store";
import { useWorkspaceKeybindings } from "../keybindings/use-workspace-keybindings";
import {
  hasWorkspaceKeybindingOverrides,
  loadWorkspaceKeybindingOverrides,
  normalizePersistedWorkspaceKeybindingPayload,
  sanitizeWorkspaceKeybindingOverrides,
} from "../keybindings/persistence";
import type {
  WorkspaceCommandId,
  WorkspaceKeybinding,
  WorkspaceKeybindingOverrides,
} from "../keybindings/types";
import { formatKeySequence } from "../keybindings/types";
import {
  WORKSPACE_CANCEL_STREAM_EVENT,
  WORKSPACE_OPEN_COORDINATOR_EVENT,
  WORKSPACE_PANE_ZOOM_TOGGLE_EVENT,
  type WorkspaceCancelStreamEventDetail,
  WORKSPACE_TOGGLE_ALL_COLLAPSIBLES_EVENT,
  type WorkspaceToggleAllCollapsiblesEventDetail,
} from "../keybindings/events";
import {
  WorkspaceCommandPalette,
  type WorkspaceCommandPaletteItem,
} from "./workspace-command-palette";
import { WorkspaceKeybindingsDialog } from "./workspace-keybindings-dialog";

interface WorkspaceHotkeysLayerProps {
  readonly userId: string | null | undefined;
  readonly accountKeybindings?: unknown;
  readonly sessionsPanelOpen: boolean;
  readonly onSetSessionsPanelOpen: (open: boolean) => void;
  readonly onFocusSessionsFilter: () => void;
}

function getWindowIndexArg(params: unknown): number | null {
  if (typeof params === "number" && Number.isFinite(params)) {
    return Math.trunc(params);
  }
  if (typeof params !== "object" || params === null) return null;
  const index = (params as { index?: unknown }).index;
  if (typeof index !== "number" || !Number.isFinite(index)) return null;
  return Math.trunc(index);
}

function toggleAllCollapsibles(leafId: string | null): void {
  const scope =
    leafId === null
      ? document
      : document.querySelector<HTMLElement>(
          `[data-workspace-leaf-id="${leafId}"]`,
        );
  if (!scope) return;

  const collapsibles = scope.querySelectorAll("[data-collapsible-toggle-all]");
  if (collapsibles.length === 0) return;

  const openCollapsibles = scope.querySelectorAll(
    '[data-collapsible-toggle-all][data-collapsible-open="true"]',
  );
  const nextOpen = openCollapsibles.length !== collapsibles.length;
  window.dispatchEvent(
    new CustomEvent<WorkspaceToggleAllCollapsiblesEventDetail>(
      WORKSPACE_TOGGLE_ALL_COLLAPSIBLES_EVENT,
      {
        detail: leafId ? { open: nextOpen, leafId } : { open: nextOpen },
      },
    ),
  );
}

function dispatchCancelStream(leafId: string | null): void {
  window.dispatchEvent(
    new CustomEvent<WorkspaceCancelStreamEventDetail>(
      WORKSPACE_CANCEL_STREAM_EVENT,
      {
        detail: leafId ? { leafId } : {},
      },
    ),
  );
}

function dispatchPaneZoomToggle(leafId: string | null): void {
  if (!leafId) return;
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_PANE_ZOOM_TOGGLE_EVENT, {
      detail: { leafId },
    }),
  );
}

function isEventTargetInsideCoordinatorDialog(
  target: EventTarget | null,
): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('[data-coordinator-dialog="true"]') !== null;
}

function WorkspaceHotkeysLayerImpl(
  props: WorkspaceHotkeysLayerProps & {
    readonly initialOverrides: WorkspaceKeybindingOverrides;
  },
) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const store = useWorkspaceStore();

  const activeWindow = useWorkspaceSelector(
    (state) => state.windowsById[state.activeWindowId] ?? null,
  );
  const windows = useWorkspaceSelector((state) =>
    Object.keys(state.windowsById).map((windowId, index) => {
      const window = state.windowsById[windowId];
      return {
        id: windowId,
        index,
        name: window?.name ?? `Window ${index + 1}`,
        active: windowId === state.activeWindowId,
      };
    }),
  );
  const activePanelType = useWorkspaceSelector((state) => {
    const window = state.windowsById[state.activeWindowId];
    if (!window || !window.focusedLeafId) return null;
    const focusedLeaf = findLeafNode(window.root, window.focusedLeafId);
    if (!focusedLeaf) return null;
    return window.panelsById[focusedLeaf.panelInstanceId]?.type ?? null;
  });

  const [helpOpen, setHelpOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [windowSwitcherOpen, setWindowSwitcherOpen] = useState(false);
  const [renameDialogState, setRenameDialogState] = useState<{
    windowId: string;
    initialName: string;
  } | null>(null);
  const [renameInputValue, setRenameInputValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const leafIds = useMemo(
    () => (activeWindow ? listLeafIds(activeWindow.root) : []),
    [activeWindow],
  );

  useEffect(() => {
    if (renameDialogState) {
      setRenameInputValue(renameDialogState.initialName);
      const timer = setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [renameDialogState]);

  const runAction = useCallback(
    async (actionId: WorkspaceCommandId, params?: unknown): Promise<void> => {
      await executeUiAction({
        actionId,
        params,
        context: buildUiExecutionContext({
          auth,
          navigate: navigate as any,
          queryClient,
        }),
      });
    },
    [auth, navigate, queryClient],
  );

  const keybindings = useWorkspaceKeybindings({
    userId: props.userId,
    initialOverrides: props.initialOverrides,
    persistOverrides: false,
    workspaceActive: true,
    activePanelType: activePanelType ?? undefined,
    onPaneNumberSelect: (index) => {
      const state = store.getState();
      const active = state.windowsById[state.activeWindowId] ?? null;
      if (!active) return;
      const paneLeafIds = listLeafIds(active.root);
      const targetLeafId = paneLeafIds[index];
      if (!targetLeafId) return;
      store.dispatch({ type: "leaf/focus", leafId: targetLeafId });
    },
    onUnknownPrefix: (sequence) => {
      toast.message(`Unbound: ${formatKeySequence(sequence)}`);
    },
    onAction: async (request) => {
      await runAction(
        request.actionId,
        request.params ?? request.binding?.params,
      );
    },
  });

  useEffect(() => {
    return registerWorkspaceKeyboardRuntimeController({
      openHelp: async () => {
        setHelpOpen(true);
        return { open: true as const };
      },
      openPalette: async () => {
        setCommandPaletteOpen(true);
        return { open: true as const };
      },
      sendLeaderSequence: async () => {
        return { handled: true as const };
      },
      closeTransientUi: async () => {
        setHelpOpen(false);
        setCommandPaletteOpen(false);
        setWindowSwitcherOpen(false);
        setRenameDialogState(null);
        return { closed: true as const };
      },
      enterPaneNumberMode: async () => {
        keybindings.enterPaneNumberMode();
        return { open: true as const };
      },
      toggleFocusedPaneZoom: async () => {
        const state = store.getState();
        const activeWindowState =
          state.windowsById[state.activeWindowId] ?? null;
        dispatchPaneZoomToggle(activeWindowState?.focusedLeafId ?? null);
        return { toggled: true as const };
      },
      openWindowSwitcher: async () => {
        setWindowSwitcherOpen(true);
        return { open: true as const };
      },
      openRenameWindowDialog: async () => {
        const state = store.getState();
        const activeWindowState =
          state.windowsById[state.activeWindowId] ?? null;
        if (!activeWindowState) {
          throw new Error("Active workspace window unavailable");
        }
        setRenameDialogState({
          windowId: activeWindowState.id,
          initialName: activeWindowState.name,
        });
        return { open: true as const };
      },
      toggleSessionsPanel: async () => {
        const open = !props.sessionsPanelOpen;
        props.onSetSessionsPanelOpen(open);
        return { open };
      },
      focusSessionsPanelFilter: async () => {
        props.onFocusSessionsFilter();
        return { focused: true as const };
      },
      toggleAllCollapsibles: async () => {
        const state = store.getState();
        const activeWindowState =
          state.windowsById[state.activeWindowId] ?? null;
        toggleAllCollapsibles(activeWindowState?.focusedLeafId ?? null);
        return { toggled: true as const };
      },
      openCoordinator: async () => {
        window.dispatchEvent(new Event(WORKSPACE_OPEN_COORDINATOR_EVENT));
        return { open: true as const };
      },
      cancelFocusedStream: async () => {
        const state = store.getState();
        const activeWindowState =
          state.windowsById[state.activeWindowId] ?? null;
        dispatchCancelStream(activeWindowState?.focusedLeafId ?? null);
        return { cancelled: true as const };
      },
    });
  }, [keybindings, props, store]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEventTargetInsideCoordinatorDialog(event.target)) return;
      keybindings.handleKeyDown(event);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [keybindings.handleKeyDown, runAction]);

  const shortcutsByCommandId = useMemo(() => {
    const map = new Map<string, string>();
    const leaderDisplay = formatKeySequence(keybindings.leaderSequence);
    const formatBindingDisplay = (binding: WorkspaceKeybinding): string => {
      const sequenceDisplay = formatKeySequence(binding.sequence);
      if (binding.context === "workspace.prefix") {
        return `${leaderDisplay} ${sequenceDisplay}`;
      }
      return sequenceDisplay;
    };
    for (const binding of keybindings.bindings) {
      if (map.has(binding.actionId)) continue;
      map.set(binding.actionId, formatBindingDisplay(binding));
    }
    return map;
  }, [keybindings.bindings, keybindings.leaderSequence]);

  const commandPaletteItems = useMemo<WorkspaceCommandPaletteItem[]>(
    () =>
      [...listUiActionsForSurface("palette")]
        .sort((a, b) => {
          if (a.category !== b.category) {
            return a.category.localeCompare(b.category);
          }
          return a.title.localeCompare(b.title);
        })
        .map((command) => ({
          id: command.id,
          title: command.title,
          description: command.description,
          detail: shortcutsByCommandId.get(command.id) ?? "",
          keywords: [command.id, command.category],
        })),
    [shortcutsByCommandId],
  );

  const windowPaletteItems = useMemo<WorkspaceCommandPaletteItem[]>(
    () =>
      windows.map((window) => ({
        id: window.id,
        title: `${window.index}: ${window.name}`,
        description: window.active ? "Active window" : "Switch to this window",
        detail: String(window.index),
        keywords: [window.name, String(window.index)],
      })),
    [windows],
  );

  const bindingSummaryByWindowId = useMemo(() => {
    const summary = new Map<string, string>();
    const leaderDisplay = formatKeySequence(keybindings.leaderSequence);
    for (const window of windows) {
      const binding = keybindings.bindings.find(
        (candidate) =>
          candidate.actionId === "window.select_index" &&
          getWindowIndexArg(candidate.params) === window.index,
      );
      if (!binding) continue;
      const sequenceDisplay = formatKeySequence(binding.sequence);
      summary.set(
        window.id,
        binding.context === "workspace.prefix"
          ? `${leaderDisplay} ${sequenceDisplay}`
          : sequenceDisplay,
      );
    }
    return summary;
  }, [keybindings.bindings, keybindings.leaderSequence, windows]);

  return (
    <>
      <WorkspaceKeybindingsDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        commands={keybindings.commands}
        bindings={keybindings.bindings}
        onOpenSettings={() => {
          void navigate({ to: "/settings/keybindings" });
        }}
      />

      <WorkspaceCommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        title="Key Bindings"
        description="Search and run workspace key binding commands."
        placeholder="Type to search key bindings…"
        items={commandPaletteItems}
        onSelectItem={(item) => {
          const actionId = item.id as WorkspaceCommandId;
          void (async () => {
            const handled = await keybindings.runAction(actionId);
            if (!handled) {
              toast.error(`Failed to run command: ${item.title}`);
            }
          })();
        }}
      />

      <WorkspaceCommandPalette
        open={windowSwitcherOpen}
        onOpenChange={setWindowSwitcherOpen}
        title="Window Switcher"
        description="Jump directly to a workspace window."
        placeholder="Type a window name or index…"
        items={windowPaletteItems.map((item) => ({
          ...item,
          detail: bindingSummaryByWindowId.get(item.id) ?? item.detail,
        }))}
        onSelectItem={(item) => {
          const targetWindow = windows.find((window) => window.id === item.id);
          if (!targetWindow) return;
          store.dispatch({
            type: "window/activate-index",
            index: targetWindow.index,
          });
        }}
      />

      <Dialog
        open={renameDialogState !== null}
        onOpenChange={(open) => {
          if (!open) setRenameDialogState(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Rename window</DialogTitle>
            <DialogDescription className="text-xs">
              Enter a new name for this window.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              ref={renameInputRef}
              value={renameInputValue}
              onChange={(e) => setRenameInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameDialogState) {
                  const nextName = renameInputValue.trim();
                  if (nextName.length > 0) {
                    store.dispatch({
                      type: "window/rename",
                      windowId: renameDialogState.windowId,
                      name: nextName,
                    });
                    setRenameDialogState(null);
                  }
                }
              }}
              placeholder="Window name"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setRenameDialogState(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!renameDialogState) return;
                const nextName = renameInputValue.trim();
                if (nextName.length === 0) return;
                store.dispatch({
                  type: "window/rename",
                  windowId: renameDialogState.windowId,
                  name: nextName,
                });
                setRenameDialogState(null);
              }}
              disabled={renameInputValue.trim().length === 0}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {keybindings.engineState.mode === "prefix" ? (
        <div className="pointer-events-none fixed top-3 left-1/2 z-40 -translate-x-1/2 rounded border border-border bg-surface-1 px-2.5 py-1 text-[11px] font-mono text-text-secondary shadow-sm">
          {formatKeySequence(keybindings.leaderSequence)} …
        </div>
      ) : null}

      {keybindings.engineState.mode === "pane_number" ? (
        <Dialog
          open
          onOpenChange={(open) => !open && keybindings.cancelModes()}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">Select Pane</DialogTitle>
              <DialogDescription className="text-xs">
                Press a digit to focus a pane.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {leafIds.slice(0, 10).map((leafId, index) => {
                const leaf = activeWindow
                  ? findLeafNode(activeWindow.root, leafId)
                  : null;
                const panel = leaf
                  ? activeWindow?.panelsById[leaf.panelInstanceId]
                  : null;
                const isFocused = activeWindow?.focusedLeafId === leafId;
                return (
                  <Button
                    key={leafId}
                    variant={isFocused ? "default" : "secondary"}
                    className="w-full justify-start gap-3"
                    onClick={() => {
                      store.dispatch({ type: "leaf/focus", leafId });
                      keybindings.cancelModes();
                    }}
                  >
                    <span className="font-mono text-xs opacity-80">
                      {index}
                    </span>
                    <span className="truncate">{panel?.type ?? "panel"}</span>
                  </Button>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export function WorkspaceHotkeysLayer(props: WorkspaceHotkeysLayerProps) {
  const accountOverrides = useMemo(
    () => sanitizeWorkspaceKeybindingOverrides(props.accountKeybindings),
    [props.accountKeybindings],
  );
  const initialOverrides = useMemo(() => {
    if (hasWorkspaceKeybindingOverrides(accountOverrides))
      return accountOverrides;
    return loadWorkspaceKeybindingOverrides(props.userId);
  }, [accountOverrides, props.userId]);
  const accountKey = useMemo(() => {
    const payload = normalizePersistedWorkspaceKeybindingPayload(
      props.accountKeybindings,
    );
    return payload ? JSON.stringify(payload) : "none";
  }, [props.accountKeybindings]);

  return (
    <WorkspaceHotkeysLayerImpl
      key={`${props.userId ?? "anonymous"}:${accountKey}`}
      {...props}
      initialOverrides={initialOverrides}
    />
  );
}
