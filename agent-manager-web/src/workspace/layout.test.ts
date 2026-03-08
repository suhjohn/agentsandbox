import { describe, expect, it } from "bun:test";
import {
  areSplitRatiosEqualized,
  closeLeaf,
  equalizeSplitRatios,
  findAdjacentLeafId,
  findAdjacentLeafIdByPlacement,
  getPathToLeaf,
  hasUniformSplitDirection,
  listLeafIds,
  listPanelInstanceIds,
  moveLeaf,
  rebuildLayoutInDirection,
  resizeLeafByDirection,
  rotateLeafPanels,
  swapLeafNodes,
  updateSplitRatio,
} from "./layout";
import type { LayoutNode } from "./types";

describe("workspace/layout", () => {
  it("does not close the last leaf", () => {
    const root: LayoutNode = {
      kind: "leaf",
      id: "l1",
      panelInstanceId: "p1",
    };
    const result = closeLeaf(root, "l1");
    expect(result.root).toEqual(root);
    expect(result.removedLeaf).toBeNull();
  });

  it("closes a leaf and promotes sibling", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "s1",
      dir: "row",
      ratio: 0.5,
      a: {
        kind: "leaf",
        id: "l1",
        panelInstanceId: "p1",
      },
      b: {
        kind: "leaf",
        id: "l2",
        panelInstanceId: "p2",
      },
    };
    const result = closeLeaf(root, "l1");
    expect(result.removedLeaf?.id).toBe("l1");
    expect(result.root).toEqual({
      kind: "leaf",
      id: "l2",
      panelInstanceId: "p2",
    });
  });

  it("updates split ratio immutably", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "s1",
      dir: "row",
      ratio: 0.5,
      a: {
        kind: "leaf",
        id: "l1",
        panelInstanceId: "p1",
      },
      b: {
        kind: "leaf",
        id: "l2",
        panelInstanceId: "p2",
      },
    };
    const next = updateSplitRatio(root, "s1", 0.8);
    expect(next).not.toBe(root);
    expect((next as { readonly ratio?: number }).ratio).toBeCloseTo(0.8);
    expect(listLeafIds(next)).toEqual(["l1", "l2"]);
    expect(listPanelInstanceIds(next)).toEqual(["p1", "p2"]);
  });

  it("finds the adjacent leaf to the right in a row split", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "s1",
      dir: "row",
      ratio: 0.5,
      a: {
        kind: "leaf",
        id: "l1",
        panelInstanceId: "p1",
      },
      b: {
        kind: "leaf",
        id: "l2",
        panelInstanceId: "p2",
      },
    };
    expect(findAdjacentLeafId(root, "l1", "row")).toBe("l2");
    expect(findAdjacentLeafId(root, "l2", "row")).toBeNull();
  });

  it("finds the adjacent leaf below in a col split", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "s1",
      dir: "col",
      ratio: 0.5,
      a: {
        kind: "leaf",
        id: "l1",
        panelInstanceId: "p1",
      },
      b: {
        kind: "leaf",
        id: "l2",
        panelInstanceId: "p2",
      },
    };
    expect(findAdjacentLeafId(root, "l1", "col")).toBe("l2");
    expect(findAdjacentLeafId(root, "l2", "col")).toBeNull();
  });

  it("finds left and top adjacent leaves by placement", () => {
    const rowRoot: LayoutNode = {
      kind: "split",
      id: "sRow",
      dir: "row",
      ratio: 0.5,
      a: {
        kind: "leaf",
        id: "l1",
        panelInstanceId: "p1",
      },
      b: {
        kind: "leaf",
        id: "l2",
        panelInstanceId: "p2",
      },
    };
    expect(findAdjacentLeafIdByPlacement(rowRoot, "l2", "left")).toBe("l1");
    expect(findAdjacentLeafIdByPlacement(rowRoot, "l1", "left")).toBeNull();

    const colRoot: LayoutNode = {
      kind: "split",
      id: "sCol",
      dir: "col",
      ratio: 0.5,
      a: {
        kind: "leaf",
        id: "l1",
        panelInstanceId: "p1",
      },
      b: {
        kind: "leaf",
        id: "l2",
        panelInstanceId: "p2",
      },
    };
    expect(findAdjacentLeafIdByPlacement(colRoot, "l2", "top")).toBe("l1");
    expect(findAdjacentLeafIdByPlacement(colRoot, "l1", "top")).toBeNull();
  });

  it("finds the closest row-adjacent leaf from nested splits", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "sRow",
      dir: "row",
      ratio: 0.6,
      a: {
        kind: "split",
        id: "sCol",
        dir: "col",
        ratio: 0.5,
        a: {
          kind: "leaf",
          id: "l1",
          panelInstanceId: "p1",
        },
        b: {
          kind: "leaf",
          id: "l2",
          panelInstanceId: "p2",
        },
      },
      b: {
        kind: "split",
        id: "sCol2",
        dir: "col",
        ratio: 0.5,
        a: {
          kind: "leaf",
          id: "l3",
          panelInstanceId: "p3",
        },
        b: {
          kind: "leaf",
          id: "l4",
          panelInstanceId: "p4",
        },
      },
    };
    expect(findAdjacentLeafId(root, "l2", "row")).toBe("l3");
    expect(findAdjacentLeafId(root, "l1", "row")).toBe("l3");
    expect(findAdjacentLeafIdByPlacement(root, "l3", "left")).toBe("l2");
    expect(findAdjacentLeafIdByPlacement(root, "l4", "left")).toBe("l2");
  });

  it("returns the split path from a leaf to root", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "sRow",
      dir: "row",
      ratio: 0.5,
      a: {
        kind: "split",
        id: "sCol",
        dir: "col",
        ratio: 0.5,
        a: {
          kind: "leaf",
          id: "l1",
          panelInstanceId: "p1",
        },
        b: {
          kind: "leaf",
          id: "l2",
          panelInstanceId: "p2",
        },
      },
      b: {
        kind: "leaf",
        id: "l3",
        panelInstanceId: "p3",
      },
    };

    const path = getPathToLeaf(root, "l2");
    expect(path?.map((step) => `${step.node.id}:${step.side}`)).toEqual(["sCol:b", "sRow:a"]);
  });

  it("equalizes all split ratios without changing leaves", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "sRoot",
      dir: "row",
      ratio: 0.2,
      a: {
        kind: "leaf",
        id: "l1",
        panelInstanceId: "p1",
      },
      b: {
        kind: "split",
        id: "sNested",
        dir: "col",
        ratio: 0.8,
        a: {
          kind: "leaf",
          id: "l2",
          panelInstanceId: "p2",
        },
        b: {
          kind: "leaf",
          id: "l3",
          panelInstanceId: "p3",
        },
      },
    };

    const next = equalizeSplitRatios(root);
    expect(next).not.toBe(root);
    expect(areSplitRatiosEqualized(next)).toBe(true);
    if (next.kind !== "split") throw new Error("expected split root");
    expect(next.ratio).toBeCloseTo(1 / 3);
    if (next.b.kind !== "split") throw new Error("expected split nested b");
    expect(next.b.ratio).toBeCloseTo(0.5);
    expect(areSplitRatiosEqualized(next, 0.5)).toBe(false);
    expect(listLeafIds(next)).toEqual(["l1", "l2", "l3"]);
    expect(listPanelInstanceIds(next)).toEqual(["p1", "p2", "p3"]);
  });

  it("rebuilds layout in one direction while preserving leaf order", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "sRoot",
      dir: "col",
      ratio: 0.5,
      a: {
        kind: "split",
        id: "sLeft",
        dir: "row",
        ratio: 0.5,
        a: {
          kind: "leaf",
          id: "l1",
          panelInstanceId: "p1",
        },
        b: {
          kind: "leaf",
          id: "l2",
          panelInstanceId: "p2",
        },
      },
      b: {
        kind: "split",
        id: "sRight",
        dir: "col",
        ratio: 0.5,
        a: {
          kind: "leaf",
          id: "l3",
          panelInstanceId: "p3",
        },
        b: {
          kind: "leaf",
          id: "l4",
          panelInstanceId: "p4",
        },
      },
    };

    let splitIdCounter = 0;
    const next = rebuildLayoutInDirection(root, "row", () => `ns${splitIdCounter++}`);
    expect(hasUniformSplitDirection(next, "row")).toBe(true);
    expect(listLeafIds(next)).toEqual(["l1", "l2", "l3", "l4"]);
    expect(listPanelInstanceIds(next)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("swaps two leaves by id", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "sRoot",
      dir: "row",
      ratio: 0.5,
      a: {
        kind: "leaf",
        id: "l1",
        panelInstanceId: "p1",
      },
      b: {
        kind: "split",
        id: "sRight",
        dir: "col",
        ratio: 0.5,
        a: {
          kind: "leaf",
          id: "l2",
          panelInstanceId: "p2",
        },
        b: {
          kind: "leaf",
          id: "l3",
          panelInstanceId: "p3",
        },
      },
    };

    const next = swapLeafNodes(root, "l1", "l3");
    expect(listLeafIds(next)).toEqual(["l3", "l2", "l1"]);
    expect(listPanelInstanceIds(next)).toEqual(["p3", "p2", "p1"]);
  });

  it("moves a pane with center placement by swapping leaves", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "sRoot",
      dir: "row",
      ratio: 0.5,
      a: {
        kind: "leaf",
        id: "l1",
        panelInstanceId: "p1",
      },
      b: {
        kind: "leaf",
        id: "l2",
        panelInstanceId: "p2",
      },
    };

    const next = moveLeaf(root, "l1", "l2", "center", () => "unused-split-id");
    expect(listLeafIds(next.root)).toEqual(["l2", "l1"]);
    expect(listPanelInstanceIds(next.root)).toEqual(["p2", "p1"]);
    expect(next.focusedLeafId).toBe("l1");
  });

  it("rotates panel instances across leaves", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "sRoot",
      dir: "row",
      ratio: 0.5,
      a: {
        kind: "leaf",
        id: "l1",
        panelInstanceId: "p1",
      },
      b: {
        kind: "split",
        id: "sRight",
        dir: "row",
        ratio: 0.5,
        a: {
          kind: "leaf",
          id: "l2",
          panelInstanceId: "p2",
        },
        b: {
          kind: "leaf",
          id: "l3",
          panelInstanceId: "p3",
        },
      },
    };

    const next = rotateLeafPanels(root, "next");
    expect(listLeafIds(next)).toEqual(["l1", "l2", "l3"]);
    expect(listPanelInstanceIds(next)).toEqual(["p3", "p1", "p2"]);
  });

  it("resizes a leaf toward a direction", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "sRow",
      dir: "row",
      ratio: 0.5,
      a: {
        kind: "leaf",
        id: "l1",
        panelInstanceId: "p1",
      },
      b: {
        kind: "split",
        id: "sCol",
        dir: "col",
        ratio: 0.4,
        a: {
          kind: "leaf",
          id: "l2",
          panelInstanceId: "p2",
        },
        b: {
          kind: "leaf",
          id: "l3",
          panelInstanceId: "p3",
        },
      },
    };

    const resizedUp = resizeLeafByDirection(root, "l3", "up", 0.1) as {
      readonly b: { readonly ratio: number };
    };
    expect(resizedUp.b.ratio).toBeCloseTo(0.3);

    const noLeftResize = resizeLeafByDirection(root, "l1", "left", 0.1);
    expect(noLeftResize).toBe(root);
  });
});
