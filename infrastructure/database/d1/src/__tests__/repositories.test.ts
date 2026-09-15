import { beforeEach, describe, expect, it } from "vitest";
import {
  createArticle,
  loadContentSnapshot,
  publishArticle,
  setArticleMedia,
  uploadMedia,
  type AppContext,
} from "@tomokichi/application";
import type { ArticleId, AuthorId } from "@tomokichi/domain";
import { createTestContext } from "./context.js";

// The article lifecycle over this same context is exercised end-to-end by the
// API tests; only the behaviour that has no HTTP surface lives here.

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

  it("deduplicates identical uploads by content hash", async () => {
    const bytes = new TextEncoder().encode("fake-image-bytes").buffer as ArrayBuffer;
    const first = await uploadMedia(ctx, {
      body: bytes,
      mimeType: "image/jpeg",
      originalName: "a.jpg",
    });
    const second = await uploadMedia(ctx, {
      body: bytes,
      mimeType: "image/jpeg",
      originalName: "b.jpg",
    });
    expect(first.ok && second.ok && first.value.id).toBe(second.ok ? second.value.id : null);
    expect((await ctx.repos.media.listAll()).length).toBe(1);
  });

  it("builds a snapshot that contains only published revisions", async () => {
    const live = await createArticle(ctx, {
      slug: "live",
      locale: "ja",
      authorId: AUTHOR,
      draft,
      path: "/posts/live",
    });
    const hidden = await createArticle(ctx, {
      slug: "hidden",
      locale: "ja",
      authorId: AUTHOR,
      draft,
      path: "/posts/hidden",
    });
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
  const upload = await uploadMedia(ctx, {
    body: bytes,
    mimeType: "image/jpeg",
    originalName: "cover.jpg",
  });
  if (!upload.ok) throw new Error("upload failed");
  await setArticleMedia(ctx, articleId, [
    {
      articleId,
      mediaId: upload.value.id,
      role: "cover",
      sortOrder: 0,
      alt: "カバー画像",
      caption: null,
    },
  ]);
}
