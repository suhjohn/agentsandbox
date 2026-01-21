import { z } from "zod";
import type {
  SemanticActionDefinition,
  SessionsSidePanelGroupBy,
  SessionsSidePanelSnapshot,
  UiContextSnapshot,
  UiExecutionContext,
} from "../types";

const panelTypeSchema = z.enum([
  "coordinator",
  "agent_list",
  "agent_create",
  "agent_detail",
  "empty",
]);
const placementSchema = z.enum(["self", "left", "right", "top", "bottom"]);
const panePlacementSchema = z.enum(["left", "right", "top", "bottom"]);

const workspacePanelOpenSchema = z.object({
  panelType: panelTypeSchema,
  placement: placementSchema,
  config: z.record(z.string(), z.unknown()).optional(),
});

function extractNonEmptyAgentId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as { agentId?: unknown }).agentId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const workspacePanelOpenAction: SemanticActionDefinition<
  z.infer<typeof workspacePanelOpenSchema>,
  {
    readonly opened: true;
    readonly panelType:
      | "coordinator"
      | "agent_list"
      | "agent_create"
      | "agent_detail"
      | "empty";
    readonly placement: "self" | "left" | "right" | "top" | "bottom";
    readonly panelInstanceId: string;
    readonly leafId: string;
  }
> = {
  id: "workspace.panel.open",
  version: 1,
  description:
    "Open a panel from the focused pane using workspace panel/open semantics.",
  paramsSchema: workspacePanelOpenSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["panelType", "placement"],
    properties: {
      panelType: {
        type: "string",
        enum: ["coordinator", "agent_list", "agent_create", "agent_detail", "empty"],
      },
      placement: {
        type: "string",
        enum: ["self", "left", "right", "top", "bottom"],
      },
      config: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
  canRun: (ctx) => {
    if (!ctx.isAuthenticated) return { ok: false, reason: "NOT_AUTHENTICATED" };
    if (!ctx.workspaceReady || ctx.workspaceFocusedLeafId === null) {
      return { ok: false, reason: "UI_NOT_READY" };
    }
    return { ok: true };
  },
  run: async (ctx, params) => {
    if (params.panelType === "agent_detail") {
      const agentId = extractNonEmptyAgentId(params.config);
      if (!agentId) {
        throw new Error(
          "agent_detail requires config.agentId (non-empty string)",
        );
      }
    }

    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    return await controller.openPanel({
      panelType: params.panelType,
      placement: params.placement,
      config: params.config,
    });
  },
};

export const workspacePanelListAction: SemanticActionDefinition<
  Record<string, never>,
  {
    readonly panels: ReadonlyArray<{
      readonly panelInstanceId: string;
      readonly panelType:
        | "coordinator"
        | "agent_list"
        | "agent_create"
        | "agent_detail"
        | "empty";
      readonly leafId: string;
      readonly focused: boolean;
    }>;
  }
> = {
  id: "workspace.panel.list",
  version: 1,
  description: "List visible panels in the active workspace window with stable instance IDs.",
  paramsSchema: z.object({}),
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  canRun: (ctx) => {
    if (!ctx.isAuthenticated) return { ok: false, reason: "NOT_AUTHENTICATED" };
    if (!ctx.workspaceReady) return { ok: false, reason: "UI_NOT_READY" };
    return { ok: true };
  },
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    return { panels: controller.listPanels() };
  },
};

const workspacePaneFocusSchema = z
  .object({
    target: z.enum(["leaf", "panel_instance"]),
    leafId: z.string().optional(),
    panelInstanceId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.target === "leaf") {
      if (!value.leafId || value.leafId.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "leafId is required for target=leaf",
        });
      }
      if (typeof value.panelInstanceId !== "undefined") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "panelInstanceId is not allowed for target=leaf",
        });
      }
      return;
    }

    if (!value.panelInstanceId || value.panelInstanceId.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "panelInstanceId is required for target=panel_instance",
      });
    }
    if (typeof value.leafId !== "undefined") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "leafId is not allowed for target=panel_instance",
      });
    }
  });

export const workspacePaneFocusAction: SemanticActionDefinition<
  z.infer<typeof workspacePaneFocusSchema>,
  {
    readonly focused: true;
    readonly leafId: string;
    readonly panelInstanceId: string;
  }
> = {
  id: "workspace.pane.focus",
  version: 1,
  description: "Focus a specific workspace pane by leaf or panel instance ID.",
  paramsSchema: workspacePaneFocusSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["target"],
    properties: {
      target: {
        type: "string",
        enum: ["leaf", "panel_instance"],
      },
      leafId: {
        type: "string",
      },
      panelInstanceId: {
        type: "string",
      },
    },
  },
  canRun: (ctx) => {
    if (!ctx.isAuthenticated) return { ok: false, reason: "NOT_AUTHENTICATED" };
    if (!ctx.workspaceReady) return { ok: false, reason: "UI_NOT_READY" };
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    return await controller.focusPane({
      target: params.target,
      leafId: params.leafId,
      panelInstanceId: params.panelInstanceId,
    });
  },
};

