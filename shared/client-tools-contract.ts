export const CLIENT_TOOL_NAMES = [
  "ui_get_state",
  "ui_run_action",
  "add_secret",
] as const;

export type ClientToolName = (typeof CLIENT_TOOL_NAMES)[number];

export type ClientToolRequestInput = {
  readonly toolName: ClientToolName;
  readonly args: unknown;
};

export type ClientToolErrorEnvelope = {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
};

export type ClientToolRequestEnvelope = {
  readonly requestId: string;
  readonly toolName: ClientToolName;
  readonly args: unknown;
  readonly targetDeviceId: string;
  readonly cancellable: boolean;
};

export type ClientToolRequestEvent = {
  readonly type: "client_tool_request";
  readonly runId: string;
  readonly request: ClientToolRequestEnvelope;
};

export type ClientToolCancelEvent = {
  readonly type: "client_tool_cancel";
  readonly runId: string;
  readonly requestId: string;
  readonly targetDeviceId: string;
};

export type ClientToolRegistrationPayload = {
  readonly userId: string;
  readonly deviceId: string;
  readonly tools: readonly ClientToolName[];
  readonly device?: Readonly<Record<string, unknown>>;
};

export type ClientToolUnregisterPayload = {
  readonly userId: string;
  readonly deviceId: string;
};

export type ClientToolResponsePayload =
  | {
      readonly requestId: string;
      readonly userId: string;
      readonly deviceId: string;
      readonly ok: true;
      readonly result: unknown;
    }
  | {
      readonly requestId: string;
      readonly userId: string;
      readonly deviceId: string;
      readonly ok: false;
      readonly error: ClientToolErrorEnvelope;
    };

export function isClientToolName(value: unknown): value is ClientToolName {
  return (
    typeof value === "string" &&
    CLIENT_TOOL_NAMES.includes(value as ClientToolName)
  );
}
