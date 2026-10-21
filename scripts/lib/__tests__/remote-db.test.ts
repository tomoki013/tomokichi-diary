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

it("coalesces concurrent snapshot reads in bounded batches without mixing their results", async () => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-token");
  const requests: {
    batch?: { sql: string; params: unknown[] }[];
    sql?: string;
    params?: unknown[];
  }[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const input = JSON.parse(String(init.body));
    requests.push(input);
    const queries = input.batch ?? [input];
    return Response.json({
      success: true,
      result: queries.map((query: { params: unknown[] }) => ({
        success: true,
        results: [{ id: query.params[0] }],
      })),
    });
  });
  const db = remoteDatabase();
  const rows = await Promise.all(
    Array.from({ length: 121 }, (_, id) =>
      db.prepare("SELECT id FROM content WHERE id = ?").bind(id).first<{ id: number }>(),
    ),
  );
  expect(rows.map((row) => row?.id)).toEqual(Array.from({ length: 121 }, (_, id) => id));
  expect(requests.map((request) => request.batch?.length ?? 1)).toEqual([50, 50, 21]);
  await db.prepare("UPDATE site_publication SET requested_id = ?").bind("next").run();
  expect(requests.at(-1)).toEqual({
    sql: "UPDATE site_publication SET requested_id = ?",
    params: ["next"],
  });
});

it("rejects incomplete or failed batches rather than returning the wrong revision", async () => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-token");
  for (const failure of ["incomplete", "failed"]) {
    vi.stubGlobal("fetch", async () =>
      Response.json({
        success: true,
        result: [{ success: failure !== "failed", results: [{ id: "one" }] }],
      }),
    );
    const db = remoteDatabase();
    const outcomes = await Promise.allSettled([
      db.prepare("SELECT 'one'").first(),
      db.prepare("SELECT 'two'").all(),
    ]);
    expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true);
  }
});
