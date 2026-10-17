/** Local-only harness: in-memory DB, fake Access, publication stub. No Cloudflare bindings. */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { createArticle, publishArticle, analyticsDashboard } from "@tomokichi/application";
import { generateId, type ArticleId, type AuthorId, type MediaId } from "@tomokichi/domain";
import { createApp } from "../../apps/api/src/app.js";
import type { Env } from "../../apps/api/src/env.js";
const target = "52b1cb6d-eb74-85a3-b6a1-392f83313051" as ArticleId;
const context = await createTestContext();
let first = true;
const ctx = {
  ...context,
  ids: {
    next: <T extends string>() => {
      if (first) {
        first = false;
        return target as T;
      }
      return generateId() as string as T;
    },
  },
};
const article = await createArticle(ctx, {
  slug: "shanghai-chagee-menu",
  locale: "ja",
  authorId: "author-tomokichi" as AuthorId,
  path: "/posts/shanghai-chagee-menu",
  draft: {
    title: "CHAGEEのおすすめメニュー紹介",
    summary: "実際に飲んだおすすめの4メニューを紹介します。",
    bodyMarkdown: `導入文。\n\n## おすすめメニュー\n\n${"体験したおすすめのお茶を紹介します。".repeat(55)}\n\n## 予約方法\n\n旅先の予約について説明する文章です。\n\n## まとめ\n\n次の旅へ。`,
  },
});
if (!article.ok) throw new Error("fixture creation failed");
await ctx.repos.media.save({
  id: "cover" as MediaId,
  storageKey: "cover.jpg",
  mimeType: "image/jpeg",
  width: 300,
  height: 200,
  size: 100,
  sha256: "a".repeat(64),
  createdAt: ctx.clock.now(),
});
await ctx.repos.media.replaceForArticle(target, [
  {
    articleId: target,
    mediaId: "cover" as MediaId,
    role: "cover",
    sortOrder: 0,
    alt: "旅の写真",
    caption: null,
  },
]);
await publishArticle(ctx, target);
for (const [slug, suffix] of [
  ["second-journey", "2"],
  ["third-journey", "3"],
]) {
  const next = await createArticle(ctx, {
    slug: slug!,
    locale: "ja",
    authorId: "author-tomokichi" as AuthorId,
    path: `/posts/${slug}`,
    draft: {
      title: `配置テストの旅行記${suffix}`,
      summary: "本文の位置候補を確認するための隔離テスト記事です。",
      bodyMarkdown: `導入文。\n\n## 体験の回答\n\n${"旅で体験したことを説明します。".repeat(55)}\n\n${"おすすめの情報を説明する段落です。".repeat(12)}\n\n## 次に知りたいこと\n\n${"続きの体験と旅の情報を紹介します。".repeat(100)}`,
    },
  });
  if (!next.ok) throw new Error("extra fixture failed");
  await ctx.repos.media.replaceForArticle(next.value.article.id, [
    {
      articleId: next.value.article.id,
      mediaId: "cover" as MediaId,
      role: "cover",
      sortOrder: 0,
      alt: "旅の写真",
      caption: null,
    },
  ]);
  await publishArticle(ctx, next.value.article.id);
}

const app = createApp({
  contextFactory: () => ctx,
  publishSite: async () => ({ state: "queued", configured: false }),
});
const env = { ADMIN_TOKEN: "local-test" } as Env;
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const input = Buffer.concat(chunks);
    const response =
      url.pathname === "/api/v1/admin/analytics"
        ? Response.json(
            await analyticsDashboard(
              { read: async () => [], statuses: async () => [] },
              { start: url.searchParams.get("start")!, end: url.searchParams.get("end")! },
            ),
          )
        : await app.fetch(
            new Request(`http://localhost${url.pathname.slice(4)}${url.search}`, {
              method: req.method,
              headers: { ...req.headers, authorization: "Bearer local-test" } as HeadersInit,
              ...(input.length ? { body: input } : {}),
            }),
            env,
          );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  const root = resolve(
    url.pathname.startsWith("/web/") ? ".artifacts/monetization/web" : "apps/admin/dist",
  );
  const relative = url.pathname.startsWith("/web/") ? url.pathname.slice(5) : url.pathname.slice(1);
  let file = resolve(root, relative || "index.html");
  if (!file.startsWith(root + "/") && file !== root) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file) && existsSync(`${file}.html`)) file += ".html";
  if (!existsSync(file)) file = resolve(root, "index.html");
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
server.listen(4178, "127.0.0.1", () =>
  process.stdout.write("Local mocked monetization harness: http://127.0.0.1:4178\n"),
);
