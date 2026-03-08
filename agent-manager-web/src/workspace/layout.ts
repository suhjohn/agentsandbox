import type {
  LayoutNode,
  LeafNode,
  PaneDirection,
  SplitDirection,
  SplitNode,
} from "./types";

export function clampRatio(value: number, min = 0.1, max = 0.9): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(max, Math.max(min, value));
}

function getTopLeftLeafId(node: LayoutNode): string {
  if (node.kind === "leaf") return node.id;
  return getTopLeftLeafId(node.a);
}

function getBottomRightLeafId(node: LayoutNode): string {
  if (node.kind === "leaf") return node.id;
  return getBottomRightLeafId(node.b);
}

export function findLeafNode(
  root: LayoutNode,
  leafId: string,
): LeafNode | null {
  if (root.kind === "leaf") return root.id === leafId ? root : null;
  return findLeafNode(root.a, leafId) ?? findLeafNode(root.b, leafId);
}

export function findAdjacentLeafId(
  root: LayoutNode,
  leafId: string,
  dir: SplitDirection,
): string | null {
  return findAdjacentLeafIdByPlacement(
    root,
    leafId,
    dir === "row" ? "right" : "bottom",
  );
}

export type LayoutPathStep = { readonly node: SplitNode; readonly side: "a" | "b" };

export function getPathToLeaf(
  root: LayoutNode,
  leafId: string,
): readonly LayoutPathStep[] | null {
  const steps: LayoutPathStep[] = [];

  function walk(node: LayoutNode): boolean {
    if (node.kind === "leaf") return node.id === leafId;
    if (walk(node.a)) {
      steps.push({ node, side: "a" });
      return true;
    }
    if (walk(node.b)) {
      steps.push({ node, side: "b" });
      return true;
    }
    return false;
  }

  if (!walk(root)) return null;
  return steps;
}

export function findAdjacentLeafIdByPlacement(
  root: LayoutNode,
  leafId: string,
  placement: "left" | "right" | "top" | "bottom",
): string | null {
  const steps = getPathToLeaf(root, leafId);
  if (!steps) return null;

  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i]!;
    if (placement === "right" && step.node.dir === "row" && step.side === "a") {
      return getTopLeftLeafId(step.node.b);
    }
    if (placement === "left" && step.node.dir === "row" && step.side === "b") {
      return getBottomRightLeafId(step.node.a);
    }
    if (placement === "bottom" && step.node.dir === "col" && step.side === "a") {
      return getTopLeftLeafId(step.node.b);
    }
    if (placement === "top" && step.node.dir === "col" && step.side === "b") {
      return getBottomRightLeafId(step.node.a);
    }
  }
  return null;
}

function listLeafNodes(root: LayoutNode, out: LeafNode[] = []): LeafNode[] {
  if (root.kind === "leaf") {
    out.push(root);
    return out;
  }
  listLeafNodes(root.a, out);
  listLeafNodes(root.b, out);
  return out;
}

export function listLeafIds(root: LayoutNode, out: string[] = []): string[] {
  if (root.kind === "leaf") {
    out.push(root.id);
    return out;
  }
  listLeafIds(root.a, out);
  listLeafIds(root.b, out);
  return out;
}

function equalizedRatioByLeafCounts(leftLeafCount: number, rightLeafCount: number): number {
  const total = leftLeafCount + rightLeafCount;
  if (total <= 0) return 0.5;
  return clampRatio(leftLeafCount / total);
}

export function equalizeSplitRatios(root: LayoutNode): LayoutNode {
  function run(node: LayoutNode): { readonly node: LayoutNode; readonly leafCount: number } {
    if (node.kind === "leaf") {
      return { node, leafCount: 1 };
    }

    const left = run(node.a);
    const right = run(node.b);
    const ratio = equalizedRatioByLeafCounts(left.leafCount, right.leafCount);
    const changed =
      left.node !== node.a ||
      right.node !== node.b ||
      Math.abs(node.ratio - ratio) > 1e-6;
    return {
      node: changed
        ? {
            ...node,
            ratio,
            a: left.node,
            b: right.node,
          }
        : node,
      leafCount: left.leafCount + right.leafCount,
    };
  }

  return run(root).node;
}

export function hasUniformSplitDirection(
  root: LayoutNode,
  dir: SplitDirection,
): boolean {
  if (root.kind === "leaf") return true;
  if (root.dir !== dir) return false;
  return hasUniformSplitDirection(root.a, dir) && hasUniformSplitDirection(root.b, dir);
}

