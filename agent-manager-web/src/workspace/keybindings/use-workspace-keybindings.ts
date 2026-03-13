import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getWorkspaceCommand, WORKSPACE_KEYBINDING_COMMANDS } from "./commands";
import {
  DEFAULT_LEADER_SEQUENCE,
  DEFAULT_PREFIX_TIMEOUT_MS,
  DEFAULT_RESERVED_GLOBAL_CHORDS,
  DEFAULT_WORKSPACE_KEYBINDINGS,
  resolveWorkspaceKeybindings,
} from "./defaults";
import { findAllKeybindingConflicts, findConflictsForBinding, type KeybindingConflict } from "./conflicts";
import {
  createWorkspaceKeybindingEngine,
  WORKSPACE_KEYBINDING_ENGINE_INITIAL_STATE,
  type WorkspaceKeybindingEngineResult,
} from "./engine";
import {
  areWorkspaceKeybindingOverridesEqual,
  clearWorkspaceKeybindingOverrides,
  exportWorkspaceKeybindingOverrides,
  importWorkspaceKeybindingOverrides,
  loadWorkspaceKeybindingOverrides,
  saveWorkspaceKeybindingOverrides,
} from "./persistence";
import {
  createEmptyKeybindingOverrides,
  createKeyChord,
  type KeyboardEventLike,
  type KeybindingContext,
  type WorkspaceCommandDefinition,
  type WorkspaceCommandId,
  type WorkspaceCustomKeybinding,
  type WorkspaceKeySequence,
  type WorkspaceKeybinding,
  type WorkspaceKeybindingOverrides,
  type WorkspaceReservedChord,
} from "./types";

export interface WorkspaceActionRunRequest {
  readonly actionId: WorkspaceCommandId;
  readonly command: WorkspaceCommandDefinition;
  readonly params?: unknown;
  readonly source: "keyboard" | "api";
  readonly event?: KeyboardEventLike;
  readonly binding?: WorkspaceKeybinding;
}

export interface RebindWorkspaceActionInput {
  readonly actionId: WorkspaceCommandId;
  readonly context: KeybindingContext;
  readonly sequence: WorkspaceKeySequence;
  readonly params?: unknown;
  readonly replaceExisting?: boolean;
}

export interface ImportWorkspaceKeybindingResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface UseWorkspaceKeybindingsOptions {
  readonly userId?: string | null;
  readonly storage?: Storage | null;
  readonly initialOverrides?: WorkspaceKeybindingOverrides;
  readonly persistOverrides?: boolean;
  readonly workspaceActive?: boolean;
  readonly activePanelType?: string | null;
  readonly captureInInput?: boolean;
  readonly prefixTimeoutMs?: number;
  readonly leaderSequence?: WorkspaceKeySequence;
  readonly defaultBindings?: readonly WorkspaceKeybinding[];
  readonly reservedChords?: readonly WorkspaceReservedChord[];
  readonly commands?: readonly WorkspaceCommandDefinition[];
  readonly onAction?: (request: WorkspaceActionRunRequest) => void | Promise<void>;
  readonly onPaneNumberSelect?: (index: number) => void | Promise<void>;
  readonly onUnknownPrefix?: (sequence: WorkspaceKeySequence) => void;
}

export interface UseWorkspaceKeybindingsResult {
  readonly commands: readonly WorkspaceCommandDefinition[];
  readonly bindings: readonly WorkspaceKeybinding[];
  readonly overrides: WorkspaceKeybindingOverrides;
  readonly conflicts: readonly KeybindingConflict[];
  readonly engineState: ReturnType<
    ReturnType<typeof createWorkspaceKeybindingEngine>["getState"]
  >;
  readonly reservedChords: readonly WorkspaceReservedChord[];
  readonly leaderSequence: WorkspaceKeySequence;
  readonly runAction: (actionId: WorkspaceCommandId, params?: unknown) => Promise<boolean>;
  readonly setLeaderSequence: (sequence: WorkspaceKeySequence) => void;
  readonly resetLeaderSequence: () => void;
  readonly rebindAction: (input: RebindWorkspaceActionInput) => void;
  readonly removeBinding: (bindingId: string) => void;
  readonly resetBindings: () => void;
  readonly exportBindings: () => string;
  readonly importBindings: (serialized: string) => ImportWorkspaceKeybindingResult;
  readonly handleKeyDown: (event: KeyboardEventLike) => WorkspaceKeybindingEngineResult;
  readonly cancelModes: () => void;
  readonly enterPaneNumberMode: () => void;
  readonly getConflictsForBinding: (binding: WorkspaceKeybinding) => KeybindingConflict[];
}

