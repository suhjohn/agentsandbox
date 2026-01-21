export type SplitDirection = "row" | "col";
export type PaneDirection = "left" | "right" | "up" | "down";

export type LayoutNode = SplitNode | LeafNode;

export interface SplitNode {
  readonly kind: "split";
  readonly id: string;
  readonly dir: SplitDirection;
  /**
   * Ratio of the first child in the range (0, 1).
   * `0.5` means both children share equal space.
   */
  readonly ratio: number;
  readonly a: LayoutNode;
  readonly b: LayoutNode;
}

export interface LeafNode {
  readonly kind: "leaf";
  readonly id: string;
  readonly panelInstanceId: string;
}

export type PanelTypeId = string;

export interface PanelInstance {
  readonly id: string;
  readonly type: PanelTypeId;
  readonly configVersion: number;
  readonly config: unknown;
}

export interface WindowState {
  readonly id: string;
  readonly name: string;
  readonly root: LayoutNode;
  readonly panelsById: Readonly<Record<string, PanelInstance>>;
  readonly focusedLeafId: string | null;
}

export interface WindowPreset {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly window: Omit<WindowState, "id" | "name"> & {
    readonly name: string;
  };
}

export interface WorkspaceStateV3 {
  readonly version: 3;
  readonly activeWindowId: string;
  readonly lastActiveWindowId: string | null;
  readonly windowsById: Readonly<Record<string, WindowState>>;
  readonly presetsById: Readonly<Record<string, WindowPreset>>;
}

export type WorkspaceState = WorkspaceStateV3;