const workspacePaneMoveSchema = z
  .object({
    fromLeafId: z.string().optional(),
    fromPanelInstanceId: z.string().optional(),
    toLeafId: z.string().optional(),
    toPanelInstanceId: z.string().optional(),
    placement: panePlacementSchema,
  })
  .superRefine((value, ctx) => {
    const fromLeafProvided =
      typeof value.fromLeafId === "string" && value.fromLeafId.trim().length > 0;
    const fromPanelProvided =
      typeof value.fromPanelInstanceId === "string" &&
      value.fromPanelInstanceId.trim().length > 0;
    if (fromLeafProvided === fromPanelProvided) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide exactly one of fromLeafId or fromPanelInstanceId",
      });
    }

    const toLeafProvided =
      typeof value.toLeafId === "string" && value.toLeafId.trim().length > 0;
    const toPanelProvided =
      typeof value.toPanelInstanceId === "string" &&
      value.toPanelInstanceId.trim().length > 0;
    if (toLeafProvided === toPanelProvided) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of toLeafId or toPanelInstanceId",
      });
    }
  });

export const workspacePaneMoveAction: SemanticActionDefinition<
  z.infer<typeof workspacePaneMoveSchema>,
  {
    readonly moved: true;
    readonly fromLeafId: string;
    readonly toLeafId: string;
    readonly placement: "left" | "right" | "top" | "bottom";
    readonly focusedLeafId: string | null;
  }
> = {
  id: "workspace.pane.move",
  version: 1,
  description:
    "Move an existing workspace pane relative to another pane using deterministic IDs.",
  paramsSchema: workspacePaneMoveSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["placement"],
    properties: {
      fromLeafId: { type: "string" },
      fromPanelInstanceId: { type: "string" },
      toLeafId: { type: "string" },
      toPanelInstanceId: { type: "string" },
      placement: {
        type: "string",
        enum: ["left", "right", "top", "bottom"],
      },
    },
  },
  canRun: (ctx) => {
    if (!ctx.isAuthenticated) return { ok: false, reason: "NOT_AUTHENTICATED" };
    if (!ctx.workspaceReady) return { ok: false, reason: "UI_NOT_READY" };
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    return await controller.movePane({
      fromLeafId: params.fromLeafId,
      fromPanelInstanceId: params.fromPanelInstanceId,
      toLeafId: params.toLeafId,
      toPanelInstanceId: params.toPanelInstanceId,
      placement: params.placement,
    });
  },
};

const workspacePaneCloseSchema = z
  .object({
    target: z.enum(["focused", "leaf", "panel_instance"]),
    leafId: z.string().optional(),
    panelInstanceId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.target === "focused") {
      if (typeof value.leafId !== "undefined") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "leafId is not allowed for target=focused",
        });
      }
      if (typeof value.panelInstanceId !== "undefined") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "panelInstanceId is not allowed for target=focused",
        });
      }
      return;
    }

    if (value.target === "leaf") {
      if (!value.leafId || value.leafId.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "leafId is required for target=leaf",
        });
      }
      if (typeof value.panelInstanceId !== "undefined") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "panelInstanceId is not allowed for target=leaf",
        });
      }
      return;
    }

    if (!value.panelInstanceId || value.panelInstanceId.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "panelInstanceId is required for target=panel_instance",
      });
    }
    if (typeof value.leafId !== "undefined") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "leafId is not allowed for target=panel_instance",
      });
    }
  });

export const workspacePaneCloseAction: SemanticActionDefinition<
  z.infer<typeof workspacePaneCloseSchema>,
  {
    readonly closed: true;
    readonly closedLeafId: string;
    readonly closedPanelInstanceId: string;
    readonly focusedLeafId: string | null;
  }
> = {
  id: "workspace.pane.close",
  version: 1,
  description: "Close one workspace pane by focused, leaf, or panel instance target.",
  paramsSchema: workspacePaneCloseSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["target"],
    properties: {
      target: {
        type: "string",
        enum: ["focused", "leaf", "panel_instance"],
      },
      leafId: {
        type: "string",
      },
      panelInstanceId: {
        type: "string",
      },
    },
  },
  canRun: (ctx) => {
    if (!ctx.isAuthenticated) return { ok: false, reason: "NOT_AUTHENTICATED" };
    if (!ctx.workspaceReady) return { ok: false, reason: "UI_NOT_READY" };
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    return await controller.closePane({
      target: params.target,
      leafId: params.leafId,
      panelInstanceId: params.panelInstanceId,
    });
  },
};