function createUserBindingId(actionId: WorkspaceCommandId, context: KeybindingContext): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `user.${actionId}.${context}.${crypto.randomUUID()}`;
  }
  return `user.${actionId}.${context}.${Date.now().toString(36)}.${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function cloneSequence(sequence: WorkspaceKeySequence): WorkspaceKeySequence {
  return sequence.map((entry) => createKeyChord(entry));
}

export function useWorkspaceKeybindings(
  options: UseWorkspaceKeybindingsOptions = {},
): UseWorkspaceKeybindingsResult {
  const defaultBindings = options.defaultBindings ?? DEFAULT_WORKSPACE_KEYBINDINGS;
  const reservedChords = options.reservedChords ?? DEFAULT_RESERVED_GLOBAL_CHORDS;
  const commands = options.commands ?? WORKSPACE_KEYBINDING_COMMANDS;
  const workspaceActive = options.workspaceActive ?? true;
  const prefixTimeoutMs = options.prefixTimeoutMs ?? DEFAULT_PREFIX_TIMEOUT_MS;
  const persistOverrides = options.persistOverrides ?? true;

  const [overrides, setOverrides] = useState<WorkspaceKeybindingOverrides>(() =>
    options.initialOverrides ??
    loadWorkspaceKeybindingOverrides(options.userId, options.storage),
  );
  const leaderSequence =
    options.leaderSequence ?? overrides.leaderSequence ?? DEFAULT_LEADER_SEQUENCE;
  const [engineState, setEngineState] = useState(WORKSPACE_KEYBINDING_ENGINE_INITIAL_STATE);

  const skipNextSaveRef = useRef(Boolean(options.initialOverrides));
  useEffect(() => {
    if (options.initialOverrides) return;
    skipNextSaveRef.current = true;
    setOverrides((previous) => {
      const loaded = loadWorkspaceKeybindingOverrides(options.userId, options.storage);
      if (areWorkspaceKeybindingOverridesEqual(previous, loaded)) {
        return previous;
      }
      return loaded;
    });
  }, [options.userId, options.storage, options.initialOverrides]);

  useEffect(() => {
    if (!persistOverrides) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    saveWorkspaceKeybindingOverrides(options.userId, overrides, options.storage);
  }, [options.userId, options.storage, overrides, persistOverrides]);

  const bindings = useMemo(
    () => resolveWorkspaceKeybindings(overrides, defaultBindings),
    [defaultBindings, overrides],
  );

  const commandsById = useMemo(() => {
    return new Map(commands.map((command) => [command.id, command]));
  }, [commands]);

  const bindingsRef = useRef(bindings);
  const reservedChordsRef = useRef(reservedChords);
  const leaderSequenceRef = useRef(leaderSequence);
  const prefixTimeoutMsRef = useRef(prefixTimeoutMs);
  const workspaceActiveRef = useRef(workspaceActive);
  const activePanelContextRef = useRef<`panel:${string}` | null>(
    options.activePanelType ? `panel:${options.activePanelType}` : null,
  );
  const commandsByIdRef = useRef(commandsById);
  const onActionRef = useRef(options.onAction);
  const onPaneNumberSelectRef = useRef(options.onPaneNumberSelect);
  const onUnknownPrefixRef = useRef(options.onUnknownPrefix);

  bindingsRef.current = bindings;
  reservedChordsRef.current = reservedChords;
  leaderSequenceRef.current = leaderSequence;
  prefixTimeoutMsRef.current = prefixTimeoutMs;
  workspaceActiveRef.current = workspaceActive;
  activePanelContextRef.current = options.activePanelType
    ? `panel:${options.activePanelType}`
    : null;
  commandsByIdRef.current = commandsById;
  onActionRef.current = options.onAction;
  onPaneNumberSelectRef.current = options.onPaneNumberSelect;
  onUnknownPrefixRef.current = options.onUnknownPrefix;

  const engineRef = useRef<ReturnType<typeof createWorkspaceKeybindingEngine> | null>(null);

  const runActionRef = useRef(
    async (_request: WorkspaceActionRunRequest): Promise<boolean> => false,
  );

  const runActionInternal = useCallback(async (request: WorkspaceActionRunRequest): Promise<boolean> => {
    const command = commandsByIdRef.current.get(request.actionId) ?? getWorkspaceCommand(request.actionId);
    if (!command) return false;

    if (request.source === "keyboard" && request.event?.repeat && !command.repeatable) {
      return true;
    }

    if (command.id === "keyboard.mode.cancel") {
      engineRef.current?.cancelModes();
    }
    if (command.id === "pane.number_mode.open") {
      engineRef.current?.enterPaneNumberMode();
    }

    await onActionRef.current?.({
      ...request,
      command,
    });
    return true;
  }, []);
  runActionRef.current = runActionInternal;

  const engine = useMemo(() => {
    return createWorkspaceKeybindingEngine({
      getBindings: () => bindingsRef.current,
      getReservedChords: () => reservedChordsRef.current,
      getLeaderSequence: () => leaderSequenceRef.current,
      getPrefixTimeoutMs: () => prefixTimeoutMsRef.current,
      isWorkspaceActive: () => workspaceActiveRef.current,
      getActivePanelContext: () => activePanelContextRef.current,
      captureInInput: options.captureInInput,
      onBindingMatched: ({ binding, event }) => {
        void runActionRef.current({
          actionId: binding.actionId,
          params: binding.params,
          source: "keyboard",
          event,
          binding,
          command: getWorkspaceCommand(binding.actionId),
        });
      },
      onPaneNumberInput: ({ index }) => {
        void onPaneNumberSelectRef.current?.(index);
      },
      onUnknownPrefix: (sequence) => {
        onUnknownPrefixRef.current?.(sequence);
      },
      onStateChange: (state) => {
        setEngineState(state);
      },
    });
  }, [options.captureInInput]);

  useEffect(() => {
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [engine]);

  const runAction = useCallback(async (actionId: WorkspaceCommandId, params?: unknown) => {
    const command = commandsByIdRef.current.get(actionId) ?? getWorkspaceCommand(actionId);
    if (!command) return false;
    return runActionRef.current({
      actionId,
      command,
      params,
      source: "api",
    });
  }, []);

  const rebindAction = useCallback(
    (input: RebindWorkspaceActionInput) => {
      setOverrides((previous) => {
        const disabledDefaultBindingIds = new Set(previous.disabledDefaultBindingIds);
        let customBindings = [...previous.customBindings];
        const shouldReplace = input.replaceExisting !== false;

        if (shouldReplace) {
          for (const defaultBinding of defaultBindings) {
            if (
              defaultBinding.actionId === input.actionId &&
              defaultBinding.context === input.context
            ) {
              disabledDefaultBindingIds.add(defaultBinding.id);
            }
          }
          customBindings = customBindings.filter(
            (binding) =>
              !(binding.actionId === input.actionId && binding.context === input.context),
          );
        }

        const nextBinding: WorkspaceCustomKeybinding = {
          id: createUserBindingId(input.actionId, input.context),
          actionId: input.actionId,
          context: input.context,
          sequence: cloneSequence(input.sequence),
          params: input.params,
        };
        customBindings.push(nextBinding);

        return {
          leaderSequence: previous.leaderSequence,
          disabledDefaultBindingIds: [...disabledDefaultBindingIds],
          customBindings,
        };
      });
    },
    [defaultBindings],
  );

  const removeBinding = useCallback(
    (bindingId: string) => {
      setOverrides((previous) => {
        const isDefaultBinding = defaultBindings.some((binding) => binding.id === bindingId);
        if (isDefaultBinding) {
          if (previous.disabledDefaultBindingIds.includes(bindingId)) return previous;
          return {
            ...previous,
            disabledDefaultBindingIds: [...previous.disabledDefaultBindingIds, bindingId],
          };
        }

        const nextCustomBindings = previous.customBindings.filter((binding) => binding.id !== bindingId);
        if (nextCustomBindings.length === previous.customBindings.length) return previous;
        return {
          ...previous,
          customBindings: nextCustomBindings,
        };
      });
    },
    [defaultBindings],
  );

  const resetBindings = useCallback(() => {
    if (persistOverrides) {
      clearWorkspaceKeybindingOverrides(options.userId, options.storage);
    }
    setOverrides(createEmptyKeybindingOverrides());
  }, [options.storage, options.userId, persistOverrides]);

  const setLeaderSequence = useCallback((sequence: WorkspaceKeySequence) => {
    setOverrides((previous) => ({
      ...previous,
      leaderSequence: cloneSequence(sequence),
    }));
  }, []);

  const resetLeaderSequence = useCallback(() => {
    setOverrides((previous) => {
      if (typeof previous.leaderSequence === "undefined") return previous;
      return {
        ...previous,
        leaderSequence: undefined,
      };
    });
  }, []);

  const exportBindings = useCallback(() => {
    return exportWorkspaceKeybindingOverrides(overrides);
  }, [overrides]);

  const importBindings = useCallback((serialized: string): ImportWorkspaceKeybindingResult => {
    try {
      const importedOverrides = importWorkspaceKeybindingOverrides(serialized);
      setOverrides((previous) => {
        if (areWorkspaceKeybindingOverridesEqual(previous, importedOverrides)) {
          return previous;
        }
        return importedOverrides;
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid keybinding payload.",
      };
    }
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEventLike): WorkspaceKeybindingEngineResult => {
    return engineRef.current?.handleKeyDown(event) ?? { handled: false, reason: "no-match" };
  }, []);

  const cancelModes = useCallback(() => {
    engineRef.current?.cancelModes();
  }, []);

  const enterPaneNumberMode = useCallback(() => {
    engineRef.current?.enterPaneNumberMode();
  }, []);

  const conflicts = useMemo(
    () => findAllKeybindingConflicts(bindings, reservedChords),
    [bindings, reservedChords],
  );

  const getConflictsForBinding = useCallback(
    (binding: WorkspaceKeybinding): KeybindingConflict[] => {
      return findConflictsForBinding(binding, bindings, reservedChords);
    },
    [bindings, reservedChords],
  );

  return {
    commands,
    bindings,
    overrides,
    conflicts,
    engineState,
    reservedChords,
    leaderSequence,
    runAction,
    setLeaderSequence,
    resetLeaderSequence,
    rebindAction,
    removeBinding,
    resetBindings,
    exportBindings,
    importBindings,
    handleKeyDown,
    cancelModes,
    enterPaneNumberMode,
    getConflictsForBinding,
  };
}
