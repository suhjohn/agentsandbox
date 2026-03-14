// ACTIONS_AND_KEYBINDINGS_SPEC: This file computes workspace keybinding
// conflicts and reserved-chord collisions. Keep
// docs/ACTIONS_AND_KEYBINDINGS_SPEC.md in sync with any additions or behavior
// changes here.
import type {
  KeybindingContext,
  WorkspaceKeySequence,
  WorkspaceKeybinding,
  WorkspaceReservedChord,
} from "./types";
import { areKeySequencesEqual, formatKeySequence, serializeKeySequence } from "./types";

export interface KeybindingConflict {
  readonly kind: "binding" | "reserved";
  readonly context: KeybindingContext;
  readonly sequence: WorkspaceKeySequence;
  readonly sequenceDisplay: string;
  readonly bindingIds: readonly string[];
  readonly actionIds: readonly string[];
  readonly reservedChordId?: string;
}

interface KeybindingGroup {
  readonly context: KeybindingContext;
  readonly sequence: WorkspaceKeySequence;
  readonly bindings: WorkspaceKeybinding[];
}

function buildGroupKey(context: KeybindingContext, sequence: WorkspaceKeySequence): string {
  return `${context}::${serializeKeySequence(sequence)}`;
}

function groupByContextAndSequence(bindings: readonly WorkspaceKeybinding[]): KeybindingGroup[] {
  const grouped = new Map<string, KeybindingGroup>();
  for (const binding of bindings) {
    const key = buildGroupKey(binding.context, binding.sequence);
    const existingGroup = grouped.get(key);
    if (existingGroup) {
      existingGroup.bindings.push(binding);
      continue;
    }
    grouped.set(key, {
      context: binding.context,
      sequence: binding.sequence,
      bindings: [binding],
    });
  }
  return [...grouped.values()];
}

function contextsUseReservedShortcut(context: KeybindingContext): boolean {
  return context !== "workspace.prefix" && context !== "workspace.pane_number";
}

export function findBindingConflicts(bindings: readonly WorkspaceKeybinding[]): KeybindingConflict[] {
  const conflicts: KeybindingConflict[] = [];
  for (const group of groupByContextAndSequence(bindings)) {
    const uniqueCommandIds = new Set(group.bindings.map((binding) => binding.actionId));
    if (uniqueCommandIds.size <= 1) continue;
    conflicts.push({
      kind: "binding",
      context: group.context,
      sequence: group.sequence,
      sequenceDisplay: formatKeySequence(group.sequence),
      bindingIds: group.bindings.map((binding) => binding.id),
      actionIds: [...uniqueCommandIds],
    });
  }
  return conflicts;
}

export function findReservedChordConflicts(
  bindings: readonly WorkspaceKeybinding[],
  reservedChords: readonly WorkspaceReservedChord[],
): KeybindingConflict[] {
  const conflicts: KeybindingConflict[] = [];
  for (const binding of bindings) {
    if (!contextsUseReservedShortcut(binding.context)) continue;
    for (const reservedChord of reservedChords) {
      if (!areKeySequencesEqual(binding.sequence, reservedChord.sequence)) continue;
      conflicts.push({
        kind: "reserved",
        context: binding.context,
        sequence: binding.sequence,
        sequenceDisplay: formatKeySequence(binding.sequence),
        bindingIds: [binding.id],
        actionIds: [binding.actionId],
        reservedChordId: reservedChord.id,
      });
    }
  }
  return conflicts;
}

function conflictSort(a: KeybindingConflict, b: KeybindingConflict): number {
  if (a.context < b.context) return -1;
  if (a.context > b.context) return 1;
  if (a.sequenceDisplay < b.sequenceDisplay) return -1;
  if (a.sequenceDisplay > b.sequenceDisplay) return 1;
  if (a.kind < b.kind) return -1;
  if (a.kind > b.kind) return 1;
  return 0;
}

export function findAllKeybindingConflicts(
  bindings: readonly WorkspaceKeybinding[],
  reservedChords: readonly WorkspaceReservedChord[] = [],
): KeybindingConflict[] {
  const conflicts = [
    ...findBindingConflicts(bindings),
    ...findReservedChordConflicts(bindings, reservedChords),
  ];
  return conflicts.sort(conflictSort);
}

export function findConflictsForBinding(
  candidate: WorkspaceKeybinding,
  bindings: readonly WorkspaceKeybinding[],
  reservedChords: readonly WorkspaceReservedChord[] = [],
): KeybindingConflict[] {
  const withCandidate = [...bindings, candidate];
  const allConflicts = findAllKeybindingConflicts(withCandidate, reservedChords);
  return allConflicts.filter((conflict) => {
    if (conflict.bindingIds.includes(candidate.id)) return true;
    return (
      conflict.context === candidate.context &&
      areKeySequencesEqual(conflict.sequence, candidate.sequence)
    );
  });
}