const workspacePanelSetConfigSchema = z.object({
  target: z.enum(["focused", "first_of_type", "panel_instance"]),
  panelType: panelTypeSchema.optional(),
  panelInstanceId: z.string().optional(),
  patch: z.record(z.string(), z.unknown()),
});

export const workspacePanelSetConfigAction: SemanticActionDefinition<
  z.infer<typeof workspacePanelSetConfigSchema>,
  {
    readonly updated: true;
    readonly panelType:
      | "coordinator"
      | "agent_list"
      | "agent_create"
      | "agent_detail"
      | "empty";
    readonly panelInstanceId: string;
  }
> = {
  id: "workspace.panel.set_config",
  version: 1,
  description:
    "Patch panel config for the focused panel or first panel of a given type.",
  paramsSchema: workspacePanelSetConfigSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["target", "patch"],
    properties: {
      target: {
        type: "string",
        enum: ["focused", "first_of_type", "panel_instance"],
      },
      panelType: {
        type: "string",
        enum: ["coordinator", "agent_list", "agent_create", "agent_detail", "empty"],
      },
      panelInstanceId: {
        type: "string",
      },
      patch: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
  canRun: (ctx) => {
    if (!ctx.isAuthenticated) return { ok: false, reason: "NOT_AUTHENTICATED" };
    if (!ctx.workspaceReady) return { ok: false, reason: "UI_NOT_READY" };
    return { ok: true };
  },
  run: async (ctx, params) => {
    if (
      params.target === "focused" &&
      ctx.snapshot.workspaceFocusedLeafId === null
    ) {
      throw new Error("No focused workspace panel");
    }
    if (params.target === "first_of_type") {
      if (!params.panelType) {
        throw new Error("panelType is required for target=first_of_type");
      }
      if (!ctx.snapshot.workspacePanelTypes.includes(params.panelType)) {
        throw new Error(`No panel of type ${params.panelType} is open`);
      }
    }
    if (params.target === "panel_instance") {
      if (!params.panelInstanceId || params.panelInstanceId.trim().length === 0) {
        throw new Error("panelInstanceId is required for target=panel_instance");
      }
    }

    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    return await controller.setPanelConfig({
      target: params.target,
      panelType: params.panelType,
      panelInstanceId: params.panelInstanceId,
      patch: params.patch,
    });
  },
};

const workspacePanelResizeSchema = z.object({
  dimension: z.enum(["width", "height"]),
  mode: z.enum(["set_fraction", "delta_fraction"]),
  value: z.number().finite(),
});

export const workspacePanelResizeAction: SemanticActionDefinition<
  z.infer<typeof workspacePanelResizeSchema>,
  {
    readonly resized: true;
    readonly splitId: string;
    readonly ratio: number;
    readonly dimension: "width" | "height";
  }
> = {
  id: "workspace.panel.resize",
  version: 1,
  description:
    "Resize the focused panel width/height by setting or adjusting its nearest split fraction.",
  paramsSchema: workspacePanelResizeSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["dimension", "mode", "value"],
    properties: {
      dimension: {
        type: "string",
        enum: ["width", "height"],
      },
      mode: {
        type: "string",
        enum: ["set_fraction", "delta_fraction"],
      },
      value: {
        type: "number",
      },
    },
  },
  canRun: (ctx) => {
    if (!ctx.isAuthenticated) return { ok: false, reason: "NOT_AUTHENTICATED" };
    if (!ctx.workspaceReady || ctx.workspaceFocusedLeafId === null) {
      return { ok: false, reason: "UI_NOT_READY" };
    }
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    return await controller.resizeFocusedPanel({
      dimension: params.dimension,
      mode: params.mode,
      value: params.value,
    });
  },
};

const sessionsSidePanelGroupBySchema = z.enum([
  "none",
  "imageId",
  "createdBy",
  "status",
]);
const sessionsSidePanelTimeRangeSchema = z.enum([
  "all",
  "24h",
  "7d",
  "30d",
  "90d",
]);
const sessionsSidePanelArchivedSchema = z.enum(["all", "true", "false"]);

const workspaceSessionsPanelSetFiltersSchema = z
  .object({
    imageId: z.string().optional(),
    agentId: z.string().optional(),
    createdBy: z.string().optional(),
    archived: sessionsSidePanelArchivedSchema.optional(),
    status: z.string().optional(),
    updatedAtRange: sessionsSidePanelTimeRangeSchema.optional(),
    createdAtRange: sessionsSidePanelTimeRangeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasAnyField = Object.values(value).some((v) => typeof v !== "undefined");
    if (!hasAnyField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one filter field.",
      });
    }
  });

const workspaceSessionsPanelSetGroupBySchema = z.object({
  groupBy: sessionsSidePanelGroupBySchema,
});

