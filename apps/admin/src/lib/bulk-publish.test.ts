import { describe, expect, it, vi } from "vitest";
import type { ArticleSummaryDto } from "@tomokichi/contracts";
import { ApiError, type PublicationStatus } from "./api";
import { canSelectForPublication, publishSelection } from "./bulk-publish";

const queued: PublicationStatus = {
  state: "queued",
  configured: true,
  requestedAt: null,
  deployedAt: null,
  buildUrl: null,
  error: null,
};
const article = (id: string, fields: Partial<ArticleSummaryDto> = {}): ArticleSummaryDto => ({
  id,
  kind: "article",
  slug: id,
  title: id,
  status: "published",
  locale: "ja",
  path: `/posts/${id}`,
  publishedAt: null,
  scheduledAt: null,
  updatedAt: "2026-10-11T00:00:00Z",
  hasUnpublishedChanges: true,
  isLive: true,
  noindex: false,
  ...fields,
});
const blocked = () =>
  new ApiError("ARTICLE_NOT_PUBLISHABLE", "a cover image is required", 409, [
    { path: "media", message: "a cover image is required" },
  ]);

describe("bulk publishing", () => {
  it("selects drafts and live changes, excluding schedules, archives and current public versions", () => {
    expect(canSelectForPublication(article("draft", { status: "draft", isLive: false }))).toBe(
      true,
    );
    expect(canSelectForPublication(article("changed"))).toBe(true);
    for (const fields of [
      { status: "scheduled", isLive: false },
      { status: "archived", isLive: false },
      { hasUnpublishedChanges: false },
    ]) {
      expect(canSelectForPublication(article("excluded", fields))).toBe(false);
    }
  });
  it("continues after a validation failure, preserves the failed item and requests one build", async () => {
    const client = {
      publish: vi.fn(async (id: string) => {
        if (id === "bad") throw blocked();
        return { status: "published", publication: queued };
      }),
      retryPublication: vi.fn(async () => queued),
    };
    const progress = vi.fn();
    const result = await publishSelection(
      [article("a"), article("bad"), article("b")],
      progress,
      client,
    );
    expect(client.publish.mock.calls).toEqual([
      ["a", true],
      ["bad", true],
      ["b", true],
    ]);
    expect(result.items.map((item) => item.published)).toEqual([true, false, true]);
    expect(result.items[1]?.error).toBe("カバー画像を選んでください");
    expect(client.retryPublication).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls).toEqual([[1], [2], [3]]);
  });
  it("does not build when all articles fail validation", async () => {
    const client = {
      publish: vi.fn(async () => {
        throw blocked();
      }),
      retryPublication: vi.fn(async () => queued),
    };
    await publishSelection([article("bad")], () => {}, client);
    expect(client.retryPublication).not.toHaveBeenCalled();
  });
  it("retains accepted articles if dispatch fails so the user can retry the build", async () => {
    const client = {
      publish: vi.fn(async () => ({ status: "published", publication: queued })),
      retryPublication: vi.fn(async () => {
        throw new TypeError("network");
      }),
    };
    const result = await publishSelection([article("a")], () => {}, client);
    expect(result.items[0]?.published).toBe(true);
    expect(result.buildError).toContain("通信できませんでした");
  });
  it("dispatches after an ambiguous response failure and never claims that article succeeded", async () => {
    const client = {
      publish: vi.fn(async () => {
        throw new TypeError("network");
      }),
      retryPublication: vi.fn(async () => queued),
    };
    const result = await publishSelection([article("a")], () => {}, client);
    expect(result.items[0]?.published).toBe(false);
    expect(result.items[0]?.error).toContain("公開結果を確認できませんでした");
    expect(client.retryPublication).toHaveBeenCalledTimes(1);
  });
  it("stops after an expired session and leaves remaining articles for retry", async () => {
    const client = {
      publish: vi.fn(async () => {
        throw new ApiError("API_UNAUTHORIZED", "expired", 401);
      }),
      retryPublication: vi.fn(async () => queued),
    };
    const result = await publishSelection([article("a"), article("b")], () => {}, client);
    expect(client.publish).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(2);
    expect(result.items[1]?.error).toContain("サインイン後");
    expect(client.retryPublication).not.toHaveBeenCalled();
  });
});
