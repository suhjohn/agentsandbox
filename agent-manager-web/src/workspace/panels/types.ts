import type React from "react";
import type { PanelTypeId } from "../types";

export type PanelOpenPlacement = "self" | "left" | "right" | "top" | "bottom";

export interface PanelRuntime {
  readonly now: () => number;
  readonly replaceSelf: (panelType: PanelTypeId, config?: unknown) => void;
  readonly openPanel: (
    panelType: PanelTypeId,
    config?: unknown,
    options?: { readonly placement?: PanelOpenPlacement; readonly forceNew?: boolean },
  ) => void;
}

export interface PanelProps<TConfig> {
  readonly config: TConfig;
  readonly setConfig: (updater: (prev: TConfig) => TConfig) => void;
  readonly runtime: PanelRuntime;
}

export interface PanelSettingsProps<TConfig> {
  readonly config: TConfig;
  readonly setConfig: (updater: (prev: TConfig) => TConfig) => void;
}

export interface PanelHeaderProps<TConfig> extends PanelProps<TConfig> {
  readonly onPopoverOpenChange?: (open: boolean) => void;
}

export interface PanelDefinition<TConfig> {
  readonly type: PanelTypeId;
  readonly title: string;
  readonly configVersion: number;
  readonly defaultConfig: TConfig;
  readonly deserializeConfig: (raw: unknown, version: number | undefined) => TConfig;
  readonly getTitle?: (config: TConfig) => string;
  readonly bodyPadding?: "default" | "none";
  readonly getAutoFocusSelector?: (config: TConfig) => string | null;
  readonly Component: React.ComponentType<PanelProps<TConfig>>;
  readonly HeaderComponent?: React.ComponentType<PanelHeaderProps<TConfig>>;
  readonly ActionsComponent?: React.ComponentType<PanelHeaderProps<TConfig>>;
  readonly SettingsComponent?: React.ComponentType<PanelSettingsProps<TConfig>>;
}