function canRunSessionsSidePanelAction(ctx: UiContextSnapshot) {
  if (!ctx.isAuthenticated) return { ok: false as const, reason: "NOT_AUTHENTICATED" as const };
  if (ctx.routePath !== "/") return { ok: false as const, reason: "WRONG_ROUTE" as const };
  return { ok: true as const };
}

function requireSessionsSidePanelController(ctx: UiExecutionContext) {
  const controller = ctx.sessionsSidePanelController;
  if (!controller) throw new Error("Sessions side panel controller unavailable");
  return controller;
}

function toSessionsSidePanelResult(snapshot: SessionsSidePanelSnapshot) {
  return {
    open: snapshot.open,
    widthPx: snapshot.widthPx,
    groupBy: snapshot.groupBy,
    filters: snapshot.filters,
    hasActiveFilters: snapshot.hasActiveFilters,
  };
}

export const workspaceSessionsPanelOpenAction: SemanticActionDefinition<
  Record<string, never>,
  ReturnType<typeof toSessionsSidePanelResult>
> = {
  id: "workspace.sessions_panel.open",
  version: 1,
  description: "Open the left workspace Sessions side panel.",
  paramsSchema: z.object({}),
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  canRun: (ctx) => {
    const available = canRunSessionsSidePanelAction(ctx);
    if (!available.ok) return available;
    if (!ctx.workspaceReady) return { ok: false, reason: "UI_NOT_READY" };
    return { ok: true };
  },
  run: async (ctx) => {
    const controller = requireSessionsSidePanelController(ctx);
    const snapshot = await controller.setOpen(true);
    return toSessionsSidePanelResult(snapshot);
  },
};

export const workspaceSessionsPanelCloseAction: SemanticActionDefinition<
  Record<string, never>,
  ReturnType<typeof toSessionsSidePanelResult>
> = {
  id: "workspace.sessions_panel.close",
  version: 1,
  description: "Close the left workspace Sessions side panel.",
  paramsSchema: z.object({}),
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  canRun: (ctx) => {
    const available = canRunSessionsSidePanelAction(ctx);
    if (!available.ok) return available;
    if (!ctx.workspaceReady) return { ok: false, reason: "UI_NOT_READY" };
    return { ok: true };
  },
  run: async (ctx) => {
    const controller = requireSessionsSidePanelController(ctx);
    const snapshot = await controller.setOpen(false);
    return toSessionsSidePanelResult(snapshot);
  },
};

export const workspaceSessionsPanelSetFiltersAction: SemanticActionDefinition<
  z.infer<typeof workspaceSessionsPanelSetFiltersSchema>,
  ReturnType<typeof toSessionsSidePanelResult>
> = {
  id: "workspace.sessions_panel.set_filters",
  version: 1,
  description: "Patch Sessions side panel filters.",
  paramsSchema: workspaceSessionsPanelSetFiltersSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      imageId: { type: "string" },
      agentId: { type: "string" },
      createdBy: { type: "string" },
      archived: { type: "string", enum: ["all", "true", "false"] },
      status: { type: "string" },
      updatedAtRange: { type: "string", enum: ["all", "24h", "7d", "30d", "90d"] },
      createdAtRange: { type: "string", enum: ["all", "24h", "7d", "30d", "90d"] },
    },
  },
  canRun: (ctx) => {
    const available = canRunSessionsSidePanelAction(ctx);
    if (!available.ok) return available;
    if (!ctx.workspaceReady) return { ok: false, reason: "UI_NOT_READY" };
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = requireSessionsSidePanelController(ctx);
    const snapshot = await controller.setFilters(params);
    return toSessionsSidePanelResult(snapshot);
  },
};

export const workspaceSessionsPanelSetGroupByAction: SemanticActionDefinition<
  z.infer<typeof workspaceSessionsPanelSetGroupBySchema>,
  ReturnType<typeof toSessionsSidePanelResult>
> = {
  id: "workspace.sessions_panel.set_group_by",
  version: 1,
  description: "Set Sessions side panel group-by mode.",
  paramsSchema: workspaceSessionsPanelSetGroupBySchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["groupBy"],
    properties: {
      groupBy: { type: "string", enum: ["none", "imageId", "createdBy", "status"] },
    },
  },
  canRun: (ctx) => {
    const available = canRunSessionsSidePanelAction(ctx);
    if (!available.ok) return available;
    if (!ctx.workspaceReady) return { ok: false, reason: "UI_NOT_READY" };
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = requireSessionsSidePanelController(ctx);
    const nextGroupBy = params.groupBy as SessionsSidePanelGroupBy;
    const snapshot = await controller.setGroupBy(nextGroupBy);
    return toSessionsSidePanelResult(snapshot);
  },
};
