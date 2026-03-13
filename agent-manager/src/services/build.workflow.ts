import { env } from "../env";
import { IMAGE_SHARED_ENV_VAR, IMAGE_SHARED_MOUNT_PATH } from "./image-volume";
import {
  createLineBuffer,
  writeSandboxFileIfMissing,
  resolveModalImage,
  assembleSandboxSecrets,
  createModalSandbox,
  execSandboxTextCommand,
  getImageSharedMount,
  normalizeNullableText,
  safeTerminateSandbox,
  snapshotSandboxFilesystem,
  BuildChunk,
} from "./sandbox-core";

const BUILD_APP_NAME = "image-builder";
const DEFAULT_MODAL_SECRET_NAME = "openinspect-build-secret";
const BUILD_CREATE_TIMEOUT_MS = 5 * 60 * 1000;
const BUILD_SANDBOX_TIMEOUT_MS = 60 * 60 * 1000;
const BUILD_SNAPSHOT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BUILD_LOG_CHARS = 12_000;

function truncateBuildLog(text: string): string {
  if (text.length <= MAX_BUILD_LOG_CHARS) return text;
  return `... (truncated, showing last ${MAX_BUILD_LOG_CHARS} chars)\n${text.slice(
    -MAX_BUILD_LOG_CHARS,
  )}`;
}

export async function runImageBuild(input: {
  readonly imageId: string;
  readonly environmentSecretNames?: readonly string[];
  readonly baseImageId?: string | null;
  readonly modalSecretName?: string;
  readonly onChunk?: (chunk: BuildChunk) => void;
}): Promise<{ readonly builtImageId: string }> {
  const stderrParts: string[] = [];
  const stdoutParts: string[] = [];

  const emit = (chunk: BuildChunk): void => {
    if (chunk.text.length === 0) return;
    if (chunk.source === "stderr") stderrParts.push(chunk.text);
    else stdoutParts.push(chunk.text);
    input.onChunk?.(chunk);
  };

  const logStep = (message: string): void => {
    emit({ source: "stderr", text: `${message}\n` });
  };

  const { image, resolvedImageSource } = await resolveModalImage({
    imageIdOrRef: input.baseImageId ?? env.AGENT_BASE_IMAGE_REF,
  });
  const secretNames = [
    normalizeNullableText(input.modalSecretName) ?? DEFAULT_MODAL_SECRET_NAME,
    ...(input.environmentSecretNames ?? []),
  ];
  const secrets = await assembleSandboxSecrets({
    envVars: {
      AGENT_ID: input.imageId,
      AGENT_RUNTIME_MODE: "server",
      SECRET_SEED: env.SANDBOX_SIGNING_SECRET,
      [IMAGE_SHARED_ENV_VAR]: IMAGE_SHARED_MOUNT_PATH,
    },
    namedSecretNames: secretNames,
    onMissingNamedSecret: (name) => {
      logStep(`Warning: Modal secret not found: ${name}; continuing without it`);
    },
  });
  const handle = await createModalSandbox({
    appName: BUILD_APP_NAME,
    image,
    command: [
      "bash",
      "-lc",
      'mkdir -p "${WORKSPACES_DIR:-/home/agent/workspaces}" && cd "${WORKSPACES_DIR:-/home/agent/workspaces}" && sleep infinity',
    ],
    secrets,
    volumes: await getImageSharedMount({ imageId: input.imageId, readOnly: true }),
    timeoutMs: BUILD_CREATE_TIMEOUT_MS,
  });

  try {
    await writeSandboxFileIfMissing(
      handle.sandbox,
      "/etc/agent-base-image-ref",
      `${resolvedImageSource}\n`,
    );
    await writeSandboxFileIfMissing(
      handle.sandbox,
      "/etc/agent-image-version",
      "unknown\n",
    );

    logStep("Running build sandbox refresh...");
    const setupStdout = createLineBuffer((line) =>
      emit({ source: "stderr", text: `[build:refresh][stdout] ${line}\n` }),
    );
    const setupStderr = createLineBuffer((line) =>
      emit({ source: "stderr", text: `[build:refresh][stderr] ${line}\n` }),
    );
    const { exitCode, stderr } = await execSandboxTextCommand(
      handle.sandbox,
      [
        "bash",
        "-lc",
        'set -euo pipefail; cd /opt/agentsandbox/agent-go; git fetch origin; git reset --hard origin/main; git clean -fd; ./docker/setup.sh; if [[ -r /shared/image/hooks/build.sh ]]; then bash /shared/image/hooks/build.sh; fi',
      ],
      {
        timeoutMs: BUILD_SANDBOX_TIMEOUT_MS,
        onStdoutChunk: (chunk) => setupStdout.push(chunk),
        onStderrChunk: (chunk) => setupStderr.push(chunk),
      },
    );
    setupStdout.flush();
    setupStderr.flush();
    if (exitCode !== 0) {
      throw new Error(
        `build sandbox refresh failed (exit ${exitCode}).${
          stderr.trim().length > 0 ? `\n--- stderr ---\n${stderr}` : ""
        }`,
      );
    }

    logStep("Snapshotting filesystem...");
    const builtImageId = await snapshotSandboxFilesystem({
      sandbox: handle.sandbox,
      timeoutMs: BUILD_SNAPSHOT_TIMEOUT_MS,
      missingImageMessage: "Snapshot did not return an image id.",
    });
    logStep("Snapshot complete.");
    emit({ source: "stdout", text: `BUILT_IMAGE_ID=${builtImageId}\n` });
    return { builtImageId };
  } catch (err) {
    throw new Error(
      [
        err instanceof Error ? err.message : String(err),
        `--- stderr ---\n${truncateBuildLog(stderrParts.join(""))}`,
        `--- stdout ---\n${truncateBuildLog(stdoutParts.join(""))}`,
      ].join("\n"),
    );
  } finally {
    await safeTerminateSandbox(handle);
  }
}

export const runModalImageBuild = runImageBuild;
