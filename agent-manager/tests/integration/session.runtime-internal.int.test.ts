import "../setup.test";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { app } from "../../src/app";
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
      email: `session-runtime-internal-${runId}@company.com`,
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

describe("Runtime internal auth -> manager session sync (integration)", () => {
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

  it("accepts PUT /session/:id with the runtime internal secret and matching X-Agent-Id", async () => {
    const { userId } = await registerUser(server.baseUrl);

    const image = await createImage({
      name: `session runtime internal image ${new Date().toISOString()}`,
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

    const runtimeInternalSecret = crypto.randomUUID().replaceAll("-", "");
    await setAgentSandbox({
      id: agent.id,
      currentSandboxId: `sb-${crypto.randomUUID()}`,
      runtimeInternalSecret,
    });

    const sessionId = crypto.randomUUID().replaceAll("-", "");
    const res = await fetch(`${server.baseUrl}/session/${sessionId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Internal-Auth": runtimeInternalSecret,
        "X-Agent-Id": agent.id,
      },
      body: JSON.stringify({
        agentId: agent.id,
        status: "processing",
        harness: "codex",
        modelReasoningEffort: "deliberate",
        title: "Synced session",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session: {
        id: string;
        agentId: string;
        harness: string;
        modelReasoningEffort: string | null;
        title: string | null;
      };
    };
    expect(body.session.id).toBe(sessionId);
    expect(body.session.agentId).toBe(agent.id);
    expect(body.session.harness).toBe("codex");
    expect(body.session.modelReasoningEffort).toBe("deliberate");
    expect(body.session.title).toBe("Synced session");
  });

  it("rejects runtime internal auth when X-Agent-Id does not match the authenticated runtime", async () => {
    const { userId } = await registerUser(server.baseUrl);

    const image = await createImage({
      name: `session runtime mismatch image ${new Date().toISOString()}`,
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

    const runtimeInternalSecret = crypto.randomUUID().replaceAll("-", "");
    await setAgentSandbox({
      id: agent.id,
      currentSandboxId: `sb-${crypto.randomUUID()}`,
      runtimeInternalSecret,
    });

    const sessionId = crypto.randomUUID().replaceAll("-", "");
    const res = await fetch(`${server.baseUrl}/session/${sessionId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Internal-Auth": runtimeInternalSecret,
        "X-Agent-Id": crypto.randomUUID(),
      },
      body: JSON.stringify({
        agentId: agent.id,
        status: "processing",
        harness: "codex",
      }),
    });

    expect(res.status).toBe(401);
  });
});
