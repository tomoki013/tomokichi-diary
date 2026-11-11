import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import type { AppContext } from "@tomokichi/application";
import { createApp } from "../../api/src/app.js";
import type { Env } from "../../api/src/env.js";
import { bodyUrls, operationCaller, toolsFor, type OperationCaller } from "../src/tools.js";
import { configFromEnv, OperatorError } from "./config.js";

let ctx: AppContext;
let call: (token?: string) => OperationCaller;

beforeEach(async () => {
  ctx = await createTestContext();
  const app = createApp({
    contextFactory: () => ctx,
    publishSite: async () => ({ state: "queued" }),
  });
  // The real admin API, in process: the operator's calls go through the same
  // token check, policy and validation as the admin's.
  const env = { ADMIN_TOKEN: "secret", LOCAL_OPERATOR_TOKEN: "local" } as Env;
  call = (token = "local") =>
    operationCaller(
      async (request) => app.request(request.url, request, env),
      "http://localhost:8787",
      { authorization: `Bearer ${token}` },
    );
});

describe("operator configuration", () => {
  it("needs a token and only sends it over TLS or loopback", () => {
    expect(() => configFromEnv({})).toThrow(OperatorError);
    expect(() =>
      configFromEnv({ TOMOKICHI_ADMIN_TOKEN: "t", TOMOKICHI_API_URL: "http://api.example.com" }),
    ).toThrow(/https/);
    expect(configFromEnv({ TOMOKICHI_ADMIN_TOKEN: "t" })).toEqual({
      apiUrl: "http://localhost:8787",
      token: "t",
      allowWrites: false,
    });
    expect(
      configFromEnv({
        TOMOKICHI_ADMIN_TOKEN: "admin-token",
        TOMOKICHI_LOCAL_OPERATOR_TOKEN: "local-operator-token",
      }).token,
    ).toBe("local-operator-token");
    expect(
      configFromEnv({
        TOMOKICHI_ADMIN_TOKEN: "t",
        TOMOKICHI_API_URL: "https://api.tomokichidiary.com/",
        TOMOKICHI_OPERATOR_WRITE: "1",
      }),
    ).toMatchObject({ apiUrl: "https://api.tomokichidiary.com", allowWrites: true });
  });
});

describe("operations through the local operator", () => {
  it("is refused with a wrong token", async () => {
    await expect(call("wrong")("article.list", {})).rejects.toThrow(/401/);
  });

  it("creates, checks, publishes and withdraws a diary note", async () => {
    const run = call();
    const { id } = (await run("note.create", { slug: "kyoto-rain", title: "京都の雨" })) as {
      id: string;
    };
    await run("note.saveDraft", { noteId: id, bodyMarkdown: "雨の音を聞いていた。" });
    const check = (await run("note.publishCheck", { noteId: id })) as { publishable: boolean };
    expect(check.publishable).toBe(true);
    expect(await run("note.publish", { noteId: id })).toMatchObject({ status: "published" });
    expect(await run("note.unpublish", { noteId: id })).toMatchObject({ status: "draft" });
  });

  it("never reaches the admin's own operations", async () => {
    await expect(call()("inquiry.status", {})).rejects.toThrow(/403/);
    await expect(call()("note.delete", { noteId: "x", confirm: "delete" })).rejects.toThrow(/403/);
  });
});

describe("tool list", () => {
  it("lists reads always, writes only when enabled, and never the admin's own", () => {
    const read = toolsFor("operator", false).map(([, spec]) => spec.tool!.name);
    const all = toolsFor("operator", true).map(([, spec]) => spec.tool!.name);
    expect(read).toContain("list_articles");
    expect(read).not.toContain("save_article_draft");
    expect(all).toContain("save_article_draft");
    expect(all.length).toBeGreaterThan(read.length);
    expect(all.some((name) => /inquiry|delete|revoke|review/.test(name))).toBe(false);
    expect(toolsFor("analytics", true).map(([, spec]) => spec.tool!.name)).toEqual([
      "get_analytics_report",
      "get_analytics_dashboard",
      "get_analytics_trend",
      "list_analytics_reports",
    ]);
  });

  it("gives each photo only the URL a body should use", () => {
    expect(
      bodyUrls({
        items: [
          { id: "a", url: "https://media/a.jpg", slugUrl: "https://api/v1/images/a.jpg" },
          { id: "b", url: "https://media/b.jpg", slugUrl: null },
        ],
      }),
    ).toEqual({
      items: [
        { id: "a", url: "https://api/v1/images/a.jpg" },
        { id: "b", url: "https://media/b.jpg" },
      ],
    });
  });
});

describe("stdio server", () => {
  it("starts, lists its tools and lists no write tool in read-only mode", async () => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", fileURLToPath(new URL("./main.ts", import.meta.url))],
      {
        env: { ...process.env, TOMOKICHI_ADMIN_TOKEN: "t", TOMOKICHI_OPERATOR_WRITE: "" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const replies: Record<string, unknown>[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean))
        replies.push(JSON.parse(line) as Record<string, unknown>);
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const deadline = Date.now() + 20_000;
    while (!replies.some((reply) => reply["id"] === 2) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    child.kill();
    const list = replies.find((reply) => reply["id"] === 2) as {
      result: { tools: { name: string }[] };
    };
    const names = list.result.tools.map((tool) => tool.name);
    expect(names).toContain("list_articles");
    expect(names).not.toContain("publish_article");
  }, 30_000);
});
