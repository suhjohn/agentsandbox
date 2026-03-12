import "../setup.test";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { app } from "../../src/app";
import { createAgent, deleteAgent } from "../../src/services/agent.service";
import { createImage, deleteImage } from "../../src/services/image.service";

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
      email: `api-keys-${runId}@company.com`,
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

describe("API keys (integration)", () => {
  let server: ServerInfo;
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
    server.stop();
  });

  it("allows external API-key calls with an exact route permission", async () => {
    const { accessToken } = await registerUser(server.baseUrl);

    const createRes = await fetch(`${server.baseUrl}/api-keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "users-me",
        scopes: ["GET /users/me"],
      }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as { key: string };

    const meRes = await fetch(`${server.baseUrl}/users/me`, {
      headers: {
        "X-API-Key": createBody.key,
      },
    });
    expect(meRes.status).toBe(200);
  });

  it("rejects agent-bound API keys for a different agent id", async () => {
    const { userId, accessToken } = await registerUser(server.baseUrl);

    const image = await createImage({
      name: `api-key-agent-bound ${new Date().toISOString()}`,
      createdBy: userId,
    });
    cleanup.push(async () => {
      await deleteImage(image.id);
    });

    const agentA = await createAgent({
      imageId: image.id,
      createdBy: userId,
    });
    const agentB = await createAgent({
      imageId: image.id,
      createdBy: userId,
    });
    cleanup.push(async () => {
      await deleteAgent(agentA.id);
      await deleteAgent(agentB.id);
    });

    const createRes = await fetch(`${server.baseUrl}/api-keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "bound-key",
        agentId: agentA.id,
        scopes: ["GET /agents/:agentId/access"],
      }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as { key: string };

    const accessRes = await fetch(`${server.baseUrl}/agents/${agentB.id}/access`, {
      headers: {
        "X-API-Key": createBody.key,
      },
    });
    expect(accessRes.status).toBe(403);
  });
});
