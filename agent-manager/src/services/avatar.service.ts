import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env";
import { S3ObjectStorageClient } from "../clients/s3";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const AVATAR_CONTENT_TYPES = new Map<string, string>([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["avif", "image/avif"],
]);

type AvatarStorageMode = "local" | "s3";

let avatarS3Client: S3ObjectStorageClient | null = null;

export function isAvatarStorageConfigured(): boolean {
  return true;
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
  const storedPath = buildAvatarPath(input.userId, "github", extension);

  await writeAvatarFile({
    bytes,
    contentType: contentTypeForPath(storedPath),
    path: storedPath,
  });

  return storedPath;
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

  const storedPath = buildAvatarPath(
    input.userId,
    "custom",
    extensionForContentType(contentType),
  );
  const bytes = new Uint8Array(await input.file.arrayBuffer());

  await writeAvatarFile({
    bytes,
    contentType,
    path: storedPath,
  });

  return storedPath;
}

export async function deleteAvatarPath(
  pathValue: string | null | undefined,
): Promise<void> {
  const storedPath = normalizeStoredAvatarPath(pathValue);
  if (!storedPath) return;

  if (getAvatarStorageMode() === "s3") {
    try {
      await getAvatarS3Client().deleteObject(storedPath);
    } catch {
      // Ignore missing or already-deleted files.
    }
    return;
  }

  const absolutePath = resolveLocalAvatarPath(storedPath);
  try {
    await rm(absolutePath, { force: true });
  } catch {
    // Ignore missing or already-deleted files.
  }
}

export async function readAvatar(pathValue: string): Promise<{
  readonly bytes: Uint8Array;
  readonly contentType: string;
}> {
  const storedPath = normalizeStoredAvatarPath(pathValue);
  if (!storedPath) {
    throw new Error("Avatar path is required");
  }

  const bytes =
    getAvatarStorageMode() === "s3"
      ? await getAvatarS3Client().getObject(storedPath)
      : await readFile(resolveLocalAvatarPath(storedPath));

  return {
    bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    contentType: contentTypeForPath(storedPath),
  };
}

export function isGithubAvatarPath(pathValue: string | null | undefined): boolean {
  const storedPath = normalizeStoredAvatarPath(pathValue);
  return storedPath ? /\/github-[^/]+\.[a-z0-9]+$/i.test(storedPath) : false;
}

export function contentTypeForPath(pathValue: string): string {
  const match = pathValue.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
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

async function writeAvatarFile(input: {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
}): Promise<void> {
  if (getAvatarStorageMode() === "s3") {
    await getAvatarS3Client().putObject({
      key: input.path,
      body: input.bytes,
      contentType: input.contentType,
    });
    return;
  }

  const absolutePath = resolveLocalAvatarPath(input.path);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, input.bytes);
}

function getAvatarStorageMode(): AvatarStorageMode {
  return emptyToUndefined(env.STATIC_FILES_S3_BUCKET) ? "s3" : "local";
}

function getAvatarS3Client(): S3ObjectStorageClient {
  if (avatarS3Client) return avatarS3Client;

  const bucket = emptyToUndefined(env.STATIC_FILES_S3_BUCKET);
  if (!bucket) {
    throw new Error("STATIC_FILES_S3_BUCKET is not configured");
  }

  avatarS3Client = new S3ObjectStorageClient({
    bucket,
    region: env.STATIC_FILES_S3_REGION,
    endpoint: env.STATIC_FILES_S3_ENDPOINT,
    accessKeyId: emptyToUndefined(env.STATIC_FILES_S3_ACCESS_KEY_ID),
    secretAccessKey: emptyToUndefined(env.STATIC_FILES_S3_SECRET_ACCESS_KEY),
    forcePathStyle: env.STATIC_FILES_S3_FORCE_PATH_STYLE,
  });
  return avatarS3Client;
}

function buildAvatarPath(
  userId: string,
  kind: "github" | "custom",
  extension: string,
): string {
  return `avatars/${userId}/${kind}-${Date.now()}.${extension}`;
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

function normalizeStoredAvatarPath(pathValue: string | null | undefined): string | null {
  if (typeof pathValue !== "string") return null;

  const trimmed = pathValue.trim().replace(/^\/+/, "");
  if (trimmed.length === 0) return null;

  const normalized = path.posix.normalize(trimmed);
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("Invalid avatar path");
  }

  return normalized;
}

function resolveLocalAvatarPath(storedPath: string): string {
  const localRoot = path.resolve(process.cwd(), env.STATIC_FILES_LOCAL_DIR);
  const absolutePath = path.resolve(localRoot, storedPath);
  const relative = path.relative(localRoot, absolutePath);

  if (
    relative.length === 0 ||
    relative === "." ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Invalid avatar path");
  }

  return absolutePath;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
