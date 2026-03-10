import { z } from "zod";
import type {
  SemanticActionDefinition,
  UiContextSnapshot,
} from "../types";
import { WORKSPACE_RUN_COMMAND_EVENT } from "@/workspace/keybindings/events";
import { WORKSPACE_KEYBINDING_COMMANDS } from "@/workspace/keybindings/commands";
import type {
  WorkspaceCommandDefinition,
  WorkspaceCommandId,
} from "@/workspace/keybindings/types";

type WorkspaceCommandResult = {
  readonly executed: true;
  readonly commandId: WorkspaceCommandId;
};

const EMPTY_PARAMS_SCHEMA = z.object({});
const EMPTY_PARAMS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

const windowSelectIndexParamsSchema = z.object({
  index: z.number().int().min(0).max(9),
});

const focusRequiredCommands = new Set<WorkspaceCommandId>([
  "pane.split.down",
  "pane.split.right",
  "pane.close",
  "pane.zoom.toggle",
  "pane.break_to_window",
  "pane.resize.left",
  "pane.resize.right",
  "pane.resize.up",
  "pane.resize.down",
  "pane.type.prev",
  "pane.type.next",
  "pane.agent_view.prev",
  "pane.agent_view.next",
]);

function unavailable(
  reason:
    | "NOT_AUTHENTICATED"
    | "WRONG_ROUTE"
    | "UI_NOT_READY"
    | "MISSING_REQUIRED_ENTITY",
  details?: string,
) {
  return { ok: false as const, reason, ...(details ? { details } : {}) };
}

function canRunWorkspaceCommand(
  ctx: UiContextSnapshot,
  commandId: WorkspaceCommandId,
) {
  if (!ctx.isAuthenticated) {
    return unavailable("NOT_AUTHENTICATED", "Log in before running workspace commands.");
  }
  if (ctx.routePath !== "/") {
    return unavailable("WRONG_ROUTE", "Workspace command requires the workspace route.");
  }
  if (!ctx.workspaceReady) {
    return unavailable("UI_NOT_READY", "Workspace runtime is not ready.");
  }

  if (focusRequiredCommands.has(commandId) && ctx.workspaceFocusedLeafId === null) {
    return unavailable("MISSING_REQUIRED_ENTITY", "No focused workspace pane.");
  }

  if (commandId === "pane.close" && ctx.workspaceLeafCount <= 1) {
    return unavailable("MISSING_REQUIRED_ENTITY", "Cannot close the last workspace pane.");
  }
  if (commandId === "window.close" && ctx.workspaceWindowCount <= 1) {
    return unavailable("MISSING_REQUIRED_ENTITY", "Cannot close the last workspace window.");
  }
  if (commandId === "workspace.sessions_panel.focus_filter" && !ctx.workspaceSessionsPanelOpen) {
    return unavailable(
      "MISSING_REQUIRED_ENTITY",
      "Sessions side panel is closed.",
    );
  }
  if (commandId === "workspace.stream.cancel" && !ctx.chatStreaming) {
    return unavailable("MISSING_REQUIRED_ENTITY", "No active stream to cancel.");
  }
  if (commandId === "pane.number_mode.open" && ctx.workspaceLeafCount <= 0) {
    return unavailable("MISSING_REQUIRED_ENTITY", "No panes are available.");
  }
  return { ok: true as const };
}

function invokeWorkspaceCommand(
  commandId: WorkspaceCommandId,
  args?: unknown,
): Promise<{ readonly handled: boolean }> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Workspace command runtime unavailable"));
  }
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("Workspace command runtime unavailable"));
    }, 2_000);

    const respond = (result: { readonly handled: boolean }) => {
      window.clearTimeout(timeoutId);
      resolve(result);
    };
    const rejectWithError = (error: unknown) => {
      window.clearTimeout(timeoutId);
      reject(error instanceof Error ? error : new Error("Workspace command failed"));
    };

    window.dispatchEvent(
      new CustomEvent(WORKSPACE_RUN_COMMAND_EVENT, {
        detail: {
          commandId,
          args,
          respond,
          reject: rejectWithError,
        },
      }),
    );
  });
}

function createWorkspaceCommandAction(
  command: WorkspaceCommandDefinition,
): SemanticActionDefinition<Record<string, never>, WorkspaceCommandResult> {
  return {
    id: command.id,
    version: 1,
    description: command.description,
    paramsSchema: EMPTY_PARAMS_SCHEMA,
    paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA,
    canRun: (ctx) => canRunWorkspaceCommand(ctx, command.id),
    run: async () => {
      const result = await invokeWorkspaceCommand(command.id);
      if (!result.handled) {
        throw new Error(`Workspace command was not handled: ${command.id}`);
      }
      return {
        executed: true as const,
        commandId: command.id,
      };
    },
  };
}

export const workspaceWindowSelectIndexAction: SemanticActionDefinition<
  z.infer<typeof windowSelectIndexParamsSchema>,
  WorkspaceCommandResult
> = {
  id: "window.select_index",
  version: 1,
  description: "Switch to a workspace window by index.",
  paramsSchema: windowSelectIndexParamsSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["index"],
    properties: {
      index: {
        type: "integer",
        minimum: 0,
        maximum: 9,
      },
    },
  },
  canRun: (ctx) => canRunWorkspaceCommand(ctx, "window.select_index"),
  run: async (_ctx, params) => {
    const result = await invokeWorkspaceCommand("window.select_index", {
      index: params.index,
    });
    if (!result.handled) {
      throw new Error("Workspace command was not handled: window.select_index");
    }
    return {
      executed: true as const,
      commandId: "window.select_index" as const,
    };
  },
};

const commandActions = WORKSPACE_KEYBINDING_COMMANDS
  .filter((command) => command.id !== "window.select_index")
  .map((command) => createWorkspaceCommandAction(command));

export const workspaceKeybindingCommandActions = [
  ...commandActions,
  workspaceWindowSelectIndexAction,
] as const;
