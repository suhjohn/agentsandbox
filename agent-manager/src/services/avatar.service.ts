import { env } from "../env";
import { ModalVolumeClient } from "../clients/modal";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const AVATAR_CONTENT_TYPES = new Map<string, string>([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["avif", "image/avif"],
]);

let avatarVolumeClient: ModalVolumeClient | null = null;

function getAvatarVolumeClient(): ModalVolumeClient {
  if (avatarVolumeClient) return avatarVolumeClient;

  const volumeName = (env.MODAL_STATIC_FILES_VOLUME ?? "").trim();
  if (volumeName.length === 0) {
    throw new Error("MODAL_STATIC_FILES_VOLUME is not configured");
  }

  avatarVolumeClient = new ModalVolumeClient({
    volumeName,
    environment: env.MODAL_STATIC_FILES_ENVIRONMENT,
  });
  return avatarVolumeClient;
}

export function isAvatarStorageConfigured(): boolean {
  return (env.MODAL_STATIC_FILES_VOLUME ?? "").trim().length > 0;
}

export async function uploadGithubAvatar(input: {
  readonly userId: string;
  readonly avatarUrl: string;
}): Promise<string> {
  const response = await fetch(input.avatarUrl);
  if (!response.ok) {
    throw new Error(`GitHub avatar fetch failed (${response.status})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error("GitHub avatar response was empty");
  }
  if (bytes.byteLength > MAX_AVATAR_BYTES) {
    throw new Error("GitHub avatar is too large");
  }

  const extension = extensionForContentType(
    response.headers.get("content-type"),
    input.avatarUrl,
  );
  const remotePath = buildAvatarPath(input.userId, "github", extension);

  await getAvatarVolumeClient().putBytes({
    data: bytes,
    remotePath,
    overwrite: true,
  });

  return remotePath;
}

export async function uploadCustomAvatar(input: {
  readonly userId: string;
  readonly file: File;
}): Promise<string> {
  const contentType = normalizeContentType(input.file.type);
  if (!contentType) {
    throw new Error("Unsupported avatar image type");
  }
  if (input.file.size <= 0) {
    throw new Error("Avatar image is empty");
  }
  if (input.file.size > MAX_AVATAR_BYTES) {
    throw new Error("Avatar image is too large");
  }

  const remotePath = buildAvatarPath(
    input.userId,
    "custom",
    extensionForContentType(contentType),
  );

  await getAvatarVolumeClient().putBytes({
    data: input.file,
    remotePath,
    overwrite: true,
  });

  return remotePath;
}

export async function deleteAvatarPath(path: string | null | undefined): Promise<void> {
  const normalized = normalizeStoredAvatarPath(path);
  if (!normalized) return;
  if (!isAvatarStorageConfigured()) return;
  try {
    await getAvatarVolumeClient().remove({ remotePath: normalized });
  } catch {
    // Ignore missing or already-deleted files.
  }
}

export async function readAvatar(path: string): Promise<{
  readonly bytes: Uint8Array;
  readonly contentType: string;
}> {
  const normalized = normalizeStoredAvatarPath(path);
  if (!normalized) {
    throw new Error("Avatar path is required");
  }

  const bytes = await getAvatarVolumeClient().getBytes({ remotePath: normalized });
  return {
    bytes,
    contentType: contentTypeForPath(normalized),
  };
}

export function isGithubAvatarPath(path: string | null | undefined): boolean {
  const normalized = normalizeStoredAvatarPath(path);
  return normalized ? /\/github\.[a-z0-9]+$/i.test(normalized) : false;
}

export function contentTypeForPath(path: string): string {
  const match = path.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  const extension = match?.[1] ?? "";
  return AVATAR_CONTENT_TYPES.get(extension) ?? "application/octet-stream";
}

export function buildGithubAvatarUrl(githubId: string): string {
  const trimmed = githubId.trim();
  if (trimmed.length === 0) {
    throw new Error("GitHub id is required");
  }
  return `https://avatars.githubusercontent.com/u/${encodeURIComponent(trimmed)}`;
}

function buildAvatarPath(
  userId: string,
  kind: "github" | "custom",
  extension: string,
): string {
  return `avatars/${userId}/${kind}.${extension}`;
}

function extensionForContentType(
  contentType: string | null | undefined,
  fallbackUrl?: string,
): string {
  const normalized = normalizeContentType(contentType);
  if (normalized) {
    const match = [...AVATAR_CONTENT_TYPES.entries()].find(
      ([, value]) => value === normalized,
    );
    if (match) return match[0];
  }

  if (fallbackUrl) {
    try {
      const pathname = new URL(fallbackUrl).pathname.toLowerCase();
      const urlMatch = pathname.match(/\.([a-z0-9]+)$/);
      if (urlMatch?.[1] && AVATAR_CONTENT_TYPES.has(urlMatch[1])) {
        return urlMatch[1];
      }
    } catch {
      // Ignore invalid URL fallbacks.
    }
  }

  return "png";
}

function normalizeContentType(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return [...AVATAR_CONTENT_TYPES.values()].includes(normalized)
    ? normalized
    : null;
}

function normalizeStoredAvatarPath(path: string | null | undefined): string | null {
  if (typeof path !== "string") return null;
  const trimmed = path.trim().replace(/^\/+/, "");
  if (trimmed.length === 0) return null;
  return trimmed;
}
