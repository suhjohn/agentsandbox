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
    security: normalizedSpec.security
      ? normalizedSpec.security.map((s) => cloneSecurityRequirement(s))
      : undefined,
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
    name: "x-agent-manager-api-key",
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
