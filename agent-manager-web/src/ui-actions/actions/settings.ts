import { z } from "zod";
import { getUiActionDescriptor } from "../../../../shared/ui-actions-contract";
import type { UiActionDefinition, UiContextSnapshot } from "../types";
import { EMPTY_PARAMS_JSON_SCHEMA, EMPTY_PARAMS_SCHEMA, unavailable } from "./helpers";

const settingsImageDetailRoutePattern = /^\/settings\/images\/[^/]+$/;

function isSettingsImageDetailRoute(routePath: string): boolean {
  return settingsImageDetailRoutePattern.test(routePath);
}

function canRunGeneralRoute(ctx: UiContextSnapshot) {
  if (!ctx.isAuthenticated) {
    return unavailable("NOT_AUTHENTICATED", "Log in before using settings actions.");
  }
  if (ctx.routePath !== "/settings/general") {
    return unavailable("WRONG_ROUTE", "Action requires the general settings route.");
  }
  if (!ctx.settingsGeneralReady) {
    return unavailable("UI_NOT_READY", "General settings UI is not ready.");
  }
  return { ok: true as const };
}

function canRunImagesRoute(ctx: UiContextSnapshot) {
  if (!ctx.isAuthenticated) {
    return unavailable("NOT_AUTHENTICATED", "Log in before using settings actions.");
  }
  if (ctx.routePath !== "/settings/images") {
    return unavailable("WRONG_ROUTE", "Action requires the images settings route.");
  }
  if (!ctx.settingsImagesReady) {
    return unavailable("UI_NOT_READY", "Images settings UI is not ready.");
  }
  return { ok: true as const };
}

function canRunImageDetailRoute(ctx: UiContextSnapshot) {
  if (!ctx.isAuthenticated) {
    return unavailable("NOT_AUTHENTICATED", "Log in before using image-detail actions.");
  }
  if (!isSettingsImageDetailRoute(ctx.routePath)) {
    return unavailable("WRONG_ROUTE", "Action requires an image detail settings route.");
  }
  if (!ctx.settingsImageDetailReady) {
    return unavailable("UI_NOT_READY", "Image detail UI is not ready.");
  }
  if (!ctx.settingsImageLoaded || !ctx.activeImageId) {
    return unavailable("MISSING_REQUIRED_ENTITY", "Image detail is not loaded yet.");
  }
  return { ok: true as const };
}

function canRunImageDetailEditable(ctx: UiContextSnapshot) {
  const base = canRunImageDetailRoute(ctx);
  if (!base.ok) return base;
  if (!ctx.settingsImageCanEdit) {
    return unavailable("MISSING_REQUIRED_ENTITY", "Current image is not editable.");
  }
  if (ctx.isBusy) {
    return unavailable("MUTATION_IN_PROGRESS", "Image detail action is already in progress.");
  }
  return { ok: true as const };
}

const settingsGeneralSetNameSchema = z.object({
  name: z.string(),
});

export const settingsGeneralSetNameAction: UiActionDefinition<
  z.infer<typeof settingsGeneralSetNameSchema>,
  { readonly name: string; readonly dirty: boolean }
> = {
  ...getUiActionDescriptor("settings.general.set_name"),
  paramsSchema: settingsGeneralSetNameSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string" },
    },
  },
  canRun: canRunGeneralRoute,
  run: async (ctx, params) => {
    const controller = ctx.settingsGeneralController;
    if (!controller) throw new Error("General settings controller unavailable");
    return await controller.setName(params.name);
  },
};

const settingsGeneralSetDefaultRegionSchema = z.object({
  regionText: z.string(),
});

export const settingsGeneralSetDefaultRegionAction: UiActionDefinition<
  z.infer<typeof settingsGeneralSetDefaultRegionSchema>,
  { readonly regionText: string; readonly dirty: boolean }
> = {
  ...getUiActionDescriptor("settings.general.set_default_region"),
  paramsSchema: settingsGeneralSetDefaultRegionSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["regionText"],
    properties: {
      regionText: { type: "string" },
    },
  },
  canRun: canRunGeneralRoute,
  run: async (ctx, params) => {
    const controller = ctx.settingsGeneralController;
    if (!controller) throw new Error("General settings controller unavailable");
    return await controller.setDefaultRegion(params.regionText);
  },
};

