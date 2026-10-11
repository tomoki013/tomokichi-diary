import { publishDueArticles } from "@tomokichi/application";
import { describe, expect, it } from "vitest";
import { createTestContext, loadMigrations } from "@tomokichi/infra-d1/testing-context";
import { fromNodeSqlite, openInMemoryDatabase } from "@tomokichi/infra-d1/testing";
import { migrate } from "@tomokichi/infra-d1";
import {
  createArticle,
  loadContentSnapshot,
  publishArticle,
  scheduleArticle,
  updateArticleDraft,
} from "@tomokichi/application";
import { instantFrom } from "@tomokichi/domain";
import type { Env } from "../env.js";
import { publicationStatus, requestPublication } from "../publication.js";

async function database() {
  const db = fromNodeSqlite(openInMemoryDatabase());
  await migrate(db, loadMigrations());
  return db;
}

describe("publication dispatch and status", () => {
  it("shows missing configuration instead of claiming a site deployment", async () => {
    const db = await database();
    const status = await requestPublication({} as Env, db);
    expect(status.state).toBe("unconfigured");
    expect(status.deployedAt).toBeNull();
  });
  it("dispatches main and exposes a failure that can be retried", async () => {
    const db = await database();
    const env = { GITHUB_PUBLISH_TOKEN: "test-token" } as Env;
    const seen: RequestInit[] = [];
    const dispatch: typeof fetch = async (_url, init) => {
      seen.push(init!);
      return new Response(null, { status: 403 });
    };
    expect((await requestPublication(env, db, dispatch)).state).toBe("failed");
    expect(JSON.parse(String(seen[0]?.body))).toMatchObject({ ref: "main" });
    expect(
      (await requestPublication(env, db, async () => new Response(null, { status: 204 }))).state,
    ).toBe("queued");
  });
  it("does not overwrite a newer request with an older dispatch failure", async () => {
    const db = await database();
    await requestPublication({ GITHUB_PUBLISH_TOKEN: "test" } as Env, db, async () => {
      await db
        .prepare("UPDATE site_publication SET requested_id = 'newer' WHERE id = 'site'")
        .run();
      return new Response(null, { status: 403 });
    });
    expect((await publicationStatus(db, true)).state).toBe("queued");
    expect((await publicationStatus(db, true)).error).toBeNull();
  });
});

const draft = {
  title: "操作確認の固定ページ",
  summary: "管理画面から作ったページです。",
  bodyMarkdown: "ページの本文です。".repeat(30),
  seoTitleOverride: null,
  seoDescriptionOverride: null,
  changeSummary: null,
};

describe("scheduled and draft publication", () => {
  it("creates a static route and publishes a new page without a cover", async () => {
    const ctx = await createTestContext();
    const author = (await ctx.repos.authors.listAll())[0]!;
    const created = await createArticle(ctx, {
      slug: "page-test",
      locale: "ja",
      kind: "page",
      authorId: author.id,
      path: "/page-test",
      draft,
    });
    if (!created.ok) throw new Error("fixture failed");
    expect((await ctx.repos.routes.listAll())[0]?.targetType).toBe("static");
    const published = await publishArticle(ctx, created.value.article.id);
    expect(published.ok).toBe(true);
  });
  it("executes due schedules and leaves future schedules alone", async () => {
    const ctx = await createTestContext();
    const author = (await ctx.repos.authors.listAll())[0]!;
    const created = await createArticle(ctx, {
      slug: "scheduled",
      locale: "ja",
      kind: "page",
      authorId: author.id,
      path: "/scheduled",
      draft,
    });
    if (!created.ok) throw new Error("fixture failed");
    await scheduleArticle(ctx, created.value.article.id, instantFrom("2026-08-30T01:00:00.000Z"));
    expect(await publishDueArticles(ctx)).toBe(0);
    expect(
      await publishDueArticles({
        ...ctx,
        clock: { now: () => instantFrom("2026-08-30T01:01:00.000Z") },
      }),
    ).toBe(1);
    expect((await ctx.repos.articles.findById(created.value.article.id))?.status).toBe("published");
  });
  it("retains published metadata until the updated draft is published", async () => {
    const ctx = await createTestContext();
    const author = (await ctx.repos.authors.listAll())[0]!;
    const created = await createArticle(ctx, {
      slug: "frozen",
      locale: "ja",
      kind: "page",
      authorId: author.id,
      path: "/frozen",
      draft,
    });
    if (!created.ok) throw new Error("fixture failed");
    const articleId = created.value.article.id;
    await publishArticle(ctx, articleId);
    const original = await ctx.repos.articles.findById(articleId);
    await ctx.repos.articles.save({ ...original!, experienceTags: ["exciting"] });
    await updateArticleDraft(ctx, articleId, { ...draft, title: "未公開のタイトル" }, author.id);
    const snapshot = await loadContentSnapshot(ctx);
    expect(snapshot.articles[0]?.experienceTags).toEqual([]);
    expect(snapshot.revisions[0]?.title).toBe(draft.title);
    await publishArticle(ctx, articleId);
    const updated = await loadContentSnapshot(ctx);
    expect(updated.articles[0]?.experienceTags).toEqual(["exciting"]);
    expect(updated.revisions[0]?.title).toBe("未公開のタイトル");
  });
});
