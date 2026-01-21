import "../setup.test";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ModalClient, type Sandbox } from "modal";
import { startServer } from "../../src/server";
import { deleteImage } from "../../src/services/image.service";
import { terminateAgentSandbox } from "../../src/services/sandbox.service";

type ServerInfo = {
  readonly baseUrl: string;
  readonly stop: () => void;
};

function loadEnvFileIfPresent(path: string): void {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.split("#")[0].trim();
    if (!trimmed) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!key) continue;
    const value = rest.join("=").trim();
    if (value === "") continue;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function registerUser(baseUrl: string): Promise<{ readonly accessToken: string }> {
  const runId = crypto.randomUUID();
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "User",
      email: `build-sandbox-${runId}@company.com`,
      password: "password123",
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { accessToken: string };
  return { accessToken: body.accessToken };
}

function authedHeaders(accessToken: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(extra ?? {}),
  };
}

describe("Images build sandbox (real)", () => {
  let server: ServerInfo;

  beforeAll(() => {
    // tests/setup.test.ts prefers .env.test; for this real Modal test we also
    // allow pulling Modal creds from .env if they exist locally.
    loadEnvFileIfPresent(resolve(process.cwd(), ".env"));

    const bunServer = startServer({ port: 0 });
    server = {
      baseUrl: `http://127.0.0.1:${bunServer.port}`,
      stop: () => bunServer.stop(true),
    };
  });

  afterAll(() => {
    server.stop();
  });

  it(
    "build sandbox runs setup script on default GHCR base image and snapshots marker artifacts",
    async () => {
      const modalTokenId = process.env.MODAL_TOKEN_ID?.trim() ?? "";
      const modalTokenSecret = process.env.MODAL_TOKEN_SECRET?.trim() ?? "";
      if (!modalTokenId || !modalTokenSecret) {
        // Not a failure in environments without Modal credentials.
        return;
      }

      // Force the build path through registry default behavior, not Dockerfile mode.
      const prevDockerfile = process.env.AGENT_BASE_IMAGE_DOCKERFILE;
      const prevContext = process.env.AGENT_BASE_IMAGE_CONTEXT_DIR;
      process.env.AGENT_BASE_IMAGE_DOCKERFILE = "";
      process.env.AGENT_BASE_IMAGE_CONTEXT_DIR = "";

      const { accessToken } = await registerUser(server.baseUrl);
      const runId = crypto.randomUUID();

      const setupScript = [
        "set -euo pipefail",
        "mkdir -p /opt/agent-image/test-markers",
        "code=0",
        "curl -fsS --max-time 3 http://127.0.0.1:48213/health >/opt/agent-image/test-markers/build-sandbox-health.out 2>/opt/agent-image/test-markers/build-sandbox-health.err || code=$?",
        "printf '%s\\n' \"$code\" >/opt/agent-image/test-markers/build-sandbox-health.exit",
      ].join("\n");

      let imageId = "";
      let builtImageId = "";
      let verifySandbox: Sandbox | null = null;
      try {
        const imageRes = await fetch(`${server.baseUrl}/images`, {
          method: "POST",
          headers: authedHeaders(accessToken, { "Content-Type": "application/json" }),
          body: JSON.stringify({
            name: `Build sandbox marker test ${runId}`,
            visibility: "private",
            setupScript,
          }),
        });
        expect(imageRes.status).toBe(201);
        const imageBody = (await imageRes.json()) as {
          id: string;
          defaultVariantId?: string | null;
        };
        imageId = imageBody.id;
        expect(typeof imageId).toBe("string");
        expect(typeof imageBody.defaultVariantId).toBe("string");
        const variantId = imageBody.defaultVariantId as string;

        const buildRes = await fetch(`${server.baseUrl}/images/${imageId}/build`, {
          method: "POST",
          headers: authedHeaders(accessToken, { "Content-Type": "application/json" }),
          body: JSON.stringify({ variantId }),
        });
        if (!buildRes.ok) {
          const text = await buildRes.text();
          throw new Error(`image build failed (${buildRes.status}): ${text}`);
        }
        const buildBody = (await buildRes.json()) as {
          variant?: { headImageId?: string | null; currentImageId?: string | null };
        };
        const currentImageId =
          buildBody.variant?.headImageId ?? buildBody.variant?.currentImageId;
        expect(typeof currentImageId).toBe("string");
        builtImageId = (currentImageId ?? "").trim();
        expect(builtImageId.length).toBeGreaterThan(0);

        const modal = new ModalClient();
        const app = await modal.apps.fromName("image-builder", { createIfMissing: true });
        const image = await modal.images.fromId(builtImageId);
        verifySandbox = await modal.sandboxes.create(app, image, {
          command: ["bash", "-lc", "sleep infinity"],
          env: { SECRET_SEED: "x".repeat(32) },
          timeoutMs: 2 * 60_000,
          idleTimeoutMs: 60_000,
        });

        const proc = await verifySandbox.exec(
          ["bash", "-lc", "cat /opt/agent-image/test-markers/build-sandbox-health.exit"],
          { stdout: "pipe", stderr: "pipe", timeoutMs: 10_000 },
        );
        const [exitCode, stdout, stderr] = await Promise.all([
          proc.wait(),
          proc.stdout.readText(),
          proc.stderr.readText(),
        ]);
        expect(exitCode).toBe(0);
        expect(stderr.trim()).toBe("");

        const curlExitCode = Number.parseInt(stdout.trim(), 10);
        expect(Number.isFinite(curlExitCode)).toBe(true);
        // Build sandbox is not expected to run agent API on 127.0.0.1:48213.
        expect(curlExitCode).not.toBe(0);
      } finally {
        process.env.AGENT_BASE_IMAGE_DOCKERFILE = prevDockerfile;
        process.env.AGENT_BASE_IMAGE_CONTEXT_DIR = prevContext;

        if (verifySandbox) {
          await terminateAgentSandbox({ sandboxId: verifySandbox.sandboxId }).catch(() => {});
        }
        if (imageId) {
          await deleteImage(imageId).catch(() => {});
        }
      }
    },
    20 * 60 * 1000,
  );
});
