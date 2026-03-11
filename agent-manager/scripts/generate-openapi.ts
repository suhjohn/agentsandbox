import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const env = process.env;

if (!env.DATABASE_URL)
  env.DATABASE_URL =
    "postgres://postgres:password@localhost:5679/agent_manager";
if (!env.USER_JWT_SECRET)
  env.USER_JWT_SECRET = "dev-user-jwt-secret-generate-openapi-000000000000";
if (!env.SANDBOX_SIGNING_SECRET)
  env.SANDBOX_SIGNING_SECRET = "dev-sandbox-signing-secret-generate-openapi-000000000000";
if (!env.SANDBOX_TOKEN_ENCRYPTION_SECRET)
  env.SANDBOX_TOKEN_ENCRYPTION_SECRET =
    "dev-sandbox-token-encryption-secret-generate-openapi-000000000000";
if (!env.OPENAI_API_KEY)
  env.OPENAI_API_KEY = "dev-openai-key-generate-openapi";
if (!env.ALLOWED_DOMAINS) env.ALLOWED_DOMAINS = "company.com";
if (!env.JWT_EXPIRES_IN) env.JWT_EXPIRES_IN = "7d";
if (!env.PORT) env.PORT = "0";

const { app } = await import("../src/app");
const { generateOpenApiSpec } = await import("../src/openapi/registry");

// Ensure routes are registered (importing app does that), then generate spec.
const spec = generateOpenApiSpec({ title: "agent-manager", version: "0.0.1" });

await writeFile(
  resolve(process.cwd(), "openapi.json"),
  JSON.stringify(spec, null, 2),
  { encoding: "utf-8" },
);
console.log("Wrote openapi.json");
