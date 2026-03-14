import { log } from "./log";
import { withLock } from "./services/lock.service";
import { warmBaseImage } from "./services/sandbox-core";

const BASE_IMAGE_WARM_INTERVAL_MS = 60_000;
const BASE_IMAGE_WARM_LOCK_KEY = "locks:background:base-image-warm";
const BASE_IMAGE_WARM_LOCK_TTL_MS = 5 * 60_000;

async function runBaseImageWarmCycle(): Promise<void> {
  try {
    await withLock(
      {
        key: BASE_IMAGE_WARM_LOCK_KEY,
        ttlMs: BASE_IMAGE_WARM_LOCK_TTL_MS,
        waitMs: 0,
      },
      async () => {
        await warmBaseImage();
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Failed to acquire lock:")) return;
    log.warn("base_image_warm.failed", { error });
  }
}

export function startBaseImageWarmer(): () => void {
  void runBaseImageWarmCycle();

  const timer = setInterval(() => {
    void runBaseImageWarmCycle();
  }, BASE_IMAGE_WARM_INTERVAL_MS);

  return () => clearInterval(timer);
}
