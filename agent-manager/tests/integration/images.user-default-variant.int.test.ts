import "../setup.test";
import { afterAll, beforeAll, describe, expect, it, vi } from "bun:test";
import { app } from "../../src/app";
import {
  createImage,
  createImageVariant,
  deleteImage,
} from "../../src/services/image.service";
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
      email: `image-user-default-${runId}@company.com`,
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

describe("User image default variant overrides (integration)", () => {
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

  it("uses the user's default variant override for image detail and agent sandbox creation", async () => {
    const { userId, accessToken } = await registerUser(server.baseUrl);
    const image = await createImage({
      name: `user default image ${new Date().toISOString()}`,
      createdBy: userId,
    });
    cleanup.push(async () => {
      await deleteImage(image.id);
    });

    const personalVariant = await createImageVariant({
      imageId: image.id,
      name: "My Variant",
      scope: "personal",
      ownerUserId: userId,
      activeImageId: "ghcr.io/example/my-override-active:latest",
      draftImageId: "ghcr.io/example/my-override-draft:latest",
    });
    expect(personalVariant).not.toBeNull();

    const setRes = await fetch(
      `${server.baseUrl}/images/${image.id}/variants/${personalVariant!.id}/user-default`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    expect(setRes.status).toBe(200);

    const imageRes = await fetch(`${server.baseUrl}/images/${image.id}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    expect(imageRes.status).toBe(200);
    const imageBody = (await imageRes.json()) as {
      defaultVariantId?: string | null;
      userDefaultVariantId?: string | null;
      effectiveDefaultVariantId?: string | null;
    };
    expect(imageBody.defaultVariantId).toBe(image.defaultVariantId);
    expect(imageBody.userDefaultVariantId).toBe(personalVariant!.id);
    expect(imageBody.effectiveDefaultVariantId).toBe(personalVariant!.id);

    const ensureAgentSandboxSpy = vi
      .spyOn(sandboxService, "ensureAgentSandbox")
      .mockResolvedValue({
        sandboxId: `sb-${crypto.randomUUID()}`,
        tunnels: {
          openVscodeUrl: "https://openvscode.example.com/",
          noVncUrl: "https://novnc.example.com/",
          agentApiUrl: "https://agent.example.com/",
        },
        sandboxAccessToken: "sandbox-access-token",
        sandbox: { sandboxId: `sb-${crypto.randomUUID()}` } as unknown as any,
      });

    const agentRes = await fetch(`${server.baseUrl}/agents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ imageId: image.id }),
    });
    expect(agentRes.status).toBe(201);
    expect(ensureAgentSandboxSpy).toHaveBeenCalledTimes(1);
    expect(ensureAgentSandboxSpy.mock.calls[0]?.[0]).toMatchObject({
      imageId: personalVariant!.activeImageId,
    });

    const clearRes = await fetch(`${server.baseUrl}/images/${image.id}/user-default`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    expect(clearRes.status).toBe(200);

    const clearedImageRes = await fetch(`${server.baseUrl}/images/${image.id}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    expect(clearedImageRes.status).toBe(200);
    const clearedImageBody = (await clearedImageRes.json()) as {
      defaultVariantId?: string | null;
      userDefaultVariantId?: string | null;
      effectiveDefaultVariantId?: string | null;
    };
    expect(clearedImageBody.userDefaultVariantId).toBeNull();
    expect(clearedImageBody.effectiveDefaultVariantId).toBe(
      image.defaultVariantId,
    );
  });
});
