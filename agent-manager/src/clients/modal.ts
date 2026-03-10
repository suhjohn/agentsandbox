import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, posix as pathPosix } from "node:path";
import { tmpdir } from "node:os";
import { ModalClient } from "modal";

const DEFAULT_TIMEOUT_MS = 30_000;

export type ModalVolumeClientOptions = {
  readonly volumeName: string;
  readonly environment?: string;
  readonly cliPath?: string;
  readonly ensureExists?: boolean;
  readonly timeoutMs?: number;
};

export type ModalVolumeListEntry = {
  readonly path: string;
  readonly type: "file" | "directory" | "unknown";
  readonly size?: number;
};

export class ModalVolumeClient {
  readonly volumeName: string;
  readonly environment?: string;
  readonly cliPath: string;
  readonly ensureExists: boolean;
  readonly timeoutMs: number;

  #modal = new ModalClient();
  #ensurePromise: Promise<void> | null = null;

  constructor(options: ModalVolumeClientOptions) {
    const volumeName = options.volumeName.trim();
    if (volumeName.length === 0) {
      throw new Error("Modal volume name is required");
    }

    this.volumeName = volumeName;
    this.environment = normalizeOptionalText(options.environment);
    this.cliPath = normalizeOptionalText(options.cliPath) ?? "modal";
    this.ensureExists = options.ensureExists ?? true;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async putFile(input: {
    readonly localPath: string;
    readonly remotePath: string;
    readonly overwrite?: boolean;
    readonly timeoutMs?: number;
  }): Promise<void> {
    const localPath = input.localPath.trim();
    if (localPath.length === 0) {
      throw new Error("Local file path is required");
    }

    await this.#ensureVolume();

    const args = [
      "volume",
      "put",
      ...(input.overwrite ? ["--force"] : []),
      ...this.#environmentArgs(),
      this.volumeName,
      localPath,
      normalizeRemotePath(input.remotePath),
    ];
    await this.#runCli(args, { timeoutMs: input.timeoutMs });
  }

  async putBytes(input: {
    readonly data: string | Uint8Array | ArrayBuffer | Blob;
    readonly remotePath: string;
    readonly overwrite?: boolean;
    readonly timeoutMs?: number;
  }): Promise<void> {
    const tempDir = await mkdtemp(join(tmpdir(), "modal-volume-put-"));
    const remotePath = normalizeRemotePath(input.remotePath);
    const tempPath = join(tempDir, basename(remotePath));

    try {
      await writeFile(tempPath, await toUint8Array(input.data));
      await this.putFile({
        localPath: tempPath,
        remotePath,
        overwrite: input.overwrite,
        timeoutMs: input.timeoutMs,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async putText(input: {
    readonly text: string;
    readonly remotePath: string;
    readonly overwrite?: boolean;
    readonly timeoutMs?: number;
  }): Promise<void> {
    await this.putBytes({
      data: input.text,
      remotePath: input.remotePath,
      overwrite: input.overwrite,
      timeoutMs: input.timeoutMs,
    });
  }

  async getBytes(input: {
    readonly remotePath: string;
    readonly timeoutMs?: number;
  }): Promise<Uint8Array> {
    await this.#ensureVolume();

    const result = await this.#runCli(
      [
        "volume",
        "get",
        ...this.#environmentArgs(),
        this.volumeName,
        normalizeRemotePath(input.remotePath),
        "-",
      ],
      {
        timeoutMs: input.timeoutMs,
        stdout: "pipe",
      },
    );

    return result.stdoutBytes;
  }

  async getText(input: {
    readonly remotePath: string;
    readonly timeoutMs?: number;
  }): Promise<string> {
    const bytes = await this.getBytes(input);
    return new TextDecoder().decode(bytes);
  }

  async getFile(input: {
    readonly remotePath: string;
    readonly localPath: string;
    readonly overwrite?: boolean;
    readonly timeoutMs?: number;
  }): Promise<void> {
    const localPath = input.localPath.trim();
    if (localPath.length === 0) {
      throw new Error("Local destination path is required");
    }

    await this.#ensureVolume();

    await this.#runCli(
      [
        "volume",
        "get",
        ...(input.overwrite ? ["--force"] : []),
        ...this.#environmentArgs(),
        this.volumeName,
        normalizeRemotePath(input.remotePath),
        localPath,
      ],
      { timeoutMs: input.timeoutMs },
    );
  }

  async remove(input: {
    readonly remotePath: string;
    readonly recursive?: boolean;
    readonly timeoutMs?: number;
  }): Promise<void> {
    await this.#ensureVolume();

    await this.#runCli(
      [
        "volume",
        "rm",
        ...(input.recursive ? ["--recursive"] : []),
        ...this.#environmentArgs(),
        this.volumeName,
        normalizeRemotePath(input.remotePath),
      ],
      { timeoutMs: input.timeoutMs },
    );
  }

  async exists(input: {
    readonly remotePath: string;
    readonly timeoutMs?: number;
  }): Promise<boolean> {
    try {
      await this.getBytes(input);
      return true;
    } catch {
      return false;
    }
  }

  async list(input?: {
    readonly path?: string;
    readonly timeoutMs?: number;
  }): Promise<readonly ModalVolumeListEntry[]> {
    await this.#ensureVolume();

    const result = await this.#runCli(
      [
        "volume",
        "ls",
        "--json",
        ...this.#environmentArgs(),
        this.volumeName,
        normalizeRemotePath(input?.path ?? "/"),
      ],
      { timeoutMs: input?.timeoutMs },
    );

    return parseListResponse(result.stdoutText);
  }

  async readToTempFile(input: {
    readonly remotePath: string;
    readonly timeoutMs?: number;
  }): Promise<{ readonly path: string; readonly cleanup: () => Promise<void> }> {
    const tempDir = await mkdtemp(join(tmpdir(), "modal-volume-get-"));
    const localPath = join(tempDir, basename(normalizeRemotePath(input.remotePath)));

    try {
      await this.getFile({
        remotePath: input.remotePath,
        localPath,
        overwrite: true,
        timeoutMs: input.timeoutMs,
      });
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true });
      throw error;
    }

