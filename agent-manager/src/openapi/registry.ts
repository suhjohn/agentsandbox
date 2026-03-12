import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import type { OpenAPIObject } from "openapi3-ts/oas31";
import type { Context, Env, Hono, Next } from "hono";
import { z } from "zod";

extendZodWithOpenApi(z);

type HttpMethod = "get" | "post" | "patch" | "put" | "delete";

type SecuritySchemeName = "bearerAuth" | "apiKeyAuth";
type RouteSecurity = ReadonlyArray<
  Readonly<Partial<Record<SecuritySchemeName, ReadonlyArray<string>>>>
>;

type RequestSchemas = {
  readonly params?: z.ZodTypeAny;
  readonly query?: z.ZodTypeAny;
  readonly json?: z.ZodTypeAny;
};

type ResponseSchemas = Readonly<Record<number, z.ZodTypeAny>>;

export type RouteSpec = {
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary: string;
  readonly tags: ReadonlyArray<string>;
  readonly security?: RouteSecurity;
  readonly request?: RequestSchemas;
  readonly responses: ResponseSchemas;
};

const registry = new OpenAPIRegistry();
const registeredSpecs: RouteSpec[] = [];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathPatternToRegex(path: string): RegExp {
  const pattern = path
    .split("/")
    .map((segment) =>
      segment.startsWith(":")
        ? "[^/]+"
        : escapeRegex(segment),
    )
    .join("/");
  return new RegExp(`^${pattern}$`);
}

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function inferParamsSchemaFromPath(path: string): z.ZodTypeAny | null {
  const matches = [...path.matchAll(/:([A-Za-z0-9_]+)/g)];
  if (matches.length === 0) return null;

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const match of matches) {
    const name = match[1];
    if (!name) continue;
    shape[name] = z.string();
  }
  return z.object(shape);
}

function contentJson(schema: z.ZodTypeAny) {
  return {
    content: {
      "application/json": {
        schema,
      },
    },
  } as const;
}

function cloneSecurityRequirement(
  requirement: Readonly<Partial<Record<SecuritySchemeName, ReadonlyArray<string>>>>,
): Partial<Record<SecuritySchemeName, string[]>> {
  const entries = Object.entries(requirement) as ReadonlyArray<
    readonly [SecuritySchemeName, ReadonlyArray<string> | undefined]
  >;
  const cloned: Partial<Record<SecuritySchemeName, string[]>> = {};
  for (const [name, scopes] of entries) {
    if (!scopes) continue;
    cloned[name] = [...scopes];
  }
  return cloned;
}

function normalizeRouteSecurity(path: string, security?: RouteSecurity): RouteSecurity | undefined {
  if (!security) return undefined;
  const cloned = security.map((requirement) => cloneSecurityRequirement(requirement));
  if (path.startsWith("/api-keys")) {
    return cloned;
  }
  const hasBearer = cloned.some((requirement) => "bearerAuth" in requirement);
  const hasApiKey = cloned.some((requirement) => "apiKeyAuth" in requirement);
  if (hasBearer && !hasApiKey) {
    cloned.push({ apiKeyAuth: [] });
  }
  return cloned;
}

export function documentRoute(spec: RouteSpec): void {
  const inferredParamsSchema =
    spec.request?.params ?? inferParamsSchemaFromPath(spec.path);
  const normalizedSpec: RouteSpec =
    inferredParamsSchema && !spec.request?.params
      ? {
          ...spec,
          request: {
            ...(spec.request ?? {}),
            params: inferredParamsSchema,
          },
        }
      : spec;

  registeredSpecs.push(normalizedSpec);
  const paramsSchema = normalizedSpec.request?.params;
  const querySchema = normalizedSpec.request?.query;
  const jsonSchema = normalizedSpec.request?.json;

  registry.registerPath({
    method: spec.method,
    path: toOpenApiPath(normalizedSpec.path),
    tags: [...normalizedSpec.tags],
    summary: normalizedSpec.summary,
    security: normalizeRouteSecurity(normalizedSpec.path, normalizedSpec.security),
    request: {
      ...(paramsSchema
        ? {
            params: paramsSchema as unknown as z.ZodObject<
              Record<string, z.ZodTypeAny>
            >,
          }
        : {}),
      ...(querySchema
        ? {
            query: querySchema as unknown as z.ZodObject<
              Record<string, z.ZodTypeAny>
            >,
          }
        : {}),
      ...(jsonSchema ? { body: contentJson(jsonSchema) } : {}),
    },
    responses: Object.fromEntries(
      Object.entries(spec.responses).map(([status, schema]) => [
        status,
        {
          description: `${status} response`,
          ...contentJson(schema),
        },
      ]),
    ),
  });
}

export function generateOpenApiSpec(input: {
  readonly title: string;
  readonly version: string;
}): OpenAPIObject {
  registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });
  registry.registerComponent("securitySchemes", "apiKeyAuth", {
    type: "apiKey",
    in: "header",
    name: "X-API-Key",
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: { title: input.title, version: input.version },
  });
}

export function getRegisteredSpecs(): readonly RouteSpec[] {
  return registeredSpecs;
}

export function buildRoutePermissionId(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export function matchRegisteredRoute(
  method: string,
  path: string,
): RouteSpec | null {
  const normalizedMethod = method.toLowerCase();
  for (const spec of registeredSpecs) {
    if (spec.method !== normalizedMethod) continue;
    if (pathPatternToRegex(spec.path).test(path)) {
      return spec;
    }
  }
  return null;
}

export function registerRoute<E extends Env>(
  app: Hono<E>,
  spec: RouteSpec,
  routePath: string,
  ...handlers: ReadonlyArray<(c: Context<E>, next: Next) => unknown>
): void {
  documentRoute(spec);

  const method = spec.method;
  const appAny = app as unknown as Record<
    string,
    (...args: ReadonlyArray<unknown>) => unknown
  >;
  const fn = appAny[method];
  if (typeof fn !== "function") {
    throw new Error(`Unsupported method: ${method}`);
  }
  fn.call(app, routePath, ...(handlers as ReadonlyArray<unknown>));
}
