import "../setup.test";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { app } from "../../src/app";
import { deleteImage } from "../../src/services/image.service";

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
      email: `images-archive-delete-${label}-${runId}@company.com`,
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

describe("images archive/delete lifecycle (integration)", () => {
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

  it("requires archiving before delete, supports unarchive, then allows hard delete once archived", async () => {
    const user = await registerUser(server.baseUrl, "lifecycle");

    const createRes = await fetch(`${server.baseUrl}/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "archive-delete lifecycle image" }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };
    cleanup.push(async () => {
      await deleteImage(created.id).catch(() => {});
    });

    const activeListBeforeArchiveRes = await fetch(`${server.baseUrl}/images`, {
      method: "GET",
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    expect(activeListBeforeArchiveRes.status).toBe(200);
    const activeListBeforeArchiveBody = (await activeListBeforeArchiveRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(activeListBeforeArchiveBody.data.some((row) => row.id === created.id)).toBe(
      true,
    );

    const archivedListBeforeArchiveRes = await fetch(
      `${server.baseUrl}/images?archived=true`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${user.accessToken}` },
      },
    );
    expect(archivedListBeforeArchiveRes.status).toBe(200);
    const archivedListBeforeArchiveBody =
      (await archivedListBeforeArchiveRes.json()) as {
        data: Array<{ id: string }>;
      };
    expect(
      archivedListBeforeArchiveBody.data.some((row) => row.id === created.id),
    ).toBe(false);

    const deleteActiveRes = await fetch(
      `${server.baseUrl}/images/${created.id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${user.accessToken}` },
      },
    );
    expect(deleteActiveRes.status).toBe(400);
    const deleteActiveBody = (await deleteActiveRes.json()) as {
      error?: string;
    };
    expect(deleteActiveBody.error).toBe("Image must be archived before deletion");

    const archiveRes = await fetch(`${server.baseUrl}/images/${created.id}/archive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    expect(archiveRes.status).toBe(200);
    const archived = (await archiveRes.json()) as { deletedAt?: string | null };
    expect(typeof archived.deletedAt).toBe("string");

    const archivedListAfterArchiveRes = await fetch(
      `${server.baseUrl}/images?archived=true`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${user.accessToken}` },
      },
    );
    expect(archivedListAfterArchiveRes.status).toBe(200);
    const archivedListAfterArchiveBody = (await archivedListAfterArchiveRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(
      archivedListAfterArchiveBody.data.some((row) => row.id === created.id),
    ).toBe(true);

    const unarchiveRes = await fetch(
      `${server.baseUrl}/images/${created.id}/unarchive`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${user.accessToken}` },
      },
    );
    expect(unarchiveRes.status).toBe(200);
    const unarchived = (await unarchiveRes.json()) as {
      deletedAt?: string | null;
    };
    expect(unarchived.deletedAt ?? null).toBeNull();

    const activeListAfterUnarchiveRes = await fetch(`${server.baseUrl}/images`, {
      method: "GET",
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    expect(activeListAfterUnarchiveRes.status).toBe(200);
    const activeListAfterUnarchiveBody = (await activeListAfterUnarchiveRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(
      activeListAfterUnarchiveBody.data.some((row) => row.id === created.id),
    ).toBe(true);

    const rearchiveRes = await fetch(
      `${server.baseUrl}/images/${created.id}/archive`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${user.accessToken}` },
      },
    );
    expect(rearchiveRes.status).toBe(200);

    const deleteArchivedRes = await fetch(
      `${server.baseUrl}/images/${created.id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${user.accessToken}` },
      },
    );
    expect(deleteArchivedRes.status).toBe(200);
    const deleteArchivedBody = (await deleteArchivedRes.json()) as { ok: boolean };
    expect(deleteArchivedBody.ok).toBe(true);

    const getAfterDeleteRes = await fetch(`${server.baseUrl}/images/${created.id}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    expect(getAfterDeleteRes.status).toBe(404);
  });

  it("persists runScript separately from setupScript across create, get, and update", async () => {
    const user = await registerUser(server.baseUrl, "scripts");
    const setupScript = ["set -euo pipefail", "echo setup"].join("\n");
    const runScript = ["set -euo pipefail", "echo run"].join("\n");

    const createRes = await fetch(`${server.baseUrl}/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "script persistence image",
        setupScript,
        runScript,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      setupScript?: string | null;
      runScript?: string | null;
    };
    cleanup.push(async () => {
      await deleteImage(created.id).catch(() => {});
    });
    expect(created.setupScript).toBe(setupScript);
    expect(created.runScript).toBe(runScript);

    const getRes = await fetch(`${server.baseUrl}/images/${created.id}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as {
      setupScript?: string | null;
      runScript?: string | null;
    };
    expect(fetched.setupScript).toBe(setupScript);
    expect(fetched.runScript).toBe(runScript);

    const nextRunScript = ["set -euo pipefail", "echo run changed"].join("\n");
    const patchRes = await fetch(`${server.baseUrl}/images/${created.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ runScript: nextRunScript }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as {
      setupScript?: string | null;
      runScript?: string | null;
    };
    expect(patched.setupScript).toBe(setupScript);
    expect(patched.runScript).toBe(nextRunScript);
  });
});
