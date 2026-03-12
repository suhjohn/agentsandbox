import "../setup.test";
import { describe, it, expect, beforeAll, afterAll, vi } from "bun:test";
import { app } from "../../src/app";
import * as sandboxService from "../../src/services/sandbox.service";
import { createImage, deleteImage } from "../../src/services/image.service";
import {
  createAgent,
  deleteAgent,
  setAgentSandbox,
} from "../../src/services/agent.service";

type ServerInfo = {
  readonly baseUrl: string;
  readonly stop: () => void;
};

async function registerUser(
  baseUrl: string,
): Promise<{ readonly userId: string; readonly accessToken: string }> {
  const runId = crypto.randomUUID();
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "User",
      email: `agents-session-${runId}@company.com`,
      password: "password123",
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    user: { id: string };
    accessToken: string;
  };
  return { userId: body.user.id, accessToken: body.accessToken };
}

describe("POST /agents/:agentId/session (integration)", () => {
  let server: ServerInfo;
  let runtimeServer: ServerInfo;
  const cleanup: Array<() => Promise<void>> = [];

  beforeAll(() => {
    const bunServer = Bun.serve({
      port: 0,
      fetch: app.fetch,
    });
    server = {
      baseUrl: `http://127.0.0.1:${bunServer.port}`,
      stop: () => bunServer.stop(true),
    };
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) {
      await fn();
    }
    runtimeServer?.stop();
    server.stop();
    vi.restoreAllMocks();
  });

  it("creates a runtime session through manager-internal auth and starts the first run", async () => {
    const observed: Array<{
      method: string;
      path: string;
      agentAuth: string | null;
      body: unknown;
    }> = [];

    const runId = "feedfacefeedfacefeedfacefeedface";
    runtimeServer = {
      ...(() => {
        const bunServer = Bun.serve({
          port: 0,
          async fetch(req) {
            const url = new URL(req.url);
            const bodyText = req.method === "POST" ? await req.text() : "";
            observed.push({
              method: req.method,
              path: url.pathname,
              agentAuth: req.headers.get("X-Agent-Auth"),
              body: bodyText.length > 0 ? JSON.parse(bodyText) : null,
            });

            if (url.pathname === "/session" && req.method === "POST") {
              return new Response(JSON.stringify({ id: "ok" }), {
                status: 201,
                headers: { "Content-Type": "application/json" },
              });
            }
            if (/^\/session\/[0-9a-f]{32}\/message$/.test(url.pathname) && req.method === "POST") {
              return new Response(JSON.stringify({ success: true, runId }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }
            return new Response("not found", { status: 404 });
          },
        });
        return {
          baseUrl: `http://127.0.0.1:${bunServer.port}`,
          stop: () => bunServer.stop(true),
        };
      })(),
    };

    const { userId, accessToken } = await registerUser(server.baseUrl);

    const image = await createImage({
      name: `agent session image ${new Date().toISOString()}`,
      createdBy: userId,
    });
    cleanup.push(async () => {
      await deleteImage(image.id);
    });

    const agent = await createAgent({
      imageId: image.id,
      createdBy: userId,
    });
    cleanup.push(async () => {
      await deleteAgent(agent.id);
    });

    const sandboxId = `sb-${crypto.randomUUID()}`;
    await setAgentSandbox({
      id: agent.id,
      currentSandboxId: sandboxId,
    });

    vi.spyOn(sandboxService, "ensureAgentSandbox").mockResolvedValue({
      tunnels: {
        openVscodeUrl: "https://openvscode.example.com/",
        noVncUrl: "https://novnc.example.com/vnc.html",
        agentApiUrl: runtimeServer.baseUrl,
      },
      sandboxAccessToken: "sandbox-access-token",
      sandbox: { sandboxId } as unknown as any,
    });

    const res = await fetch(`${server.baseUrl}/agents/${agent.id}/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "hi",
        title: "Say hi",
        harness: "codex",
        model: "openrouter/qwen-coder",
        modelReasoningEffort: "deliberate",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session: { id: string; runId: string; streamUrl: string; runStreamUrl: string };
    };
    expect(body.session.id).toHaveLength(32);
    expect(body.session.runId).toBe(runId);
    expect(observed).toHaveLength(2);
    expect(observed[0]?.path).toBe("/session");
    expect(observed[1]?.path).toBe(`/session/${body.session.id}/message`);
    expect(observed[0]?.body).toEqual({
      id: body.session.id,
      title: "Say hi",
      harness: "codex",
      model: "openrouter/qwen-coder",
      modelReasoningEffort: "deliberate",
    });
    expect(observed[1]?.body).toEqual({
      input: [{ type: "text", text: "hi" }],
      model: "openrouter/qwen-coder",
      modelReasoningEffort: "deliberate",
    });
    for (const request of observed) {
      expect(request.agentAuth).toMatch(/^Bearer\s+/);
    }
  });
});