    return {
      path: localPath,
      cleanup: async () => {
        await rm(tempDir, { recursive: true, force: true });
      },
    };
  }

  async readFile(input: {
    readonly remotePath: string;
    readonly timeoutMs?: number;
  }): Promise<Uint8Array> {
    const temp = await this.readToTempFile(input);
    try {
      return await readFile(temp.path);
    } finally {
      await temp.cleanup();
    }
  }

  async #ensureVolume(): Promise<void> {
    if (!this.ensureExists) return;
    if (this.#ensurePromise) return this.#ensurePromise;

    this.#ensurePromise = (async () => {
      await this.#modal.volumes.fromName(this.volumeName, {
        createIfMissing: true,
        ...(this.environment ? { environment: this.environment } : {}),
      });
    })();

    try {
      await this.#ensurePromise;
    } catch (error) {
      this.#ensurePromise = null;
      throw error;
    }
  }

  #environmentArgs(): readonly string[] {
    return this.environment ? ["--env", this.environment] : [];
  }

  async #runCli(
    args: readonly string[],
    options?: {
      readonly timeoutMs?: number;
      readonly stdout?: "pipe" | "ignore";
    },
  ): Promise<{ readonly stdoutText: string; readonly stdoutBytes: Uint8Array }> {
    const proc = Bun.spawn([this.cliPath, ...args], {
      stdin: "ignore",
      stdout: options?.stdout ?? "pipe",
      stderr: "pipe",
    });

    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => proc.kill("SIGTERM"), timeoutMs);

    const [exitCode, stdoutBuffer, stderrText] = await Promise.all([
      proc.exited,
      options?.stdout === "ignore"
        ? Promise.resolve(new Uint8Array())
        : new Response(proc.stdout).bytes(),
      new Response(proc.stderr).text(),
    ]);

    clearTimeout(timer);

    if (exitCode !== 0) {
      const detail = stderrText.trim();
      throw new Error(
        detail.length > 0
          ? `modal ${args.join(" ")} failed: ${detail}`
          : `modal ${args.join(" ")} failed with exit code ${exitCode}`,
      );
    }

    const stdoutBytes = stdoutBuffer instanceof Uint8Array
      ? stdoutBuffer
      : new Uint8Array(stdoutBuffer);

    return {
      stdoutText: new TextDecoder().decode(stdoutBytes),
      stdoutBytes,
    };
  }
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeRemotePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Remote path is required");
  }

  const isDirectory = trimmed.endsWith("/");
  const stripped = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  if (stripped.length === 0) {
    return "/";
  }

  const segments = stripped.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`Invalid remote path: ${value}`);
  }

  const normalized = pathPosix.join("/", ...segments);
  return isDirectory ? `${normalized}/` : normalized;
}

async function toUint8Array(
  value: string | Uint8Array | ArrayBuffer | Blob,
): Promise<Uint8Array> {
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  return new Uint8Array(value);
}

function parseListResponse(text: string): readonly ModalVolumeListEntry[] {
  const json = JSON.parse(text) as unknown;
  if (!Array.isArray(json)) {
    throw new Error("Unexpected modal volume ls response");
  }

  return json.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new Error("Unexpected modal volume ls item");
    }
    const value = item as Record<string, unknown>;
    const label = readFirstString(value, ["path", "name", "filename"]) ?? "";
    const typeRaw = readFirstString(value, ["type"]) ?? "";
    const sizeRaw = value.size;

    return {
      path: label,
      type:
        typeRaw === "file"
          ? "file"
          : typeRaw === "directory" || typeRaw === "dir"
            ? "directory"
            : "unknown",
      ...(typeof sizeRaw === "number" && Number.isFinite(sizeRaw)
        ? { size: sizeRaw }
        : {}),
    } satisfies ModalVolumeListEntry;
  });
}

function readFirstString(
  value: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw;
    }
  }
  return null;
}
