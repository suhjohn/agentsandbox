import { z } from "zod";
import type { SemanticActionDefinition, UiContextSnapshot } from "../types";

const EMPTY_PARAMS_SCHEMA = z.object({});
const EMPTY_PARAMS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

const settingsImageDetailRoutePattern = /^\/settings\/images\/[^/]+$/;

function unavailable(
  reason:
    | "NOT_AUTHENTICATED"
    | "WRONG_ROUTE"
    | "UI_NOT_READY"
    | "MISSING_REQUIRED_ENTITY"
    | "MUTATION_IN_PROGRESS",
  details?: string,
) {
  return { ok: false as const, reason, ...(details ? { details } : {}) };
}

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

export const settingsGeneralSetNameAction: SemanticActionDefinition<
  z.infer<typeof settingsGeneralSetNameSchema>,
  { readonly name: string; readonly dirty: boolean }
> = {
  id: "settings.general.set_name",
  version: 1,
  description: "Set display name input value on the general settings page.",
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

export const settingsGeneralSetDefaultRegionAction: SemanticActionDefinition<
  z.infer<typeof settingsGeneralSetDefaultRegionSchema>,
  { readonly regionText: string; readonly dirty: boolean }
> = {
  id: "settings.general.set_default_region",
  version: 1,
  description: "Set default region input text on the general settings page.",
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

export const settingsGeneralSaveAction: SemanticActionDefinition<
  Record<string, never>,
  { readonly saved: true }
> = {
  id: "settings.general.save",
  version: 1,
  description: "Save pending changes on the general settings page.",
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

export const settingsImagesOpenDetailAction: SemanticActionDefinition<
  z.infer<typeof settingsImagesOpenDetailSchema>,
  { readonly opened: true; readonly routePath: string }
> = {
  id: "settings.images.open_detail",
  version: 1,
  description: "Open an image detail route from the images settings page.",
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

export const settingsImageDetailSetNameAction: SemanticActionDefinition<
  z.infer<typeof settingsImageDetailSetNameSchema>,
  { readonly name: string; readonly dirty: boolean }
> = {
  id: "settings.image_detail.set_name",
  version: 1,
  description: "Set the image name field on the image detail page.",
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

export const settingsImageDetailSetDescriptionAction: SemanticActionDefinition<
  z.infer<typeof settingsImageDetailSetDescriptionSchema>,
  { readonly description: string; readonly dirty: boolean }
> = {
  id: "settings.image_detail.set_description",
  version: 1,
  description: "Set the image description field on the image detail page.",
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

const settingsImageDetailSetSetupScriptSchema = z.object({
  script: z.string(),
});

export const settingsImageDetailSetSetupScriptAction: SemanticActionDefinition<
  z.infer<typeof settingsImageDetailSetSetupScriptSchema>,
  { readonly scriptUpdated: true; readonly dirty: boolean }
> = {
  id: "settings.image_detail.set_setup_script",
  version: 1,
  description: "Set the setup script text on the image detail page.",
  paramsSchema: settingsImageDetailSetSetupScriptSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["script"],
    properties: {
      script: { type: "string" },
    },
  },
  canRun: canRunImageDetailEditable,
  run: async (ctx, params) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.setSetupScript(params.script);
  },
};

export const settingsImageDetailSaveAction: SemanticActionDefinition<
  Record<string, never>,
  { readonly saved: true }
> = {
  id: "settings.image_detail.save",
  version: 1,
  description: "Save pending image detail draft changes.",
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

export const settingsImageDetailRevertAction: SemanticActionDefinition<
  Record<string, never>,
  { readonly reverted: true; readonly dirty: false }
> = {
  id: "settings.image_detail.revert",
  version: 1,
  description: "Revert image detail draft changes back to server state.",
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

export const settingsImageDetailCloneAction: SemanticActionDefinition<
  Record<string, never>,
  { readonly cloned: true; readonly newImageId: string; readonly navigated: true }
> = {
  id: "settings.image_detail.clone",
  version: 1,
  description: "Clone the current image and navigate to the cloned image detail page.",
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

export const settingsImageDetailBuildStartAction: SemanticActionDefinition<
  Record<string, never>,
  { readonly buildStarted: true }
> = {
  id: "settings.image_detail.build.start",
  version: 1,
  description: "Start a build for the selected image variant.",
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

export const settingsImageDetailBuildStopAction: SemanticActionDefinition<
  Record<string, never>,
  { readonly buildStopped: true }
> = {
  id: "settings.image_detail.build.stop",
  version: 1,
  description: "Stop an active image build stream.",
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

const confirmSchema = z.object({
  confirm: z.literal(true),
});

export const settingsImageDetailArchiveAction: SemanticActionDefinition<
  z.infer<typeof confirmSchema>,
  { readonly archived: true; readonly routePath: string }
> = {
  id: "settings.image_detail.archive",
  version: 1,
  description: "Archive the current image.",
  paramsSchema: confirmSchema,
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

export const settingsImageDetailDeleteAction: SemanticActionDefinition<
  z.infer<typeof confirmSchema>,
  { readonly deleted: true; readonly redirectedTo: string }
> = {
  id: "settings.image_detail.delete",
  version: 1,
  description: "Delete the currently archived image.",
  paramsSchema: confirmSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["confirm"],
    properties: {
      confirm: { const: true },
    },
  },
  canRun: (ctx) => {
    const base = canRunImageDetailRoute(ctx);
    if (!base.ok) return base;
    if (ctx.isBusy) {
      return unavailable("MUTATION_IN_PROGRESS", "Image detail action is already in progress.");
    }
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

export const settingsImageDetailSecretAddTabAction: SemanticActionDefinition<
  Record<string, never>,
  { readonly added: true; readonly activeSecretTabKey: string }
> = {
  id: "settings.image_detail.secret.add_tab",
  version: 1,
  description: "Add a new secret-file tab and activate it.",
  paramsSchema: EMPTY_PARAMS_SCHEMA,
  paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA,
  canRun: canRunImageDetailEditable,
  run: async (ctx) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.addSecretTab();
  },
};

const secretTabKeySchema = z.object({
  tabKey: z.string().trim().min(1),
});

export const settingsImageDetailSecretSelectTabAction: SemanticActionDefinition<
  z.infer<typeof secretTabKeySchema>,
  { readonly selected: true; readonly activeSecretTabKey: string }
> = {
  id: "settings.image_detail.secret.select_tab",
  version: 1,
  description: "Select a secret-file tab by key.",
  paramsSchema: secretTabKeySchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["tabKey"],
    properties: {
      tabKey: { type: "string", minLength: 1 },
    },
  },
  canRun: (ctx) => {
    const base = canRunImageDetailRoute(ctx);
    if (!base.ok) return base;
    if (ctx.settingsImageSecretTabKeys.length <= 0) {
      return unavailable("MISSING_REQUIRED_ENTITY", "No secret tabs are available.");
    }
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    const tabKey = params.tabKey.trim();
    const available = controller.getSnapshot().secretTabKeys;
    if (!available.includes(tabKey)) {
      throw new Error(`Secret tab not found: ${tabKey}`);
    }
    return await controller.selectSecretTab(tabKey);
  },
};

const secretNameSchema = z.object({
  modalSecretName: z.string(),
});

export const settingsImageDetailSecretSetNameAction: SemanticActionDefinition<
  z.infer<typeof secretNameSchema>,
  { readonly updated: true; readonly activeSecretTabKey: string }
> = {
  id: "settings.image_detail.secret.set_name",
  version: 1,
  description: "Set modal secret name for the active secret tab.",
  paramsSchema: secretNameSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["modalSecretName"],
    properties: {
      modalSecretName: { type: "string" },
    },
  },
  canRun: (ctx) => {
    const base = canRunImageDetailEditable(ctx);
    if (!base.ok) return base;
    if (!ctx.activeSecretTabKey) {
      return unavailable("MISSING_REQUIRED_ENTITY", "No active secret tab.");
    }
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.setSecretName(params.modalSecretName);
  },
};

const secretPathSchema = z.object({
  path: z.string(),
});

export const settingsImageDetailSecretSetPathAction: SemanticActionDefinition<
  z.infer<typeof secretPathSchema>,
  { readonly updated: true; readonly activeSecretTabKey: string }
> = {
  id: "settings.image_detail.secret.set_path",
  version: 1,
  description: "Set file path for the active secret tab.",
  paramsSchema: secretPathSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string" },
    },
  },
  canRun: (ctx) => {
    const base = canRunImageDetailEditable(ctx);
    if (!base.ok) return base;
    if (!ctx.activeSecretTabKey) {
      return unavailable("MISSING_REQUIRED_ENTITY", "No active secret tab.");
    }
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.setSecretPath(params.path);
  },
};

const secretEnvSchema = z.object({
  envText: z.string(),
});

export const settingsImageDetailSecretSetEnvAction: SemanticActionDefinition<
  z.infer<typeof secretEnvSchema>,
  { readonly updated: true; readonly activeSecretTabKey: string }
> = {
  id: "settings.image_detail.secret.set_env",
  version: 1,
  description: "Set dotenv text for the active secret tab.",
  paramsSchema: secretEnvSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["envText"],
    properties: {
      envText: { type: "string" },
    },
  },
  canRun: (ctx) => {
    const base = canRunImageDetailEditable(ctx);
    if (!base.ok) return base;
    if (!ctx.activeSecretTabKey) {
      return unavailable("MISSING_REQUIRED_ENTITY", "No active secret tab.");
    }
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.setSecretEnv(params.envText);
  },
};

export const settingsImageDetailSecretSaveAction: SemanticActionDefinition<
  Record<string, never>,
  { readonly saved: true; readonly bindingId: string | null; readonly activeSecretTabKey: string }
> = {
  id: "settings.image_detail.secret.save",
  version: 1,
  description: "Save active secret tab metadata and modal secret values.",
  paramsSchema: EMPTY_PARAMS_SCHEMA,
  paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA,
  canRun: (ctx) => {
    const base = canRunImageDetailEditable(ctx);
    if (!base.ok) return base;
    if (!ctx.activeSecretTabKey) {
      return unavailable("MISSING_REQUIRED_ENTITY", "No active secret tab.");
    }
    if (!ctx.settingsImageActiveSecretCanSave) {
      return unavailable("MISSING_REQUIRED_ENTITY", "Active secret tab has no valid save payload.");
    }
    return { ok: true };
  },
  run: async (ctx) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    return await controller.saveSecret();
  },
};

const deleteSecretBindingSchema = z.object({
  tabKey: z.string().trim().min(1),
  confirm: z.literal(true),
});

export const settingsImageDetailSecretDeleteBindingAction: SemanticActionDefinition<
  z.infer<typeof deleteSecretBindingSchema>,
  { readonly deleted: true }
> = {
  id: "settings.image_detail.secret.delete_binding",
  version: 1,
  description: "Delete a secret file binding by tab key.",
  paramsSchema: deleteSecretBindingSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["tabKey", "confirm"],
    properties: {
      tabKey: { type: "string", minLength: 1 },
      confirm: { const: true },
    },
  },
  canRun: (ctx) => {
    const base = canRunImageDetailEditable(ctx);
    if (!base.ok) return base;
    if (ctx.settingsImageSecretTabKeys.length <= 0) {
      return unavailable("MISSING_REQUIRED_ENTITY", "No secret tabs are available.");
    }
    return { ok: true };
  },
  run: async (ctx, params) => {
    const controller = ctx.settingsImageDetailController;
    if (!controller) throw new Error("Image detail controller unavailable");
    const tabKey = params.tabKey.trim();
    return await controller.deleteSecretBinding(tabKey);
  },
};

export const settingsActions = [
  settingsGeneralSetNameAction,
  settingsGeneralSetDefaultRegionAction,
  settingsGeneralSaveAction,
  settingsImagesOpenDetailAction,
  settingsImageDetailSetNameAction,
  settingsImageDetailSetDescriptionAction,
  settingsImageDetailSetSetupScriptAction,
  settingsImageDetailSaveAction,
  settingsImageDetailRevertAction,
  settingsImageDetailCloneAction,
  settingsImageDetailBuildStartAction,
  settingsImageDetailBuildStopAction,
  settingsImageDetailArchiveAction,
  settingsImageDetailDeleteAction,
  settingsImageDetailSecretAddTabAction,
  settingsImageDetailSecretSelectTabAction,
  settingsImageDetailSecretSetNameAction,
  settingsImageDetailSecretSetPathAction,
  settingsImageDetailSecretSetEnvAction,
  settingsImageDetailSecretSaveAction,
  settingsImageDetailSecretDeleteBindingAction,
] as const;