export function areSplitRatiosEqualized(
  root: LayoutNode,
  targetRatio?: number,
  epsilon = 1e-6,
): boolean {
  function run(node: LayoutNode): { readonly equalized: boolean; readonly leafCount: number } {
    if (node.kind === "leaf") {
      return { equalized: true, leafCount: 1 };
    }

    const left = run(node.a);
    const right = run(node.b);
    const expectedRatio =
      typeof targetRatio === "number"
        ? clampRatio(targetRatio)
        : equalizedRatioByLeafCounts(left.leafCount, right.leafCount);
    const ratioEqualized = Math.abs(node.ratio - expectedRatio) <= epsilon;
    return {
      equalized: left.equalized && right.equalized && ratioEqualized,
      leafCount: left.leafCount + right.leafCount,
    };
  }

  return run(root).equalized;
}

export function rebuildLayoutInDirection(
  root: LayoutNode,
  dir: SplitDirection,
  createSplitId: () => string,
): LayoutNode {
  const leaves = listLeafNodes(root);
  if (leaves.length <= 1) return root;

  function build(start: number, end: number): LayoutNode {
    const count = end - start;
    if (count === 1) return leaves[start]!;

    const leftCount = Math.floor(count / 2);
    const splitIndex = start + leftCount;
    const a = build(start, splitIndex);
    const b = build(splitIndex, end);
    const ratio = clampRatio(leftCount / count);

    return {
      kind: "split",
      id: createSplitId(),
      dir,
      ratio,
      a,
      b,
    };
  }

  return build(0, leaves.length);
}

export function swapLeafNodes(
  root: LayoutNode,
  firstLeafId: string,
  secondLeafId: string,
): LayoutNode {
  if (firstLeafId === secondLeafId) return root;

  const firstLeaf = findLeafNode(root, firstLeafId);
  const secondLeaf = findLeafNode(root, secondLeafId);
  if (!firstLeaf || !secondLeaf) return root;
  const nextFirstLeaf = firstLeaf;
  const nextSecondLeaf = secondLeaf;

  function swap(node: LayoutNode): LayoutNode {
    if (node.kind === "leaf") {
      if (node.id === firstLeafId) return nextSecondLeaf;
      if (node.id === secondLeafId) return nextFirstLeaf;
      return node;
    }

    const a = swap(node.a);
    const b = swap(node.b);
    if (a === node.a && b === node.b) return node;
    return { ...node, a, b };
  }

  return swap(root);
}

export function rotateLeafPanels(
  root: LayoutNode,
  direction: "next" | "prev" = "next",
): LayoutNode {
  const leaves = listLeafNodes(root);
  if (leaves.length <= 1) return root;

  const panelByLeafId: Record<string, string> = {};
  const count = leaves.length;

  for (let i = 0; i < count; i += 1) {
    const targetLeaf = leaves[i]!;
    const sourceIndex =
      direction === "next"
        ? (i - 1 + count) % count
        : (i + 1) % count;
    panelByLeafId[targetLeaf.id] = leaves[sourceIndex]!.panelInstanceId;
  }

  function rotate(node: LayoutNode): LayoutNode {
    if (node.kind === "leaf") {
      const nextPanelInstanceId = panelByLeafId[node.id];
      if (!nextPanelInstanceId || nextPanelInstanceId === node.panelInstanceId) {
        return node;
      }
      return { ...node, panelInstanceId: nextPanelInstanceId };
    }

    const a = rotate(node.a);
    const b = rotate(node.b);
    if (a === node.a && b === node.b) return node;
    return { ...node, a, b };
  }

  return rotate(root);
}

export function resizeLeafByDirection(
  root: LayoutNode,
  leafId: string,
  direction: PaneDirection,
  delta: number,
): LayoutNode {
  if (!Number.isFinite(delta) || delta === 0) return root;
  const steps = getPathToLeaf(root, leafId);
  if (!steps || steps.length === 0) return root;

  const targetDir = direction === "left" || direction === "right" ? "row" : "col";
  const targetSide: "a" | "b" =
    direction === "left" || direction === "up" ? "b" : "a";
  const targetStep =
    steps.find((step) => step.node.dir === targetDir && step.side === targetSide) ??
    null;
  if (!targetStep) return root;

  const currentRatio = clampRatio(targetStep.node.ratio);
  const focusedSize = targetStep.side === "a" ? currentRatio : 1 - currentRatio;
  const nextFocusedSize = clampRatio(focusedSize + delta);
  const nextRatio = targetStep.side === "a" ? nextFocusedSize : 1 - nextFocusedSize;
  const clampedNextRatio = clampRatio(nextRatio);

  if (Math.abs(clampedNextRatio - currentRatio) <= 1e-6) return root;
  return updateSplitRatio(root, targetStep.node.id, clampedNextRatio);
}

