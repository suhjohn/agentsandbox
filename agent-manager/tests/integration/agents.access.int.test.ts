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
      email: `agents-access-${runId}@company.com`,
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

describe("/agents/:agentId/access (integration)", () => {
  let server: ServerInfo;
  let healthServer: ServerInfo;
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

    const health = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health")
          return new Response("ok", { status: 200 });
        if (url.pathname === "/session" && req.method === "POST") {
          return new Response("ok", { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    healthServer = {
      baseUrl: `http://127.0.0.1:${health.port}`,
      stop: () => health.stop(true),
    };
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) {
      await fn();
    }
    healthServer.stop();
    server.stop();
    vi.restoreAllMocks();
  });

  it("reuses tunnels from ensureSandboxRunning (doesn't re-fetch tunnels in the handler)", async () => {
    const { userId, accessToken } = await registerUser(server.baseUrl);

    const image = await createImage({
      name: `access test image ${new Date().toISOString()}`,
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

    const sandboxSpy = vi
      .spyOn(sandboxService, "ensureAgentSandbox")
      .mockResolvedValue({
        tunnels: {
          openVscodeUrl: "https://openvscode.example.com/",
          noVncUrl: "https://novnc.example.com/vnc.html",
          agentApiUrl: healthServer.baseUrl,
        },
        sandboxAccessToken: "sandbox-access-token",
        sandbox: { sandboxId } as unknown as any,
      });

    const res = await fetch(`${server.baseUrl}/agents/${agent.id}/access`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      openVscodeUrl: string;
      noVncUrl: string;
      agentApiUrl: string;
      agentSessionId: string;
      agentAuthToken: string;
      agentAuthExpiresInSeconds: number;
    };

    expect(body.agentApiUrl).toBe(healthServer.baseUrl);
    expect(body.openVscodeUrl).toContain("tkn=");
    expect(body.noVncUrl).toContain("password=");

    expect(sandboxSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when sandbox access fails", async () => {
    const { userId, accessToken } = await registerUser(server.baseUrl);

    const image = await createImage({
      name: `access restart image ${new Date().toISOString()}`,
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

    vi.spyOn(sandboxService, "ensureAgentSandbox").mockRejectedValue(
      new Error("boom"),
    );

    const res = await fetch(`${server.baseUrl}/agents/${agent.id}/access`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(502);
  });

});
