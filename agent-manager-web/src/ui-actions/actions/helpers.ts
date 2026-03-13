import { z } from "zod";
import type { ActionUnavailableReason, UiActionAvailability } from "../types";

export const EMPTY_PARAMS_SCHEMA = z.object({});

export const EMPTY_PARAMS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

export function unavailable(
  reason: ActionUnavailableReason,
  details?: string,
): UiActionAvailability {
  return {
    ok: false,
    reason,
    ...(details ? { details } : {}),
  };
}
