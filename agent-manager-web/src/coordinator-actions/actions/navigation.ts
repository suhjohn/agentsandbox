import { z } from "zod";
import type { SemanticActionDefinition } from "../types";
import { setCoordinatorDialogOpen } from "../runtime-bridge";

const NAV_ALIAS = [
  "chat",
  "settings.general",
  "settings.images",
  "settings.keybindings",
  "workspace",
  "login",
  "register",
] as const;
type NavAlias = (typeof NAV_ALIAS)[number];

const navGoSchema = z.object({
  // Either a known alias (e.g. "settings.images") or an absolute route path (e.g. "/settings/images/$imageId").
  to: z.string().trim().optional(),
  // Backward-compatible direct path field.
  path: z.string().trim().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  search: z.record(z.string(), z.unknown()).optional(),
  hash: z.string().trim().optional(),
  replace: z.boolean().optional(),
}).superRefine((value, ctx) => {
  const to = typeof value.to === "string" ? value.to.trim() : "";
  const path = typeof value.path === "string" ? value.path.trim() : "";
  const target = to.length > 0 ? to : path;

  if (target.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either `to` or `path`.",
    });
    return;
  }

  const isAlias = target in navToPath;
  const isAbsolutePath = target.startsWith("/");
  if (!isAlias && !isAbsolutePath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Invalid navigation target. Use a known alias or an absolute path starting with '/'.",
    });
  }
});

const navToPath = {
  chat: "/chat",
  "settings.general": "/settings/general",
  "settings.images": "/settings/images",
  "settings.keybindings": "/settings/keybindings",
  workspace: "/",
  login: "/login",
  register: "/register",
} as const satisfies Record<NavAlias, string>;

function resolveRoutePath(params: z.infer<typeof navGoSchema>): string {
  const to = typeof params.to === "string" ? params.to.trim() : "";
  const path = typeof params.path === "string" ? params.path.trim() : "";
  const target = to.length > 0 ? to : path;
  if (target in navToPath) {
    return navToPath[target as NavAlias];
  }
  return target;
}

export const navGoAction: SemanticActionDefinition<
  z.infer<typeof navGoSchema>,
  { readonly routePath: string }
> = {
  id: "nav.go",
  version: 1,
  description: "Navigate to a route alias or an absolute app path.",
  paramsSchema: navGoSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      to: {
        type: "string",
        description:
          "Known alias (chat, settings.general, settings.images, settings.keybindings, workspace, login, register) or absolute path.",
      },
      path: {
        type: "string",
        description: "Absolute path alternative to `to`.",
      },
      params: {
        type: "object",
        additionalProperties: true,
        description:
          "Optional route params for dynamic paths (for example imageId for /settings/images/$imageId).",
      },
      search: {
        type: "object",
        additionalProperties: true,
      },
      hash: {
        type: "string",
      },
      replace: {
        type: "boolean",
      },
    },
  },
  canRun: () => ({ ok: true }),
  run: async (ctx, params) => {
    const routePath = resolveRoutePath(params);
    await ctx.navigate({
      to: routePath,
      ...(params.params ? { params: params.params } : {}),
      ...(params.search ? { search: params.search } : {}),
      ...(typeof params.hash === "string" && params.hash.trim().length > 0
        ? { hash: params.hash }
        : {}),
      ...(params.replace === true ? { replace: true } : {}),
    });
    return { routePath };
  },
};

export const coordinatorOpenDialogAction: SemanticActionDefinition<
  Record<string, never>,
  { readonly chatDialogOpen: true }
> = {
  id: "coordinator.open_dialog",
  version: 1,
  description: "Open coordinator chat dialog from anywhere.",
  paramsSchema: z.object({}),
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  canRun: (ctx) =>
    ctx.isAuthenticated
      ? { ok: true }
      : { ok: false, reason: "NOT_AUTHENTICATED" },
  run: async () => {
    setCoordinatorDialogOpen(true);
    globalThis.window.dispatchEvent(new Event("agent-manager-web:open-coordinator"));
    return { chatDialogOpen: true as const };
  },
};

export const coordinatorCloseDialogAction: SemanticActionDefinition<
  Record<string, never>,
  { readonly chatDialogOpen: false }
> = {
  id: "coordinator.close_dialog",
  version: 1,
  description: "Close coordinator chat dialog.",
  paramsSchema: z.object({}),
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  canRun: (ctx) =>
    ctx.chatDialogOpen
      ? { ok: true }
      : { ok: false, reason: "DIALOG_CLOSED" },
  run: async () => {
    setCoordinatorDialogOpen(false);
    globalThis.window.dispatchEvent(new Event("agent-manager-web:close-coordinator"));
    return { chatDialogOpen: false as const };
  },
};