export const settingsGeneralSaveAction: UiActionDefinition<
  Record<string, never>,
  { readonly saved: true }
> = {
  ...getUiActionDescriptor("settings.general.save"),
  paramsSchema: EMPTY_PARAMS_SCHEMA,
  paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA,
  canRun: (ctx) => {
    const base = canRunGeneralRoute(ctx);
    if (!base.ok) return base;
    if (!ctx.settingsGeneralCanSave) {
      return unavailable(
        "MISSING_REQUIRED_ENTITY",
        "General settings has no savable changes or validation errors.",
      );
    }
    return { ok: true };
  },
  run: async (ctx) => {
    const controller = ctx.settingsGeneralController;
    if (!controller) throw new Error("General settings controller unavailable");
    return await controller.save();
  },
};

const settingsImagesOpenDetailSchema = z.object({
  imageId: z.string().trim().min(1),
});

export const settingsImagesOpenDetailAction: UiActionDefinition<
  z.infer<typeof settingsImagesOpenDetailSchema>,
  { readonly opened: true; readonly routePath: string }
> = {
  ...getUiActionDescriptor("settings.images.open_detail"),
  paramsSchema: settingsImagesOpenDetailSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["imageId"],
    properties: {
      imageId: { type: "string", minLength: 1 },
    },
  },
  canRun: (ctx) => {
    const base = canRunImagesRoute(ctx);
    if (!base.ok) return base;
    if (ctx.settingsImagesCount <= 0) {
      return unavailable("MISSING_REQUIRED_ENTITY", "No images are available on this page.");
    }
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = ctx.settingsImagesController;
    if (!controller) throw new Error("Images settings controller unavailable");
    const imageId = params.imageId.trim();
    const { imageIds } = controller.getSnapshot();
    if (!imageIds.includes(imageId)) {
      throw new Error(`Image is not available in the current list: ${imageId}`);
    }
    await ctx.navigate({
      to: "/settings/images/$imageId",
      params: { imageId },
    });
    return {
      opened: true as const,
      routePath: `/settings/images/${encodeURIComponent(imageId)}`,
    };
  },
};

const settingsImageDetailSetNameSchema = z.object({
  name: z.string(),
});

export const settingsImageDetailSetNameAction: UiActionDefinition<
  z.infer<typeof settingsImageDetailSetNameSchema>,
  { readonly name: string; readonly dirty: boolean }
> = {
  ...getUiActionDescriptor("settings.image_detail.set_name"),
  paramsSchema: settingsImageDetailSetNameSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string" },
    },
  },
  canRun: canRunImageDetailEditable,
  run: async (ctx, params) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.setName(params.name);
  },
};

const settingsImageDetailSetDescriptionSchema = z.object({
  description: z.string(),
});

export const settingsImageDetailSetDescriptionAction: UiActionDefinition<
  z.infer<typeof settingsImageDetailSetDescriptionSchema>,
  { readonly description: string; readonly dirty: boolean }
> = {
  ...getUiActionDescriptor("settings.image_detail.set_description"),
  paramsSchema: settingsImageDetailSetDescriptionSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["description"],
    properties: {
      description: { type: "string" },
    },
  },
  canRun: canRunImageDetailEditable,
  run: async (ctx, params) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.setDescription(params.description);
  },
};

export const settingsImageDetailSaveAction: UiActionDefinition<
  Record<string, never>,
  { readonly saved: true }
> = {
  ...getUiActionDescriptor("settings.image_detail.save"),
  paramsSchema: EMPTY_PARAMS_SCHEMA,
  paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA,
  canRun: (ctx) => {
    const base = canRunImageDetailEditable(ctx);
    if (!base.ok) return base;
    if (!ctx.hasDirtyImageDraft) {
      return unavailable("MISSING_REQUIRED_ENTITY", "No unsaved image detail changes.");
    }
    return { ok: true };
  },
  run: async (ctx) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.save();
  },
};

export const settingsImageDetailRevertAction: UiActionDefinition<
  Record<string, never>,
  { readonly reverted: true; readonly dirty: false }
