import { z } from "zod";
import { getUiActionDescriptor } from "../../../../shared/ui-actions-contract";
import type {
  SessionsSidePanelGroupBy,
  SessionsSidePanelSnapshot,
  UiActionDefinition,
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

const EMPTY_PARAMS_SCHEMA = z.object({});
const EMPTY_PARAMS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

function extractNonEmptyAgentId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as { agentId?: unknown }).agentId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const workspacePanelOpenAction: UiActionDefinition<
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
  ...getUiActionDescriptor("workspace.panel.open"),
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
        throw new Error("agent_detail requires config.agentId (non-empty string)");
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

export const workspacePanelListAction: UiActionDefinition<
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
  ...getUiActionDescriptor("workspace.panel.list"),
  paramsSchema: EMPTY_PARAMS_SCHEMA,
  paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA,
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

export const workspacePaneFocusAction: UiActionDefinition<
  z.infer<typeof workspacePaneFocusSchema>,
  {
    readonly focused: true;
    readonly leafId: string;
    readonly panelInstanceId: string;
  }
> = {
  ...getUiActionDescriptor("workspace.pane.focus"),
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
      leafId: { type: "string" },
      panelInstanceId: { type: "string" },
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
        message: "Provide exactly one of fromLeafId or fromPanelInstanceId",
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

export const workspacePaneMoveAction: UiActionDefinition<
  z.infer<typeof workspacePaneMoveSchema>,
  {
    readonly moved: true;
    readonly fromLeafId: string;
    readonly toLeafId: string;
    readonly placement: "left" | "right" | "top" | "bottom";
    readonly focusedLeafId: string | null;
  }
> = {
  ...getUiActionDescriptor("workspace.pane.move"),
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

export const workspacePaneCloseAction: UiActionDefinition<
  z.infer<typeof workspacePaneCloseSchema>,
  {
    readonly closed: true;
    readonly closedLeafId: string;
    readonly closedPanelInstanceId: string;
    readonly focusedLeafId: string | null;
  }
> = {
  ...getUiActionDescriptor("workspace.pane.close"),
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
      leafId: { type: "string" },
      panelInstanceId: { type: "string" },
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

export const workspacePanelSetConfigAction: UiActionDefinition<
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
  ...getUiActionDescriptor("workspace.panel.set_config"),
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
      panelInstanceId: { type: "string" },
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
    if (params.target === "focused" && ctx.snapshot.workspaceFocusedLeafId === null) {
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

export const workspacePanelResizeAction: UiActionDefinition<
  z.infer<typeof workspacePanelResizeSchema>,
  {
    readonly resized: true;
    readonly splitId: string;
    readonly ratio: number;
    readonly dimension: "width" | "height";
  }
> = {
  ...getUiActionDescriptor("workspace.panel.resize"),
  paramsSchema: workspacePanelResizeSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["dimension", "mode", "value"],
    properties: {
      dimension: { type: "string", enum: ["width", "height"] },
      mode: { type: "string", enum: ["set_fraction", "delta_fraction"] },
      value: { type: "number" },
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

const sessionsSidePanelGroupBySchema = z.enum(["none", "imageId", "createdBy", "status"]);
const sessionsSidePanelTimeRangeSchema = z.enum(["all", "24h", "7d", "30d", "90d"]);
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
    const hasAnyField = Object.values(value).some((entry) => typeof entry !== "undefined");
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

export const workspaceSessionsPanelOpenAction: UiActionDefinition<
  Record<string, never>,
  ReturnType<typeof toSessionsSidePanelResult>
> = {
  ...getUiActionDescriptor("workspace.sessions_panel.open"),
  paramsSchema: EMPTY_PARAMS_SCHEMA,
  paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA,
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

export const workspaceSessionsPanelCloseAction: UiActionDefinition<
  Record<string, never>,
  ReturnType<typeof toSessionsSidePanelResult>
> = {
  ...getUiActionDescriptor("workspace.sessions_panel.close"),
  paramsSchema: EMPTY_PARAMS_SCHEMA,
  paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA,
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

export const workspaceSessionsPanelSetFiltersAction: UiActionDefinition<
  z.infer<typeof workspaceSessionsPanelSetFiltersSchema>,
  ReturnType<typeof toSessionsSidePanelResult>
> = {
  ...getUiActionDescriptor("workspace.sessions_panel.set_filters"),
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

export const workspaceSessionsPanelSetGroupByAction: UiActionDefinition<
  z.infer<typeof workspaceSessionsPanelSetGroupBySchema>,
  ReturnType<typeof toSessionsSidePanelResult>
> = {
  ...getUiActionDescriptor("workspace.sessions_panel.set_group_by"),
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
