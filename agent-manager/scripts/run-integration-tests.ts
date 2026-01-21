import { randomUUID } from "node:crypto";

type CommandResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

type StartedInfra = {
  readonly postgresContainerName: string;
  readonly redisContainerName: string;
  readonly postgresPort: number;
  readonly redisPort: number;
};

const DEFAULT_TEST_DB_USER = "postgres";
const DEFAULT_TEST_DB_PASSWORD = "password";
const POSTGRES_IMAGE = "postgres:17";
const REDIS_IMAGE = "redis:7-alpine";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMappedPort(value: string): number {
  const line = value
    .split(/\r?\n/)
    .map((v) => v.trim())
    .find((v) => v.length > 0);
  if (!line) throw new Error(`docker port returned no output: ${JSON.stringify(value)}`);
  const match = line.match(/:(\d+)$/);
  if (!match) throw new Error(`Unable to parse mapped port from: ${line}`);
  const parsed = Number(match[1]);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid mapped port parsed from: ${line}`);
  }
  return parsed;
}

async function runCommand(
  cmd: readonly string[],
  options?: { readonly cwd?: string; readonly env?: Record<string, string> }
): Promise<CommandResult> {
  const proc = Bun.spawn(cmd, {
    cwd: options?.cwd,
    env: options?.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

async function runCheckedCommand(
  cmd: readonly string[],
  options?: { readonly cwd?: string; readonly env?: Record<string, string> }
): Promise<string> {
  const result = await runCommand(cmd, options);
  if (result.exitCode !== 0) {
    const details = [result.stdout.trim(), result.stderr.trim()]
      .filter((v) => v.length > 0)
      .join("\n");
    throw new Error(`Command failed (${cmd.join(" ")}):\n${details}`);
  }
  return result.stdout;
}

async function waitForHealthy(
  label: string,
  check: () => Promise<void>,
  timeoutMs = 60_000,
  intervalMs = 1_000
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await check();
      return;
    } catch (err) {
      lastError = err;
      await sleep(intervalMs);
    }
  }

  throw new Error(
    `${label} did not become ready within ${timeoutMs}ms: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

async function startInfra(): Promise<StartedInfra> {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const postgresContainerName = `agent-manager-it-pg-${suffix}`;
  const redisContainerName = `agent-manager-it-redis-${suffix}`;
  const startedContainers: string[] = [];

  try {
    await runCheckedCommand([
      "docker",
      "run",
      "-d",
      "--rm",
      "--name",
      postgresContainerName,
      "-e",
      `POSTGRES_USER=${DEFAULT_TEST_DB_USER}`,
      "-e",
      `POSTGRES_PASSWORD=${DEFAULT_TEST_DB_PASSWORD}`,
      "-p",
      "127.0.0.1::5432",
      POSTGRES_IMAGE,
    ]);
    startedContainers.push(postgresContainerName);

    await runCheckedCommand([
      "docker",
      "run",
      "-d",
      "--rm",
      "--name",
      redisContainerName,
      "-p",
      "127.0.0.1::6379",
      REDIS_IMAGE,
      "redis-server",
      "--appendonly",
      "no",
    ]);
    startedContainers.push(redisContainerName);

    const postgresPort = parseMappedPort(
      await runCheckedCommand(["docker", "port", postgresContainerName, "5432/tcp"])
    );
    const redisPort = parseMappedPort(
      await runCheckedCommand(["docker", "port", redisContainerName, "6379/tcp"])
    );

    await waitForHealthy("postgres", async () => {
      await runCheckedCommand([
        "docker",
        "exec",
        postgresContainerName,
        "pg_isready",
        "-U",
        DEFAULT_TEST_DB_USER,
        "-d",
        "postgres",
      ]);
    });

    await waitForHealthy("redis", async () => {
      const output = await runCheckedCommand([
        "docker",
        "exec",
        redisContainerName,
        "redis-cli",
        "ping",
      ]);
      if (!output.toUpperCase().includes("PONG")) {
        throw new Error(`Unexpected redis ping output: ${output.trim()}`);
      }
    });

    return {
      postgresContainerName,
      redisContainerName,
      postgresPort,
      redisPort,
    };
  } catch (err) {
    await Promise.allSettled(
      startedContainers.map(async (name) => {
        await stopContainer(name);
      })
    );
    throw err;
  }
}

async function stopContainer(name: string): Promise<void> {
  const result = await runCommand(["docker", "rm", "-f", name]);
  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    if (
      stderr.includes("No such container") ||
      stderr.includes("is not running")
    ) {
      return;
    }
    throw new Error(
      `Failed to stop container ${name}: ${[result.stdout, result.stderr]
        .join("\n")
        .trim()}`
    );
  }
}

async function main(): Promise<void> {
  await runCheckedCommand(["docker", "version", "--format", "{{.Server.Version}}"]);

  const infra = await startInfra();
  const dbName = `agent_manager_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const databaseUrl = `postgres://${DEFAULT_TEST_DB_USER}:${DEFAULT_TEST_DB_PASSWORD}@127.0.0.1:${infra.postgresPort}/${dbName}`;
  const redisUrl = `redis://127.0.0.1:${infra.redisPort}`;

  console.log(
    `[integration] postgres=127.0.0.1:${infra.postgresPort} redis=127.0.0.1:${infra.redisPort} db=${dbName}`
  );

  const testArgs = process.argv.slice(2);
  const runnerArgs =
    testArgs.length > 0 ? testArgs : ["test", "tests/integration", "--runInBand"];

  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
  env.DATABASE_URL = databaseUrl;
  env.REDIS_URL = redisUrl;

  try {
    const code = await Bun.spawn(["bun", ...runnerArgs], {
      cwd: process.cwd(),
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).exited;

    if (code !== 0) process.exitCode = code;
  } finally {
    await Promise.allSettled([
      stopContainer(infra.postgresContainerName),
      stopContainer(infra.redisContainerName),
    ]);
  }
}

await main();