> = {
  ...getUiActionDescriptor("settings.image_detail.revert"),
  paramsSchema: EMPTY_PARAMS_SCHEMA,
  paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA,
  canRun: (ctx) => {
    const base = canRunImageDetailEditable(ctx);
    if (!base.ok) return base;
    if (!ctx.hasDirtyImageDraft) {
      return unavailable("MISSING_REQUIRED_ENTITY", "No unsaved image detail changes.");
    }
    return { ok: true };
  },
  run: async (ctx) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.revert();
  },
};

export const settingsImageDetailCloneAction: UiActionDefinition<
  Record<string, never>,
  { readonly cloned: true; readonly newImageId: string; readonly navigated: true }
> = {
  ...getUiActionDescriptor("settings.image_detail.clone"),
  paramsSchema: EMPTY_PARAMS_SCHEMA,
  paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA,
  canRun: (ctx) => {
    const base = canRunImageDetailEditable(ctx);
    if (!base.ok) return base;
    if (ctx.settingsImageArchived) {
      return unavailable("MISSING_REQUIRED_ENTITY", "Cannot clone an archived image.");
    }
    return { ok: true };
  },
  run: async (ctx) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.clone();
  },
};

export const settingsImageDetailBuildStartAction: UiActionDefinition<
  Record<string, never>,
  { readonly buildStarted: true }
> = {
  ...getUiActionDescriptor("settings.image_detail.build.start"),
  paramsSchema: EMPTY_PARAMS_SCHEMA,
  paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA,
  canRun: (ctx) => {
    const base = canRunImageDetailEditable(ctx);
    if (!base.ok) return base;
    if (ctx.settingsImageBuildRunning) {
      return unavailable("MUTATION_IN_PROGRESS", "Image build is already running.");
    }
    return { ok: true };
  },
  run: async (ctx) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.startBuild();
  },
};

export const settingsImageDetailBuildStopAction: UiActionDefinition<
  Record<string, never>,
  { readonly buildStopped: true }
> = {
  ...getUiActionDescriptor("settings.image_detail.build.stop"),
  paramsSchema: EMPTY_PARAMS_SCHEMA,
  paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA,
  canRun: (ctx) => {
    const base = canRunImageDetailRoute(ctx);
    if (!base.ok) return base;
    if (!ctx.settingsImageBuildRunning) {
      return unavailable("MISSING_REQUIRED_ENTITY", "No active image build to stop.");
    }
    return { ok: true };
  },
  run: async (ctx) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.stopBuild();
  },
};

export const settingsImageDetailArchiveAction: UiActionDefinition<
  Record<string, never>,
  { readonly archived: true; readonly routePath: string }
> = {
  ...getUiActionDescriptor("settings.image_detail.archive"),
  paramsSchema: EMPTY_PARAMS_SCHEMA,
  paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA,
  canRun: (ctx) => {
    const base = canRunImageDetailEditable(ctx);
    if (!base.ok) return base;
    if (ctx.settingsImageArchived) {
      return unavailable("MISSING_REQUIRED_ENTITY", "Image is already archived.");
    }
    return { ok: true };
  },
  run: async (ctx) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.archive();
  },
};

export const settingsImageDetailDeleteAction: UiActionDefinition<
  { readonly confirm: true },
  { readonly deleted: true; readonly redirectedTo: string }
> = {
  ...getUiActionDescriptor("settings.image_detail.delete"),
  paramsSchema: z.object({ confirm: z.literal(true) }),
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["confirm"],
    properties: {
      confirm: { const: true },
    },
  },
  canRun: (ctx) => {
    const base = canRunImageDetailEditable(ctx);
    if (!base.ok) return base;
    if (!ctx.settingsImageArchived) {
      return unavailable("MISSING_REQUIRED_ENTITY", "Only archived images can be deleted.");
    }
    return { ok: true };
  },
  run: async (ctx) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.delete();
  },
};

export const settingsActions = [
  settingsGeneralSetNameAction,
  settingsGeneralSetDefaultRegionAction,
  settingsGeneralSaveAction,
  settingsImagesOpenDetailAction,
  settingsImageDetailSetNameAction,
  settingsImageDetailSetDescriptionAction,
  settingsImageDetailSaveAction,
  settingsImageDetailRevertAction,
  settingsImageDetailCloneAction,
  settingsImageDetailBuildStartAction,
  settingsImageDetailBuildStopAction,
  settingsImageDetailArchiveAction,
  settingsImageDetailDeleteAction,
] as const;
