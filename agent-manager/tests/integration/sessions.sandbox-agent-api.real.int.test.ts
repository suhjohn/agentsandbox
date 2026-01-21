import "../setup.test";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { startServer } from "../../src/server";

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
      email: `sandbox-agent-api-${runId}@company.com`,
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

async function waitFor<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  intervalMs: number,
): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Timed out waiting for operation");
}

describe("Sessions sandbox agent API (real)", () => {
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
    "builds from a registry base image, starts sandbox, and can send a message via the sandbox API",
    async () => {
      const modalTokenId = process.env.MODAL_TOKEN_ID?.trim() ?? "";
      const modalTokenSecret = process.env.MODAL_TOKEN_SECRET?.trim() ?? "";
      const openaiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
      const baseImageRef = process.env.AGENT_BASE_IMAGE_REF?.trim() ?? "";
      const dockerfilePath = process.env.AGENT_BASE_IMAGE_DOCKERFILE?.trim() ?? "";
      if (!modalTokenId || !modalTokenSecret || !openaiKey) {
        // Not a failure in environments without Modal or OpenAI credentials.
        return;
      }
      if (!baseImageRef && !dockerfilePath) {
        // Not a failure in environments without a configured base image source.
        return;
      }

      const { accessToken } = await registerUser(server.baseUrl);
      const runId = crypto.randomUUID();

      const imageRes = await fetch(`${server.baseUrl}/images`, {
        method: "POST",
        headers: authedHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: `Agent base image (test ${new Date().toISOString()})`,
          visibility: "private",
          setupScript: "",
        }),
      });
      expect(imageRes.status).toBe(201);
      const imageBody = (await imageRes.json()) as {
        id: string;
        defaultVariantId?: string | null;
      };
      expect(typeof imageBody.id).toBe("string");
      expect(typeof imageBody.defaultVariantId).toBe("string");
      const variantId = imageBody.defaultVariantId as string;

      const built = await waitFor(
        async () => {
          const res = await fetch(`${server.baseUrl}/images/${imageBody.id}/build`, {
            method: "POST",
            headers: authedHeaders(accessToken, { "Content-Type": "application/json" }),
            body: JSON.stringify({ variantId }),
          });
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`image build failed (${res.status}): ${text}`);
          }
          return (await res.json()) as {
            variant?: { headImageId?: string | null; currentImageId?: string | null };
          };
        },
        15 * 60 * 1000,
        3_000,
      );
      const builtImageId = built.variant?.headImageId ?? built.variant?.currentImageId;
      expect(typeof builtImageId).toBe("string");

      const sessionRes = await fetch(`${server.baseUrl}/agents`, {
        method: "POST",
        headers: authedHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ imageId: imageBody.id, name: `Sandbox agent API test ${runId}` }),
      });
      expect(sessionRes.status).toBe(201);
      const session = (await sessionRes.json()) as { id: string };
      expect(typeof session.id).toBe("string");

      try {
        const access = await waitFor(
          async () => {
            const res = await fetch(`${server.baseUrl}/agents/${session.id}/access`, {
              headers: authedHeaders(accessToken),
            });
            if (!res.ok) {
              const text = await res.text();
              throw new Error(`access failed (${res.status}): ${text}`);
            }
            return (await res.json()) as {
              agentApiUrl: string;
              agentSessionId: string;
              agentAuthToken: string;
            };
          },
          2 * 60 * 1000,
          2_000,
        );

        const healthRes = await fetch(`${access.agentApiUrl}/health`);
        expect(healthRes.status).toBe(200);

        const sessionCreateRes = await fetch(`${access.agentApiUrl}/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Auth": `Bearer ${access.agentAuthToken}`,
          },
          body: JSON.stringify({
            id: access.agentSessionId,
            agentId: session.id,
          }),
        });
        expect([200, 201]).toContain(sessionCreateRes.status);

        const sessionGetRes = await fetch(`${access.agentApiUrl}/session/${access.agentSessionId}`, {
          headers: { "X-Agent-Auth": `Bearer ${access.agentAuthToken}` },
        });
        expect(sessionGetRes.status).toBe(200);

        const msgRes = await fetch(`${access.agentApiUrl}/session/${access.agentSessionId}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Auth": `Bearer ${access.agentAuthToken}`,
          },
          body: JSON.stringify({ input: [{ type: "text", text: "What files do you have" }] }),
        });
        expect(msgRes.status).toBe(200);
        const msgBody = (await msgRes.json()) as { success?: boolean; sessionId?: string };
        expect(typeof msgBody.success).toBe("boolean");
        expect(msgBody.sessionId).toBe(access.agentSessionId);

        const newSessionId = randomBytes(16).toString("hex");
        const newSessionCreateRes = await fetch(`${access.agentApiUrl}/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Auth": `Bearer ${access.agentAuthToken}`,
          },
          body: JSON.stringify({
            id: newSessionId,
            agentId: session.id,
          }),
        });
        expect([200, 201]).toContain(newSessionCreateRes.status);

        const newSessionGetRes = await fetch(`${access.agentApiUrl}/session/${newSessionId}`, {
          headers: { "X-Agent-Auth": `Bearer ${access.agentAuthToken}` },
        });
        expect(newSessionGetRes.status).toBe(200);

        const newSessionMsgRes = await fetch(`${access.agentApiUrl}/session/${newSessionId}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Auth": `Bearer ${access.agentAuthToken}`,
          },
          body: JSON.stringify({ input: [{ type: "text", text: "Say hello" }] }),
        });
        expect(newSessionMsgRes.status).toBe(200);
        const newSessionMsgBody = (await newSessionMsgRes.json()) as {
          success?: boolean;
          sessionId?: string;
        };
        expect(typeof newSessionMsgBody.success).toBe("boolean");
        expect(newSessionMsgBody.sessionId).toBe(newSessionId);
      } finally {
        await fetch(`${server.baseUrl}/agents/${session.id}`, {
          method: "DELETE",
          headers: authedHeaders(accessToken),
        });
      }
    },
    20 * 60 * 1000,
  );
});
