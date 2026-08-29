import { beforeEach, describe, expect, it } from "vitest";
import {
  checkPublishable,
  createArticle,
  listArticlesForAdmin,
  loadContentSnapshot,
  moveRoute,
  publishArticle,
  resolveRoute,
  setArticleMedia,
  updateArticleDraft,
  uploadMedia,
  type AppContext,
} from "@tomokichi/application";
import type { ArticleId, AuthorId, MediaId } from "@tomokichi/domain";
import { createTestContext } from "./context.js";

const AUTHOR = "author-tomokichi" as AuthorId;

const draft = {
  title: "CHAGEEのメニューを日本語で解説",
  summary: "実際に飲んだ4種類をまとめました。",
  bodyMarkdown: "本文".repeat(200),
};

describe("D1 repositories", () => {
  let ctx: AppContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  it("round-trips an article, its revision and its route", async () => {
    const created = await createArticle(ctx, {
      slug: "chagee-menu-explained",
      locale: "ja",
      authorId: AUTHOR,
      draft,
      path: "/posts/chagee-menu-explained",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const stored = await ctx.repos.articles.findById(created.value.article.id);
    expect(stored).toMatchObject({ slug: "chagee-menu-explained", status: "draft", locale: "ja" });
    expect(await ctx.repos.revisions.findLatest(created.value.article.id)).toMatchObject({ revisionNumber: 1 });

    const resolved = await resolveRoute(ctx, "/posts/chagee-menu-explained/");
    expect(resolved.ok && resolved.value.route.targetId).toBe(created.value.article.id);
  });

  it("rejects a duplicate slug and a duplicate path", async () => {
    const input = { slug: "dup", locale: "ja" as const, authorId: AUTHOR, draft, path: "/posts/dup" };
    expect((await createArticle(ctx, input)).ok).toBe(true);
    const again = await createArticle(ctx, input);
    expect(again.ok).toBe(false);
    expect(!again.ok && again.errors[0]?.code).toBe("API_CONFLICT");
  });

  it("keeps the published revision stable while a draft moves on", async () => {
    const created = await createArticle(ctx, {
      slug: "stable",
      locale: "ja",
      authorId: AUTHOR,
      draft,
      path: "/posts/stable",
    });
    if (!created.ok) throw new Error("setup failed");
    const articleId = created.value.article.id;

    await attachCover(ctx, articleId);
    const published = await publishArticle(ctx, articleId);
    expect(published.ok).toBe(true);
    const publishedRevisionId = published.ok ? published.value.publishedRevisionId : null;

    await updateArticleDraft(ctx, articleId, { ...draft, title: "編集後の題名" }, AUTHOR);
    const after = await ctx.repos.articles.findById(articleId);
    expect(after?.publishedRevisionId).toBe(publishedRevisionId);
    expect(after?.currentRevisionId).not.toBe(publishedRevisionId);

    const summaries = await listArticlesForAdmin(ctx);
    expect(summaries.find((s) => s.article.id === articleId)).toMatchObject({
      hasUnpublishedChanges: true,
      isLive: true,
      title: "編集後の題名",
    });
  });

  it("explains why an article cannot be published", async () => {
    const created = await createArticle(ctx, {
      slug: "no-cover",
      locale: "ja",
      authorId: AUTHOR,
      draft,
      path: "/posts/no-cover",
    });
    if (!created.ok) throw new Error("setup failed");

    const problems = await checkPublishable(ctx, created.value.article.id);
    expect(problems.map((p) => p.field)).toContain("media");
    expect((await publishArticle(ctx, created.value.article.id)).ok).toBe(false);
  });

  it("deduplicates identical uploads by content hash", async () => {
    const bytes = new TextEncoder().encode("fake-image-bytes").buffer as ArrayBuffer;
    const first = await uploadMedia(ctx, { body: bytes, mimeType: "image/jpeg", originalName: "a.jpg" });
    const second = await uploadMedia(ctx, { body: bytes, mimeType: "image/jpeg", originalName: "b.jpg" });
    expect(first.ok && second.ok && first.value.id).toBe(second.ok ? second.value.id : null);
    expect((await ctx.repos.media.listAll()).length).toBe(1);
  });

  it("refuses an unsupported media type and images without alt text", async () => {
    const bytes = new TextEncoder().encode("x").buffer as ArrayBuffer;
    const bad = await uploadMedia(ctx, { body: bytes, mimeType: "application/pdf", originalName: "a.pdf" });
    expect(!bad.ok && bad.errors[0]?.code).toBe("API_VALIDATION_FAILED");

    const result = await setArticleMedia(ctx, "article-x" as ArticleId, [
      { articleId: "article-x" as ArticleId, mediaId: "m" as MediaId, role: "cover", sortOrder: 0, alt: " ", caption: null },
    ]);
    expect(!result.ok && result.errors[0]?.code).toBe("SEO_IMAGE_ALT_MISSING");
  });

  it("moves a URL by leaving a redirect behind", async () => {
    const created = await createArticle(ctx, {
      slug: "moved",
      locale: "ja",
      authorId: AUTHOR,
      draft,
      path: "/posts/moved",
    });
    if (!created.ok) throw new Error("setup failed");

    const moved = await moveRoute(ctx, "/posts/moved", "/posts/moved-new");
    expect(moved.ok).toBe(true);

    const old = await resolveRoute(ctx, "/posts/moved");
    expect(old.ok && old.value.kind).toBe("redirect");
    expect(old.ok && old.value.destination).toBe("/posts/moved-new");
    expect(old.ok && old.value.status).toBe(301);
  });

  it("builds a snapshot that contains only published revisions", async () => {
    const live = await createArticle(ctx, { slug: "live", locale: "ja", authorId: AUTHOR, draft, path: "/posts/live" });
    const hidden = await createArticle(ctx, { slug: "hidden", locale: "ja", authorId: AUTHOR, draft, path: "/posts/hidden" });
    if (!live.ok || !hidden.ok) throw new Error("setup failed");

    await attachCover(ctx, live.value.article.id);
    await publishArticle(ctx, live.value.article.id);

    const snapshot = await loadContentSnapshot(ctx);
    expect(snapshot.articles).toHaveLength(2);
    expect(snapshot.revisions.map((r) => r.articleId)).toEqual([live.value.article.id]);
    expect(snapshot.routes.map((r) => r.path)).toContain("/posts/hidden");
  });
});

async function attachCover(ctx: AppContext, articleId: ArticleId): Promise<void> {
  const bytes = new TextEncoder().encode(`cover-${articleId}`).buffer as ArrayBuffer;
  const upload = await uploadMedia(ctx, { body: bytes, mimeType: "image/jpeg", originalName: "cover.jpg" });
  if (!upload.ok) throw new Error("upload failed");
  await setArticleMedia(ctx, articleId, [
    { articleId, mediaId: upload.value.id, role: "cover", sortOrder: 0, alt: "カバー画像", caption: null },
  ]);
}
