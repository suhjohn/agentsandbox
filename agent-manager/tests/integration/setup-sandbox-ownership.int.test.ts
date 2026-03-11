import "../setup.test";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "bun:test";
import { app } from "../../src/app";
import { createImage, deleteImage } from "../../src/services/image.service";
import * as sandboxService from "../../src/services/sandbox.service";

type ServerInfo = {
  readonly baseUrl: string;
  readonly stop: () => void;
};

async function registerUser(
  baseUrl: string,
  label: string,
): Promise<{ readonly userId: string; readonly accessToken: string }> {
  const runId = crypto.randomUUID();
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `User ${label}`,
      email: `setup-sandbox-${label}-${runId}@company.com`,
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

describe("setup sandbox ownership guard (integration)", () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) {
      await fn();
    }
    server.stop();
    vi.restoreAllMocks();
  });

  it("returns 404 for close when setup sandbox belongs to another user", async () => {
    const owner = await registerUser(server.baseUrl, "owner-close");
    const caller = await registerUser(server.baseUrl, "caller-close");

    const image = await createImage({
      name: `setup ownership close ${new Date().toISOString()}`,
      createdBy: owner.userId,
    });
    cleanup.push(async () => {
      await deleteImage(image.id);
    });

    const sandboxId = "sb-owned-by-other-user-close";
    const variantId = crypto.randomUUID();
    vi.spyOn(sandboxService, "getImageSetupSandboxSession").mockReturnValue({
      sandboxId,
      imageId: image.id,
      variantId,
      userId: owner.userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const closeSpy = vi.spyOn(sandboxService, "closeSetupSandbox").mockResolvedValue({
      baseImageId: "im-base",
      draftImageId: "im-head",
      variantId,
    });

    const res = await fetch(
      `${server.baseUrl}/images/${image.id}/setup-sandbox/${sandboxId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${caller.accessToken}` },
      },
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Setup sandbox not found");
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("returns 404 for terminal connect when setup sandbox belongs to another user", async () => {
    const owner = await registerUser(server.baseUrl, "owner-terminal");
    const caller = await registerUser(server.baseUrl, "caller-terminal");

    const sandboxId = "sb-owned-by-other-user-terminal";
    vi.spyOn(sandboxService, "getImageSetupSandboxSession").mockReturnValue({
      sandboxId,
      imageId: crypto.randomUUID(),
      variantId: crypto.randomUUID(),
      userId: owner.userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const terminalSpy = vi
      .spyOn(sandboxService, "getSetupSandboxTerminalAccess")
      .mockResolvedValue({
        sandboxId,
        terminalUrl: "https://example.com/terminal",
        wsUrl: "wss://example.com/terminal",
        authToken: "token",
        authTokenExpiresInSeconds: 300,
      });

    const res = await fetch(`${server.baseUrl}/terminal/connect`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${caller.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targetType: "setupSandbox",
        targetId: sandboxId,
      }),
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Setup sandbox not found");
    expect(terminalSpy).not.toHaveBeenCalled();
  });
});
