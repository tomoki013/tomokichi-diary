import { expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    fetch() {}
  },
}));
import { servedHere } from "../hosts";

it("answers private connections only on mcp.tomokichidiary.com", () => {
  const served = (url: string) => servedHere(new URL(url));
  // The retired consent paths and issuers: gone from the old host and the admin.
  for (const url of [
    "https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/analytics-connect",
    "https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/operator-connect",
    "https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/analytics/mcp",
    "https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/.well-known/oauth-authorization-server",
    "https://admin.tomokichidiary.com/analytics-connect",
    "https://admin.tomokichidiary.com/operator-connect",
  ])
    expect(served(url)).toBe(false);
  // The public travel MCP stays on the old host; everything is served on the new one.
  expect(served("https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/mcp")).toBe(true);
  expect(served("https://mcp.tomokichidiary.com/analytics-connect")).toBe(true);
});
