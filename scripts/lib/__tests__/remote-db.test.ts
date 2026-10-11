import { afterEach, expect, it, vi } from "vitest";
import { remoteDatabase } from "../remote-db.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("sends single reads and batch writes using the D1 REST contract", async () => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-token");
  const requests: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    requests.push(body);
    // The external API accepts a query object or { batch: queries }, never
    // an array at the root. Check that boundary, rather than internal methods.
    if (Array.isArray(body)) return Response.json({ success: false }, { status: 400 });
    return Response.json({ success: true, result: [{ success: true, results: [{ id: "site" }] }] });
  });
  const db = remoteDatabase();
  expect(
    await db.prepare("SELECT id FROM site_publication WHERE id = ?").bind("site").first(),
  ).toEqual({ id: "site" });
  await db.batch([
    db.prepare("UPDATE site_publication SET requested_id = ?").bind("request-1"),
    db.prepare("UPDATE site_publication SET building_id = ?").bind("request-1"),
  ]);
  expect(requests).toEqual([
    { sql: "SELECT id FROM site_publication WHERE id = ?", params: ["site"] },
    {
      batch: [
        { sql: "UPDATE site_publication SET requested_id = ?", params: ["request-1"] },
        { sql: "UPDATE site_publication SET building_id = ?", params: ["request-1"] },
      ],
    },
  ]);
});
