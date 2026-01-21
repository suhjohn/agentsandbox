import type { PanelDefinition } from "./types";

export interface EmptyPanelConfig {}

function deserializeEmptyConfig(): EmptyPanelConfig {
  return {};
}

function EmptyPanel() {
  return (
    <div className="h-full w-full grid place-items-center text-sm text-text-tertiary">
      Empty panel.
    </div>
  );
}

export const emptyPanelDefinition: PanelDefinition<EmptyPanelConfig> = {
  type: "empty",
  title: "Empty",
  configVersion: 1,
  defaultConfig: {},
  deserializeConfig: () => deserializeEmptyConfig(),
  Component: EmptyPanel,
};
