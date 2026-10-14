import { expect, it } from "vitest";
import config from "../cloudflare.config";

it("routes OAuth browser navigations and API requests before SPA fallback", () => {
  // Worker fetch tests alone do not cover the assets layer, which otherwise
  // serves index.html for an OAuth navigation before the handler can run.
  expect(config.worker?.assets?.runWorkerFirst).toEqual(["/api/*", "/analytics-connect"]);
  expect(config.worker?.assets?.notFoundHandling).toBe("single-page-application");
});
