import { env } from "./env";
import { app } from "./app";

export function startServer(options?: { readonly port?: number }) {
  const port = options?.port ?? env.PORT;

  const server = Bun.serve({
    port,
    idleTimeout: env.IDLE_TIMEOUT_SECONDS,
    fetch(req) {
      return app.fetch(req);
    },
  });

  return server;
}
