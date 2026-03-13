import { z } from "zod";
import type { QueryClient } from "@tanstack/react-query";
import type { AuthContextValue } from "@/lib/auth";
import { buildUiExecutionContext, getUiStateSnapshot } from "@/ui-actions/context";
import {
  executeUiAction,
  listAvailableUiActionsForContext,
  toUiActionError,
  type UiActionExecutionError,
} from "@/ui-actions/execute";
import { executeBrowserClientToolRequest } from "./browser-tools";
import type {
  ActionErrorCode,
  ActionUnavailableReason,
  ClientToolActionResult,
  UiExecutionContext,
} from "./types";
import {
  assertCoordinatorClientToolNamesMatch,
  isCoordinatorBrowserClientToolName,
  isCoordinatorClientToolName,
} from "../../../shared/coordinator-client-tools-contract";

const uiRunActionSchema = z.object({
  actionId: z.string().min(1),
  actionVersion: z.number().int().optional(),
  params: z.unknown().optional(),
});

const EXECUTOR_CLIENT_TOOL_NAMES = [
  "ui_get_state",
  "ui_list_available_actions",
  "ui_run_action",
  "ui_browser_navigate",
  "ui_browser_snapshot",
  "ui_browser_click",
  "ui_browser_type",
  "ui_browser_wait",
  "ui_browser_scroll",
  "ui_browser_eval",
] as const;

assertCoordinatorClientToolNamesMatch({
  implementedToolNames: EXECUTOR_CLIENT_TOOL_NAMES,
  source: "agent-manager-web coordinator-actions executor",
});

class ActionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Action timed out after ${timeoutMs}ms`);
  }
}

function toActionError(input: {
  readonly code: ActionErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly reason?: ActionUnavailableReason;
}) {
  return {
    error: {
      code: input.code,
      message: input.message,
      retryable: input.retryable,
      reason: input.reason,
    },
  };
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) return 10_000;
  return Math.max(1_000, Math.min(60_000, Math.floor(timeoutMs)));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new ActionTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

function isUiActionExecutionError(error: unknown): error is UiActionExecutionError {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.retryable === "boolean"
  );
}

export async function executeCoordinatorClientToolRequest(input: {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly timeoutMs: number;
  readonly auth: AuthContextValue;
  readonly navigate: UiExecutionContext["navigate"];
  readonly queryClient: QueryClient;
}): Promise<ClientToolActionResult> {
  const uiStateBefore = getUiStateSnapshot(input.auth);
  const finish = (
    payload:
      | { readonly ok: true; readonly data: unknown }
      | {
          readonly ok: false;
          readonly error: {
            readonly code: ActionErrorCode;
            readonly message: string;
            readonly retryable: boolean;
            readonly reason?: ActionUnavailableReason;
          };
        },
  ): ClientToolActionResult => ({
    toolCallId: input.toolCallId,
    ok: payload.ok,
    ...(payload.ok ? { data: payload.data } : { error: payload.error }),
    uiStateBefore,
    uiStateAfter: getUiStateSnapshot(input.auth),
  });

  const context = buildUiExecutionContext({
    auth: input.auth,
    navigate: input.navigate,
    queryClient: input.queryClient,
  });

  if (input.toolName === "ui_list_available_actions") {
    return finish({
      ok: true,
      data: listAvailableUiActionsForContext({
        context,
        surface: "coordinator",
      }),
    });
  }

  if (input.toolName === "ui_get_state") {
    return finish({
      ok: true,
      data: { state: getUiStateSnapshot(input.auth) },
    });
  }

  if (!isCoordinatorClientToolName(input.toolName)) {
    return finish({
      ok: false,
      error: toActionError({
        code: "ACTION_UNKNOWN",
        message: `Unknown client tool: ${input.toolName}`,
        retryable: false,
      }).error,
    });
  }

  if (isCoordinatorBrowserClientToolName(input.toolName)) {
    try {
      const data = await withTimeout(
        executeBrowserClientToolRequest({
          toolName: input.toolName,
          args: input.args,
          navigate: input.navigate,
        }),
        clampTimeout(input.timeoutMs),
      );
      return finish({ ok: true, data });
    } catch (error) {
      if (error instanceof ActionTimeoutError) {
        return finish({
          ok: false,
          error: toActionError({
            code: "ACTION_TIMEOUT",
            message: error.message,
            retryable: true,
          }).error,
        });
      }
      if (error instanceof z.ZodError) {
        return finish({
          ok: false,
          error: toActionError({
            code: "ACTION_INVALID_PARAMS",
            message: error.issues[0]?.message ?? `Invalid ${input.toolName} args`,
            retryable: false,
          }).error,
        });
      }
      if (error instanceof Error) {
        return finish({
          ok: false,
          error: toActionError({
            code: "ACTION_EXECUTION_FAILED",
            message: error.message,
            retryable: true,
          }).error,
        });
      }
      return finish({
        ok: false,
        error: toActionError({
          code: "ACTION_EXECUTION_FAILED",
          message: "Browser action failed",
          retryable: true,
        }).error,
      });
    }
  }

  const parsedArgs = uiRunActionSchema.safeParse(input.args);
  if (!parsedArgs.success) {
    return finish({
      ok: false,
      error: toActionError({
        code: "ACTION_INVALID_PARAMS",
        message: parsedArgs.error.issues[0]?.message ?? "Invalid ui_run_action args",
        retryable: false,
      }).error,
    });
  }

  try {
    const data = await withTimeout(
      Promise.resolve(
        executeUiAction({
          actionId: parsedArgs.data.actionId,
          actionVersion: parsedArgs.data.actionVersion,
          params: parsedArgs.data.params,
          context,
        }),
      ),
      clampTimeout(input.timeoutMs),
    );
    return finish({ ok: true, data });
  } catch (error) {
    if (error instanceof ActionTimeoutError) {
      return finish({
        ok: false,
        error: toActionError({
          code: "ACTION_TIMEOUT",
          message: error.message,
          retryable: true,
        }).error,
      });
    }
    if (error instanceof z.ZodError) {
      return finish({
        ok: false,
        error: toActionError({
          code: "ACTION_INVALID_PARAMS",
          message: error.issues[0]?.message ?? "Invalid ui_run_action args",
          retryable: false,
        }).error,
      });
    }
    if (isUiActionExecutionError(error)) {
      return finish({
        ok: false,
        error,
      });
    }
    if (typeof error === "object" && error !== null && "message" in error) {
      return finish({
        ok: false,
        error: toActionError({
          code: "ACTION_EXECUTION_FAILED",
          message: String((error as { readonly message?: unknown }).message ?? "Action failed"),
          retryable: true,
        }).error,
      });
    }
    return finish({
      ok: false,
      error: toActionError({
        code: "ACTION_EXECUTION_FAILED",
        message: "Action failed",
        retryable: true,
      }).error,
    });
  }
}
