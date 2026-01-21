export const VISIBILITIES = ["public", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const AGENT_STATUSES = [
  "active",
  "snapshotting",
  "completed",
  "archived",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const MESSAGE_ROLES = ["user", "assistant", "tool"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];
