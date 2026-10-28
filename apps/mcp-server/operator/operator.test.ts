import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { createArticle, type AppContext } from "@tomokichi/application";
import type { AuthorId } from "@tomokichi/domain";
import { createApp } from "../../api/src/app.js";
import type { Env } from "../../api/src/env.js";
import { configFromEnv, createOperatorClient, OperatorError, type Fetch } from "./client.js";
import { bodyUrls } from "./server.js";

let ctx: AppContext;
let fetchApi: Fetch;

beforeEach(async () => {
  ctx = await createTestContext();
  const app = createApp({ contextFactory: () => ctx });
  // The real admin API, in process: the operator's requests go through the
  // same token check and validation as the admin's.
  fetchApi = async (input, init) => app.request(input, init, { ADMIN_TOKEN: "secret" } as Env);
});

const client = (allowWrites: boolean, token = "secret") =>
  createOperatorClient({ apiUrl: "http://localhost:8787", token, allowWrites }, fetchApi);

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
        TOMOKICHI_ADMIN_TOKEN: "t",
        TOMOKICHI_API_URL: "https://api.tomokichidiary.com/",
        TOMOKICHI_OPERATOR_WRITE: "1",
      }),
    ).toMatchObject({ apiUrl: "https://api.tomokichidiary.com", allowWrites: true });
  });
});

describe("operator client against the admin API", () => {
  it("is refused with a wrong token", async () => {
    await expect(client(false, "wrong").listArticles()).rejects.toThrow(/401/);
  });

  it("reads, and refuses every write until writes are enabled", async () => {
    const readOnly = client(false);
    expect((await readOnly.listCollections("series")).items.length).toBeGreaterThan(0);
    await expect(readOnly.createTag({ slug: "x", name: "x" })).rejects.toThrow(/書き込みは無効/);
    expect((await ctx.repos.taxonomy.listTags()).some((tag) => tag.slug === "x")).toBe(false);
  });

  it("changes series and tags without touching an article's other relations", async () => {
    const created = await createArticle(ctx, {
      slug: "operator-check",
      locale: "ja",
      authorId: "author-tomokichi" as AuthorId,
      path: "/posts/operator-check",
      draft: { title: "t", summary: "s", bodyMarkdown: "b" },
    });
    if (!created.ok) throw new Error("fixture failed");
    const articleId = created.value.article.id;
    const [category] = await ctx.repos.taxonomy.listCategories();
    await ctx.repos.relations.replaceForArticle(articleId, {
      locations: [],
      places: [],
      categories: category ? [{ articleId, categoryId: category.id }] : [],
      tags: [],
    });

    const writer = client(true);
    const tag = (await writer.createTag({ slug: "night-train", name: "夜行列車" })) as {
      id: string;
    };
    const series = (await writer.listCollections("series")).items as { id: string; slug: string }[];
    const soundtrack = series.find((item) => item.slug === "travel-soundtrack")!;
    await writer.setSeriesAndTags(articleId, { collectionIds: [soundtrack.id], tagIds: [tag.id] });

    const after = await writer.getArticle(articleId);
    expect(after.collectionIds).toEqual([soundtrack.id]);
    expect(after.relations.tagIds).toEqual([tag.id]);
    expect(after.relations.categoryIds).toEqual(category ? [category.id] : []);

    await writer.saveDraft(articleId, { title: "新しいタイトル" });
    expect((await writer.getArticle(articleId)).currentRevision).toMatchObject({
      title: "新しいタイトル",
      summary: "s",
      bodyMarkdown: "b",
    });
  });
});

describe("media search results", () => {
  it("give each photo only the URL a body should use", () => {
    expect(
      bodyUrls({
        items: [
          {
            id: "a",
            url: "https://media.example/a.jpg",
            slugUrl: "https://api.example/v1/images/a.jpg",
          },
          { id: "b", url: "https://media.example/b.jpg", slugUrl: null },
        ],
        total: 2,
      }),
    ).toEqual({
      items: [
        { id: "a", url: "https://api.example/v1/images/a.jpg" },
        { id: "b", url: "https://media.example/b.jpg" },
      ],
      total: 2,
    });
  });
});

describe("operator MCP server over stdio", () => {
  it("lists its tools and refuses a write in read-only mode", async () => {
    const main = fileURLToPath(new URL("./main.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", "tsx", main], {
      env: { ...process.env, TOMOKICHI_ADMIN_TOKEN: "t", TOMOKICHI_API_URL: "http://localhost:9" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const responses = new Map<number, unknown>();
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          const message = JSON.parse(line) as { id?: number };
          if (typeof message.id === "number") responses.set(message.id, message);
        }
        newline = buffer.indexOf("\n");
      }
    });
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const reply = async (id: number) => {
      for (let i = 0; i < 200 && !responses.has(id); i++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      return responses.get(id) as { result?: Record<string, unknown> };
    };
    try {
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
      expect((await reply(1))?.result).toBeDefined();
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      const tools = ((await reply(2)).result?.["tools"] ?? []) as { name: string }[];
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "list_articles",
          "create_series",
          "create_tag",
          "set_article_series_and_tags",
          "publish_article",
        ]),
      );
      expect(tools.some((tool) => /delete/i.test(tool.name))).toBe(false);
      send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "create_tag", arguments: { slug: "x", name: "x" } },
      });
      const refused = (await reply(3)).result as {
        isError?: boolean;
        content?: { text: string }[];
      };
      expect(refused.isError).toBe(true);
      expect(refused.content?.[0]?.text).toMatch(/書き込みは無効/);
    } finally {
      child.kill();
    }
  }, 30_000);
});
