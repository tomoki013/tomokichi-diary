import { expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    fetch() {}
  },
}));
vi.mock("../../ui-dist/index.html", () => ({ default: "<html></html>" }));
const { default: worker } = await import("../index");

it("answers private connections only on mcp.tomokichidiary.com", async () => {
  const env = {} as never;
  const ctx = {} as never;
  const status = async (url: string) => (await worker.fetch(new Request(url), env, ctx)).status;
  // The retired consent paths and issuers: gone from the old host and the admin.
  for (const url of [
    "https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/analytics-connect",
    "https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/operator-connect",
    "https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/analytics/mcp",
    "https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/.well-known/oauth-authorization-server",
    "https://admin.tomokichidiary.com/analytics-connect",
    "https://admin.tomokichidiary.com/operator-connect",
  ])
    expect(await status(url)).toBe(404);
  // The public travel MCP stays on the old host.
  expect(await status("https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/health")).toBe(200);
});
