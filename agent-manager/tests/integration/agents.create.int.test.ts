import "../setup.test";
import { afterAll, beforeAll, describe, expect, it, vi } from "bun:test";
import { app } from "../../src/app";
import { createImage, deleteImage } from "../../src/services/image.service";
import * as imageService from "../../src/services/image.service";
import * as sandboxService from "../../src/services/sandbox.service";

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
      email: `agents-create-${runId}@company.com`,
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

describe("POST /agents (integration)", () => {
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
    vi.restoreAllMocks();
  });

  it("generates a uuidv7 id and default name when creating an agent", async () => {
    const { userId, accessToken } = await registerUser(server.baseUrl);
    const image = await createImage({
      name: `create test image ${new Date().toISOString()}`,
      createdBy: userId,
    });
    cleanup.push(async () => {
      await deleteImage(image.id);
    });

    vi.spyOn(imageService, "resolveImageVariantForUser").mockResolvedValue({
      id: image.defaultVariantId as string,
      activeImageId: crypto.randomUUID(),
      draftImageId: crypto.randomUUID(),
    } as Awaited<ReturnType<typeof imageService.resolveImageVariantForUser>>);
    vi.spyOn(sandboxService, "ensureAgentSandbox").mockResolvedValue({
      tunnels: {
        openVscodeUrl: "https://openvscode.example.com/",
        noVncUrl: "https://novnc.example.com/",
        agentApiUrl: "https://agent.example.com/",
      },
      sandboxAccessToken: "sandbox-access-token",
      sandbox: { sandboxId: `sb-${crypto.randomUUID()}` } as unknown as any,
    });

    const res = await fetch(`${server.baseUrl}/agents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ imageId: image.id }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(body.name).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
  });

  it("rejects a client-provided name field", async () => {
    const { accessToken } = await registerUser(server.baseUrl);

    const res = await fetch(`${server.baseUrl}/agents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageId: crypto.randomUUID(),
        name: "should-be-rejected",
      }),
    });

    expect(res.status).toBe(400);
  });
});
