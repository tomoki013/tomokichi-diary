import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { OperatorClient } from "./client.js";

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and single hyphens");

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

/**
 * Gives each library photo the one URL a body should use, the slug alias when
 * it has one, so a model picking a field by name cannot write the storage URL.
 */
export function bodyUrls(page: unknown): unknown {
  if (!page || typeof page !== "object" || !("items" in page) || !Array.isArray(page.items))
    return page;
  return {
    ...page,
    items: page.items.map((item: Record<string, unknown>) => {
      const { slugUrl, ...rest } = item;
      return { ...rest, url: slugUrl ?? item["url"] };
    }),
  };
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

/**
 * The operator's tools. Reading is always allowed; every write goes through
 * the admin API's own validation, is refused unless writes were enabled for
 * the session, and nothing here deletes. Publishing additionally needs the
 * caller to restate the article id, so it cannot happen as a side effect.
 */
export function createOperatorServer(client: OperatorClient): McpServer {
  const server = new McpServer({ name: "tomokichi-diary-operator", version: "1.0.0" });

  server.registerTool(
    "list_articles",
    {
      title: "List articles",
      description: "記事・固定ページの一覧（ID、タイトル、状態、URL、未公開の変更の有無）。",
      inputSchema: { query: z.string().max(100).optional() },
      annotations: READ,
    },
    async ({ query }) => {
      const { items } = await client.listArticles();
      const needle = query?.trim().toLowerCase() ?? "";
      return json(
        needle === ""
          ? items
          : items.filter((item) => JSON.stringify(item).toLowerCase().includes(needle)),
      );
    },
  );

  server.registerTool(
    "get_article",
    {
      title: "Get article",
      description: "記事の現在の下書き本文（Markdown）、写真、関連付け、所属シリーズを取得します。",
      inputSchema: { articleId: z.string().min(1) },
      annotations: READ,
    },
    async ({ articleId }) => json(await client.getArticle(articleId)),
  );

  server.registerTool(
    "check_publishable",
    {
      title: "Check publishable",
      description:
        "記事が公開条件を満たすか（本文の長さ、カバー写真、Apple Music URL など）を確認します。",
      inputSchema: { articleId: z.string().min(1) },
      annotations: READ,
    },
    async ({ articleId }) => json(await client.publishCheck(articleId)),
  );

  server.registerTool(
    "publication_status",
    {
      title: "Publication status",
      description: "サイトへの反映状況（反映済み・生成中・失敗）を確認します。",
      inputSchema: {},
      annotations: READ,
    },
    async () => json(await client.publicationStatus()),
  );

  server.registerTool(
    "list_taxonomy",
    {
      title: "List categories, tags and collections",
      description: "カテゴリー・タグ・シリーズ/旅程コレクションの ID と名前を一覧します。",
      inputSchema: {},
      annotations: READ,
    },
    async () => json(await client.taxonomy()),
  );

  server.registerTool(
    "list_series",
    {
      title: "List series",
      description: "シリーズの一覧（公開記事数、URL、カバー、表示順）。",
      inputSchema: {},
      annotations: READ,
    },
    async () => json(await client.listCollections("series")),
  );

  server.registerTool(
    "search_media",
    {
      title: "Search media",
      description:
        "画像ライブラリを slug・ファイル名・地域で検索します（30件ずつ）。本文に入れるときは各画像の url を ![説明](url) で書きます。",
      inputSchema: { query: z.string().max(100), offset: z.number().int().min(0).optional() },
      annotations: READ,
    },
    async ({ query, offset }) => json(bodyUrls(await client.searchMedia(query, offset ?? 0))),
  );

  server.registerTool(
    "create_article_draft",
    {
      title: "Create article draft",
      description:
        "新しい記事を下書きとして作成します。公開はされません。URL は path で明示します（例: /posts/slug）。Apple Music は共有 URL を本文に1行で書くとプレーヤーになります。本文の写真は search_media の url を使います（保存時に記事の画像にも自動で追加されます）。",
      inputSchema: {
        slug,
        path: z.string().regex(/^\/[a-z0-9/-]+$/),
        kind: z.enum(["article", "page"]).optional(),
        title: z.string().min(1).max(120),
        summary: z.string().min(1).max(300),
        bodyMarkdown: z.string().min(1),
      },
      annotations: WRITE,
    },
    async ({ slug: articleSlug, path, kind, title, summary, bodyMarkdown }) =>
      json(
        await client.createArticle({
          slug: articleSlug,
          path,
          kind: kind ?? "article",
          draft: {
            title,
            summary,
            bodyMarkdown,
            seoTitleOverride: null,
            seoDescriptionOverride: null,
            changeSummary: "MCP operator",
          },
        }),
      ),
  );

  server.registerTool(
    "save_article_draft",
    {
      title: "Save article draft",
      description:
        "記事の下書きを保存します。指定しなかった項目は現在の内容のまま。公開中の記事でも、公開版は変わりません（公開は publish_article）。本文の写真は search_media の url を使います（保存時に記事の画像にも自動で追加されます）。",
      inputSchema: {
        articleId: z.string().min(1),
        title: z.string().min(1).max(120).optional(),
        summary: z.string().min(1).max(300).optional(),
        bodyMarkdown: z.string().min(1).optional(),
        changeSummary: z.string().max(200).optional(),
      },
      annotations: WRITE,
    },
    async ({ articleId, ...changes }) => json(await client.saveDraft(articleId, changes)),
  );

  server.registerTool(
    "set_article_series_and_tags",
    {
      title: "Set article series and tags",
      description:
        "記事の所属シリーズとタグを設定します（指定した方だけ置き換え。地域・カテゴリーは変更しません）。公開中の記事は「変更を公開」で反映されます。",
      inputSchema: {
        articleId: z.string().min(1),
        collectionIds: z.array(z.string().min(1)).optional(),
        tagIds: z.array(z.string().min(1)).optional(),
      },
      annotations: WRITE,
    },
    async ({ articleId, collectionIds, tagIds }) =>
      json(
        await client.setSeriesAndTags(articleId, {
          ...(collectionIds ? { collectionIds } : {}),
          ...(tagIds ? { tagIds } : {}),
        }),
      ),
  );

  server.registerTool(
    "create_series",
    {
      title: "Create series",
      description: "シリーズを作成します（URL は /collections/<slug>、作成後 slug は変更不可）。",
      inputSchema: {
        slug,
        title: z.string().min(1).max(80),
        description: z.string().max(400).optional(),
        coverMediaId: z.string().optional(),
        sortOrder: z.number().int().min(0).optional(),
      },
      annotations: WRITE,
    },
    async (input) => json(await client.createSeries(input)),
  );

  server.registerTool(
    "update_series",
    {
      title: "Update series",
      description: "シリーズの名前・説明・カバー・表示順を変更します。slug と URL は変わりません。",
      inputSchema: {
        collectionId: z.string().min(1),
        title: z.string().min(1).max(80).optional(),
        description: z.string().max(400).nullable().optional(),
        coverMediaId: z.string().nullable().optional(),
        sortOrder: z.number().int().min(0).optional(),
      },
      annotations: WRITE,
    },
    async ({ collectionId, ...changes }) => json(await client.updateSeries(collectionId, changes)),
  );

  server.registerTool(
    "create_tag",
    {
      title: "Create tag",
      description: "タグを作成します。既存のタグと slug・名前が重複する場合は作成されません。",
      inputSchema: { slug, name: z.string().min(1).max(80) },
      annotations: WRITE,
    },
    async (input) => json(await client.createTag(input)),
  );

  server.registerTool(
    "publish_article",
    {
      title: "Publish article",
      description:
        "記事の保存済み下書きを公開し、サイトへの反映を開始します。実行前に check_publishable で確認し、利用者の明示的な指示があるときだけ使ってください。confirmArticleId に同じ ID を入れる必要があります。",
      inputSchema: { articleId: z.string().min(1), confirmArticleId: z.string().min(1) },
      annotations: { ...WRITE, openWorldHint: true },
    },
    async ({ articleId, confirmArticleId }) => {
      if (articleId !== confirmArticleId)
        throw new Error("confirmArticleId が articleId と一致しないため公開しません");
      return json(await client.publish(articleId));
    },
  );

  return server;
}
