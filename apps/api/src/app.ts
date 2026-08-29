import { Hono } from "hono";

/**
 * HTTP adapter only. Business logic lives in @tomokichi/application.
 */
export function createApp() {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}
