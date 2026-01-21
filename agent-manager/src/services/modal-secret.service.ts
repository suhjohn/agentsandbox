import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type ModalSecretUpsertInput = {
  readonly name: string;
  readonly entries: Record<string, string>;
  readonly modalTokenId?: string;
  readonly modalTokenSecret?: string;
  readonly cwd?: string;
};

function getNonEmptyEnv(key: string): string | null {
  const value = process.env[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireNonEmpty(value: string | null, label: string): string {
  if (!value) throw new Error(`Missing required value: ${label}`);
  return value;
}

function defaultAgentManagerCwd(): string {
  // agent-manager/src/services -> agent-manager
  return resolve(import.meta.dir, "../..");
}

function modalCommandAndArgs(
  modalArgs: readonly string[],
): { readonly command: string; readonly args: readonly string[] } {
  // Prefer `uv run modal` for consistency with local dev + CI images.
  if (Bun.which("uv")) {
    return { command: "uv", args: ["run", "modal", ...modalArgs] };
  }
  return { command: "modal", args: [...modalArgs] };
}

function isValidSecretEntryKey(key: string): boolean {
  // Modal CLI expects KEY=VALUE args. Keep keys simple and unambiguous.
  if (key.length === 0) return false;
  if (key.includes("=")) return false;
  if (key.includes("\0")) return false;
  return true;
}

function isValidSecretEntryValue(value: string): boolean {
  // Prevent accidental NUL injection; otherwise allow arbitrary strings.
  return !value.includes("\0");
}

export async function upsertModalSecret(input: ModalSecretUpsertInput): Promise<void> {
  const name = input.name.trim();
  if (name.length === 0) throw new Error("Secret name must be non-empty");

  const entries = input.entries ?? {};
  const entryPairs = Object.entries(entries);
  if (entryPairs.length === 0) {
    throw new Error("Secret env must include at least one entry");
  }
  for (const [key, value] of entryPairs) {
    if (!isValidSecretEntryKey(key)) {
      throw new Error(`Invalid env key: ${JSON.stringify(key)}`);
    }
    if (typeof value !== "string") {
      throw new Error(`Invalid env value type for key: ${JSON.stringify(key)}`);
    }
    if (!isValidSecretEntryValue(value)) {
      throw new Error(`Invalid env value for key: ${JSON.stringify(key)}`);
    }
  }

  const modalTokenId = requireNonEmpty(
    input.modalTokenId?.trim() ?? getNonEmptyEnv("MODAL_TOKEN_ID"),
    "MODAL_TOKEN_ID",
  );
  const modalTokenSecret = requireNonEmpty(
    input.modalTokenSecret?.trim() ?? getNonEmptyEnv("MODAL_TOKEN_SECRET"),
    "MODAL_TOKEN_SECRET",
  );

  const tempDir = await mkdtemp(join(tmpdir(), "modal-secret-"));
  const tempJsonPath = join(tempDir, "entries.json");

  try {
    await chmod(tempDir, 0o700);
    await writeFile(tempJsonPath, JSON.stringify(entries), {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(tempJsonPath, 0o600);

    const args = [
      "secret",
      "create",
      name,
      "--from-json",
      tempJsonPath,
      "--force",
    ];

    const { command, args: commandArgs } = modalCommandAndArgs(args);
    const proc = Bun.spawn([command, ...commandArgs], {
      cwd: input.cwd ?? defaultAgentManagerCwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        MODAL_TOKEN_ID: modalTokenId,
        MODAL_TOKEN_SECRET: modalTokenSecret,
      },
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      // Avoid returning stdout/stderr since it can contain secret values.
      // Keep a minimal diagnostic in the thrown error.
      const hasOutput = stdout.trim().length > 0 || stderr.trim().length > 0;
      throw new Error(
        hasOutput
          ? `Modal secret upsert failed (exit ${exitCode}).`
          : `Modal secret upsert failed (exit ${exitCode}) with no output.`,
      );
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
