import { OpencodeMessages } from "@/components/messages/opencode-message";
import { ALL_MODELS } from "../catalog";
import type { HarnessDefinition } from "../types";

const opencodeHarness: HarnessDefinition = {
  id: "opencode",
  label: "OpenCode",
  getModels: () =>
    ALL_MODELS.map((model) => ({
      ...model,
      id: `${model.provider}/${model.id}`,
    })),
  getThinkingLevels: () => ["minimal", "low", "medium", "high", "max"],
  formatSelectedModel: (model) => ({
    name: model.includes("/")
      ? `${model.split("/").slice(1).join("/")} (current)`
      : `${model} (provider unspecified)`,
    provider: model.includes("/") ? "current" : "saved",
  }),
  MessageView: OpencodeMessages,
};

export default opencodeHarness;