export function moveLeaf(
  root: LayoutNode,
  fromLeafId: string,
  toLeafId: string,
  placement: "left" | "right" | "top" | "bottom" | "center",
  createSplitId: () => string,
): { readonly root: LayoutNode; readonly focusedLeafId: string | null } {
  if (fromLeafId === toLeafId) {
    return { root, focusedLeafId: null };
  }

  if (placement === "center") {
    const nextRoot = swapLeafNodes(root, fromLeafId, toLeafId);
    return {
      root: nextRoot,
      focusedLeafId: nextRoot === root ? null : fromLeafId,
    };
  }

  const closeResult = closeLeaf(root, fromLeafId);
  if (!closeResult.removedLeaf) {
    return { root, focusedLeafId: null };
  }
  const movedLeaf = closeResult.removedLeaf;

  const targetLeaf = findLeafNode(closeResult.root, toLeafId);
  if (!targetLeaf) {
    return { root, focusedLeafId: null };
  }

  const dir: SplitDirection =
    placement === "left" || placement === "right" ? "row" : "col";
  const insertBefore = placement === "left" || placement === "top";
  const split: SplitNode = {
    kind: "split",
    id: createSplitId(),
    dir,
    ratio: 0.5,
    a: insertBefore ? movedLeaf : targetLeaf,
    b: insertBefore ? targetLeaf : movedLeaf,
  };

  const nextRoot = replaceLeaf(closeResult.root, toLeafId, split);
  return {
    root: nextRoot,
    focusedLeafId: nextRoot === root ? null : movedLeaf.id,
  };
}

export function replaceLeaf(
  root: LayoutNode,
  leafId: string,
  next: LayoutNode,
): LayoutNode {
  if (root.kind === "leaf") return root.id === leafId ? next : root;
  const a = replaceLeaf(root.a, leafId, next);
  const b = replaceLeaf(root.b, leafId, next);
  if (a === root.a && b === root.b) return root;
  return { ...root, a, b };
}

export function updateSplitRatio(
  root: LayoutNode,
  splitId: string,
  ratio: number,
): LayoutNode {
  if (root.kind === "leaf") return root;
  if (root.id === splitId) {
    return { ...root, ratio: clampRatio(ratio) };
  }
  const a = updateSplitRatio(root.a, splitId, ratio);
  const b = updateSplitRatio(root.b, splitId, ratio);
  if (a === root.a && b === root.b) return root;
  return { ...root, a, b };
}

export function closeLeaf(
  root: LayoutNode,
  leafId: string,
): { readonly root: LayoutNode; readonly removedLeaf: LeafNode | null } {
  function run(
    node: LayoutNode,
    isRoot: boolean,
  ): { readonly root: LayoutNode; readonly removedLeaf: LeafNode | null } {
    if (node.kind === "leaf") {
      if (node.id !== leafId) return { root: node, removedLeaf: null };
      if (isRoot) return { root: node, removedLeaf: null };
      return { root: node, removedLeaf: node };
    }

    const left = run(node.a, false);
    if (left.removedLeaf) {
      if (node.a.kind === "leaf" && node.a.id === leafId) {
        return { root: node.b, removedLeaf: left.removedLeaf };
      }
      return {
        root: { ...node, a: left.root },
        removedLeaf: left.removedLeaf,
      };
    }

    const right = run(node.b, false);
    if (right.removedLeaf) {
      if (node.b.kind === "leaf" && node.b.id === leafId) {
        return { root: node.a, removedLeaf: right.removedLeaf };
      }
      return {
        root: { ...node, b: right.root },
        removedLeaf: right.removedLeaf,
      };
    }

    return { root: node, removedLeaf: null };
  }

  return run(root, true);
}

export function isSplitDirection(value: unknown): value is SplitDirection {
  return value === "row" || value === "col";
}

export function isLayoutNode(value: unknown): value is LayoutNode {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "leaf") {
    return typeof v.id === "string" && typeof v.panelInstanceId === "string";
  }
  if (v.kind === "split") {
    return (
      typeof v.id === "string" &&
      isSplitDirection(v.dir) &&
      typeof v.ratio === "number" &&
      isLayoutNode(v.a) &&
      isLayoutNode(v.b)
    );
  }
  return false;
}

export function walkNodes(
  root: LayoutNode,
  fn: (node: LayoutNode) => void,
): void {
  fn(root);
  if (root.kind === "split") {
    walkNodes(root.a, fn);
    walkNodes(root.b, fn);
  }
}

export function listPanelInstanceIds(root: LayoutNode): string[] {
  const ids: string[] = [];
  walkNodes(root, (node) => {
    if (node.kind === "leaf") ids.push(node.panelInstanceId);
  });
  return ids;
}

export function listSplitIds(root: LayoutNode): string[] {
  const ids: string[] = [];
  walkNodes(root, (node) => {
    if (node.kind === "split") ids.push(node.id);
  });
  return ids;
}

export function splitLeaf(
  root: LayoutNode,
  leafId: string,
  _dir: SplitDirection,
  splitNode: SplitNode,
): LayoutNode {
  return replaceLeaf(root, leafId, splitNode);
}
