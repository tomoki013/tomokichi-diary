import { expect, it } from "vitest";
import config from "../cloudflare.config";

it("routes API requests before SPA fallback, and no MCP consent page", () => {
  // Worker fetch tests alone do not cover the assets layer, which otherwise
  // serves index.html for an OAuth navigation before the handler can run.
  expect(config.worker?.assets?.runWorkerFirst).toEqual(["/api/*"]);
  expect(config.worker?.assets?.notFoundHandling).toBe("single-page-application");
});
