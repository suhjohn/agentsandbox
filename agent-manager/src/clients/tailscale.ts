import { log } from "../log";

async function execJson(args: readonly string[], timeoutMs = 2000): Promise<unknown | null> {
  try {
    const proc = Bun.spawn([...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill("SIGTERM"), timeoutMs);
    
    const exitCode = await proc.exited;
    clearTimeout(timer);

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      if (stderr.trim()) log.debug("tailscale.cmd.failed", { args, stderr: stderr.trim() });
      return null;
    }

    const stdout = await new Response(proc.stdout).text();
    const text = stdout.trim();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function getDnsName(status: unknown): string | null {
  const dns = (status as any)?.Self?.DNSName;
  if (typeof dns !== "string") return null;
  return dns.trim().replace(/\.+$/, "") || null;
}

export async function tryResolveTailscaleFunnelPublicBaseUrl(): Promise<string | null> {
  const funnelStatus = await execJson(["tailscale", "funnel", "status", "--json"]);
  if (!funnelStatus || typeof funnelStatus !== "object" || Array.isArray(funnelStatus)) return null;

  const status = await execJson(["tailscale", "status", "--json"]);
  const dnsName = getDnsName(status);
  return dnsName ? `https://${dnsName}` : null;
}

async function startFunnel(port: number): Promise<void> {
  try {
    const proc = Bun.spawn(["tailscale", "funnel", "--bg", "--yes", String(port)], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill("SIGTERM"), 1500);
    const exitCode = await proc.exited;
    clearTimeout(timer);

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text().catch(() => "");
      if (stderr.trim()) {
        log.warn("tailscale_funnel.start.failed", { port, exitCode, error: stderr.trim() });
      }
    }
  } catch (err) {
    log.warn("tailscale_funnel.start.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

let startPromise: Promise<string | null> | null = null;
let startedByUs = false;

export async function ensureTailscaleFunnelPublicBaseUrl(input: {
  readonly port: number;
}): Promise<string | null> {
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const existing = await tryResolveTailscaleFunnelPublicBaseUrl();
    if (existing) {
      log.info("tailscale_funnel.public_url", { url: existing });
      return existing;
    }

    log.info("tailscale_funnel.start", { port: input.port });
    const hadFunnelConfig = !!(await execJson(["tailscale", "funnel", "status", "--json"]));
    await startFunnel(input.port);
    if (!hadFunnelConfig) startedByUs = true;

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const url = await tryResolveTailscaleFunnelPublicBaseUrl();
      if (url) {
        log.info("tailscale_funnel.public_url", { url });
        return url;
      }
      await new Promise<void>((r) => setTimeout(r, 500));
    }

    log.warn("tailscale_funnel.start.timeout", { port: input.port });
    return null;
  })();

  return startPromise;
}

export async function stopTailscaleFunnel(): Promise<void> {
  if (!startedByUs) return;
  startedByUs = false;
  startPromise = null;

  try {
    const proc = Bun.spawn(["tailscale", "funnel", "reset"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
  } catch {
    // ignore
  }
}
