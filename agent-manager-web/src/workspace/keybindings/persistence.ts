import { isWorkspaceCommandId } from "./commands";
import {
  createEmptyKeybindingOverrides,
  createKeyChord,
  isKeySequence,
  isKeybindingContext,
  type WorkspaceCustomKeybinding,
  type WorkspaceKeybindingOverrides,
} from "./types";

export const WORKSPACE_KEYBINDINGS_OVERRIDES_VERSION = 2;

const STORAGE_KEY_PREFIX = "agent-manager-web.workspace.keybindings";

interface SerializedOverridesV2 {
  readonly version: 2;
  readonly leaderSequence?: unknown;
  readonly disabledDefaultBindingIds: readonly string[];
  readonly customBindings: readonly SerializedCustomBinding[];
}

interface SerializedCustomBinding {
  readonly id: string;
  readonly context: string;
  readonly sequence: unknown;
  readonly commandId: string;
  readonly args?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeUserKey(userId: string | null | undefined): string {
  const normalized = userId?.trim();
  if (!normalized) return "anonymous";
  return normalized;
}

export function getWorkspaceKeybindingsStorageKey(userId: string | null | undefined): string {
  return `${STORAGE_KEY_PREFIX}:${normalizeUserKey(userId)}`;
}

function parseCustomBinding(value: unknown): WorkspaceCustomKeybinding | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.trim().length === 0) return null;
  if (!isKeybindingContext(value.context)) return null;
  if (!isWorkspaceCommandId(value.commandId)) return null;
  if (!isKeySequence(value.sequence)) return null;

  return {
    id: value.id,
    context: value.context,
    commandId: value.commandId,
    sequence: value.sequence.map((entry) => createKeyChord(entry)),
    args: value.args,
  };
}

export function sanitizeWorkspaceKeybindingOverrides(
  value: unknown,
): WorkspaceKeybindingOverrides {
  if (!isRecord(value)) return createEmptyKeybindingOverrides();
  if (value.version !== 1 && value.version !== 2) {
    return createEmptyKeybindingOverrides();
  }

  const rawLeaderSequence = value.version === 2 ? value.leaderSequence : undefined;
  const rawDisabledDefaultBindingIds = value.disabledDefaultBindingIds;
  const rawCustomBindings = value.customBindings;

  const leaderSequence =
    isKeySequence(rawLeaderSequence) && rawLeaderSequence.length === 1
      ? rawLeaderSequence.map((entry) => createKeyChord(entry))
      : undefined;

  const disabledDefaultBindingIds = Array.isArray(rawDisabledDefaultBindingIds)
    ? rawDisabledDefaultBindingIds
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

  const customBindings = Array.isArray(rawCustomBindings)
    ? rawCustomBindings.map((entry) => parseCustomBinding(entry)).filter((entry) => entry !== null)
    : [];

  return {
    leaderSequence,
    disabledDefaultBindingIds,
    customBindings,
  };
}

export function serializeWorkspaceKeybindingOverrides(
  overrides: WorkspaceKeybindingOverrides,
): SerializedOverridesV2 {
  return {
    version: 2,
    ...(overrides.leaderSequence
      ? { leaderSequence: overrides.leaderSequence.map((entry) => createKeyChord(entry)) }
      : {}),
    disabledDefaultBindingIds: [...overrides.disabledDefaultBindingIds],
    customBindings: overrides.customBindings.map((binding) => ({
      id: binding.id,
      context: binding.context,
      commandId: binding.commandId,
      sequence: binding.sequence,
      args: binding.args,
    })),
  };
}

export function hasWorkspaceKeybindingOverrides(
  overrides: WorkspaceKeybindingOverrides,
): boolean {
  return (
    (Array.isArray(overrides.leaderSequence) && overrides.leaderSequence.length > 0) ||
    overrides.disabledDefaultBindingIds.length > 0 ||
    overrides.customBindings.length > 0
  );
}

export function toPersistedWorkspaceKeybindingPayload(
  overrides: WorkspaceKeybindingOverrides,
): Record<string, unknown> | null {
  if (!hasWorkspaceKeybindingOverrides(overrides)) return null;
  const serialized = serializeWorkspaceKeybindingOverrides(overrides);
  const payload: Record<string, unknown> = {
    version: serialized.version,
    ...(serialized.leaderSequence ? { leaderSequence: serialized.leaderSequence } : {}),
    disabledDefaultBindingIds: [...serialized.disabledDefaultBindingIds],
    customBindings: serialized.customBindings.map((binding) => ({
      id: binding.id,
      context: binding.context,
      commandId: binding.commandId,
      sequence: binding.sequence,
      args: binding.args,
    })),
  };
  return payload;
}

export function normalizePersistedWorkspaceKeybindingPayload(
  value: unknown,
): Record<string, unknown> | null {
  return toPersistedWorkspaceKeybindingPayload(
    sanitizeWorkspaceKeybindingOverrides(value),
  );
}

export function areWorkspaceKeybindingOverridesEqual(
  a: WorkspaceKeybindingOverrides,
  b: WorkspaceKeybindingOverrides,
): boolean {
  return (
    JSON.stringify(serializeWorkspaceKeybindingOverrides(a)) ===
    JSON.stringify(serializeWorkspaceKeybindingOverrides(b))
  );
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function loadWorkspaceKeybindingOverrides(
  userId: string | null | undefined,
  storage?: Storage | null,
): WorkspaceKeybindingOverrides {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage) return createEmptyKeybindingOverrides();

  const storageKey = getWorkspaceKeybindingsStorageKey(userId);
  const raw = targetStorage.getItem(storageKey);
  if (!raw) return createEmptyKeybindingOverrides();

  try {
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeWorkspaceKeybindingOverrides(parsed);
  } catch {
    return createEmptyKeybindingOverrides();
  }
}

export function saveWorkspaceKeybindingOverrides(
  userId: string | null | undefined,
  overrides: WorkspaceKeybindingOverrides,
  storage?: Storage | null,
): void {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage) return;
  const storageKey = getWorkspaceKeybindingsStorageKey(userId);
  const serialized = serializeWorkspaceKeybindingOverrides(overrides);
  targetStorage.setItem(storageKey, JSON.stringify(serialized));
}

export function clearWorkspaceKeybindingOverrides(
  userId: string | null | undefined,
  storage?: Storage | null,
): void {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage) return;
  const storageKey = getWorkspaceKeybindingsStorageKey(userId);
  targetStorage.removeItem(storageKey);
}

export function exportWorkspaceKeybindingOverrides(
  overrides: WorkspaceKeybindingOverrides,
): string {
  return JSON.stringify(serializeWorkspaceKeybindingOverrides(overrides), null, 2);
}

export function importWorkspaceKeybindingOverrides(serialized: string): WorkspaceKeybindingOverrides {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Invalid keybinding JSON payload.");
  }
  return sanitizeWorkspaceKeybindingOverrides(parsed);
}
