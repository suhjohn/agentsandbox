// ACTIONS_AND_KEYBINDINGS_SPEC: This file validates and executes canonical UI
// actions, including keyboard-triggered workspace actions. Keep
// docs/ACTIONS_AND_KEYBINDINGS_SPEC.md in sync with any additions or behavior
// changes here.
import {
  isUiActionId,
  type UiActionId,
} from "../../../shared/ui-actions-contract";
import type {
  ActionErrorCode,
  ActionUnavailableReason,
  UiExecutionContext,
} from "./types";
import { getUiActionDefinition, listUiActionDefinitions } from "./registry";

export class UiActionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Action timed out after ${timeoutMs}ms`);
  }
}

export function toActionError(input: {
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

export type UiActionExecutionError = {
  readonly code: ActionErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly reason?: ActionUnavailableReason;
};

export function toUiActionError(input: {
  readonly code: ActionErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly reason?: ActionUnavailableReason;
}): UiActionExecutionError {
  return toActionError(input).error;
}

export function clampTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) return 10_000;
  return Math.max(1_000, Math.min(60_000, Math.floor(timeoutMs)));
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new UiActionTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

export async function executeUiAction(input: {
  readonly actionId: string;
  readonly actionVersion?: number;
  readonly params: unknown;
  readonly context: UiExecutionContext;
  readonly timeoutMs?: number;
}): Promise<unknown> {
  if (!isUiActionId(input.actionId)) {
    throw toUiActionError({
      code: "ACTION_UNKNOWN",
      message: `Unknown action: ${input.actionId}`,
      retryable: false,
    });
  }
  const action = getUiActionDefinition(input.actionId);
  if (!action) {
    throw toUiActionError({
      code: "ACTION_UNKNOWN",
      message: `Unknown action: ${input.actionId}`,
      retryable: false,
    });
  }
  const actionVersion = typeof input.actionVersion === "number" ? input.actionVersion : 1;
  if (actionVersion !== action.version) {
    throw toUiActionError({
      code: "ACTION_INVALID_PARAMS",
      message: `Unsupported actionVersion: ${actionVersion}`,
      retryable: false,
    });
  }

  const paramsResult = action.paramsSchema.safeParse(input.params ?? {});
  if (!paramsResult.success) {
    throw toUiActionError({
      code: "ACTION_INVALID_PARAMS",
      message: paramsResult.error.issues[0]?.message ?? "Invalid action params",
      retryable: false,
    });
  }

  const availability = action.canRun(input.context.snapshot);
  if (!availability.ok) {
    throw toUiActionError({
      code: "ACTION_UNAVAILABLE",
      message: availability.details ?? `Action unavailable: ${availability.reason}`,
      retryable: false,
      reason: availability.reason,
    });
  }

  return await withTimeout(
    action.run(input.context, paramsResult.data),
    clampTimeout(input.timeoutMs),
  );
}

export function listAvailableUiActionsForContext(input: {
  readonly context: UiExecutionContext;
  readonly surface?: keyof UiExecutionContext["snapshot"] | "keyboard" | "palette" | "coordinator";
}) {
  const requestedSurface =
    input.surface === "keyboard" ||
    input.surface === "palette" ||
    input.surface === "coordinator"
      ? input.surface
      : null;

  return {
    actions: listUiActionDefinitions()
      .filter((actionDefinition) =>
        requestedSurface ? actionDefinition.surfaces[requestedSurface] : true,
      )
      .map((actionDefinition) => {
        const available = actionDefinition.canRun(input.context.snapshot);
        return {
          id: actionDefinition.id,
          version: actionDefinition.version,
          available: available.ok,
          reason: available.ok ? undefined : available.reason,
          description: actionDefinition.description,
          paramsJsonSchema: actionDefinition.paramsJsonSchema,
        };
      }),
  };
}
