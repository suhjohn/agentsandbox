import type { QueryClient } from "@tanstack/react-query";
import type {
  ClientToolErrorEnvelope,
  ClientToolName,
} from "../../../shared/client-tools-contract";
import type { AuthContextValue } from "@/lib/auth";
import { addClientSecret } from "./add-secret";
import {
  buildUiActionExecutionContext,
  getUiStateSnapshot,
} from "@/ui-actions/context";
import {
  executeUiAction,
  listAvailableUiActionsForContext,
} from "@/ui-actions/execute";

export type ClientToolExecutorDeps = {
  readonly auth: AuthContextValue;
  readonly navigate: (input: unknown) => unknown;
  readonly queryClient: QueryClient;
  readonly deviceId: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function buildContext(deps: ClientToolExecutorDeps) {
  return buildUiActionExecutionContext({
    auth: deps.auth,
    navigate: async (input: unknown) => deps.navigate(input as any),
    queryClient: deps.queryClient,
  });
}

function invalidArgs(message: string): ClientToolErrorEnvelope {
  return { code: "INVALID_ARGS", message, retryable: false };
}

function executionError(err: unknown): ClientToolErrorEnvelope {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "message" in err &&
    "retryable" in err
  ) {
    const value = err as {
      code: unknown;
      message: unknown;
      retryable: unknown;
    };
    if (
      typeof value.code === "string" &&
      typeof value.message === "string" &&
      typeof value.retryable === "boolean"
    ) {
      return {
        code: value.code,
        message: value.message,
        retryable: value.retryable,
      };
    }
  }
  if (err instanceof Error) {
    switch (err.message) {
      case "INVALID_SECRET_NAME":
        return {
          code: "INVALID_SECRET_NAME",
          message: "Invalid secret name.",
          retryable: false,
        };
      case "INVALID_SECRET_VALUE":
        return {
          code: "INVALID_ARGS",
          message: "Secret value is required.",
          retryable: false,
        };
      case "SECRET_ALREADY_EXISTS":
        return {
          code: "SECRET_ALREADY_EXISTS",
          message: "Secret already exists on this device.",
          retryable: false,
        };
      default:
        return {
          code: "EXECUTION_FAILED",
          message: err.message,
          retryable: false,
        };
    }
  }
  return {
    code: "EXECUTION_FAILED",
    message: "Client tool execution failed.",
    retryable: false,
  };
}

export async function executeClientTool(input: {
  readonly toolName: ClientToolName;
  readonly args: unknown;
  readonly deps: ClientToolExecutorDeps;
}): Promise<unknown> {
  const args = asRecord(input.args);
  switch (input.toolName) {
    case "ui_get_state":
      return getUiStateSnapshot(input.deps.auth);
    case "ui_list_available_actions": {
      const context = buildContext(input.deps);
      const surface =
        args.surface === "keyboard" ||
        args.surface === "palette" ||
        args.surface === "coordinator"
          ? args.surface
          : undefined;
      return listAvailableUiActionsForContext({ context, surface });
    }
    case "ui_run_action": {
      if (
        typeof args.actionId !== "string" ||
        args.actionId.trim().length === 0
      ) {
        throw invalidArgs("ui_run_action requires a non-empty actionId.");
      }
      const context = buildContext(input.deps);
      const result = await executeUiAction({
        actionId: args.actionId,
        actionVersion:
          typeof args.actionVersion === "number"
            ? args.actionVersion
            : undefined,
        params: args.params ?? {},
        timeoutMs:
          typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
        context,
      });
      return {
        didRun: true,
        actionId: args.actionId,
        result,
      };
    }
    case "add_secret": {
      if (
        typeof input.deps.auth.user?.id !== "string" ||
        input.deps.auth.user.id.trim().length === 0
      ) {
        throw {
          code: "NOT_AUTHENTICATED",
          message: "User authentication is required.",
          retryable: false,
        };
      }
      if (typeof args.name !== "string" || typeof args.value !== "string") {
        throw invalidArgs("add_secret requires string name and value fields.");
      }
      return addClientSecret({
        userId: input.deps.auth.user.id,
        deviceId: input.deps.deviceId,
        name: args.name,
        value: args.value,
        overwrite: args.overwrite === true,
      });
    }
  }
}

export function toClientToolExecutionError(
  err: unknown,
): ClientToolErrorEnvelope {
  return executionError(err);
}
