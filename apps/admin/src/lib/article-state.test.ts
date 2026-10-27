import { describe, expect, it } from "vitest";
import type { SitePublicationStatus } from "@tomokichi/contracts";
import { articleState, phaseOf } from "./article-state";

const site = (patch: Partial<SitePublicationStatus>): SitePublicationStatus => ({
  state: "deployed",
  configured: true,
  requestId: "request",
  buildId: null,
  stage: null,
  requestedAt: null,
  startedAt: null,
  stageStartedAt: null,
  deployedAt: null,
  durationMs: null,
  elapsedMs: null,
  errorCode: null,
  buildUrl: null,
  error: null,
  stages: {},
  ...patch,
});

const live = {
  status: "published",
  isLive: true,
  hasUnpublishedChanges: false,
  publishedAt: "2026-10-01T00:00:00Z",
  scheduledAt: null,
  updatedAt: "2026-10-20T00:00:00Z",
} as const;

const text = (lines: ReturnType<typeof articleState>, label: string) =>
  lines.find((line) => line.label === label)?.text;

describe("articleState", () => {
  it("describes a never-published draft without the site", () => {
    const lines = articleState(
      { ...live, status: "draft", isLive: false, publishedAt: null },
      false,
      site({ state: "failed" }),
    );
    expect(text(lines, "この記事")).toContain("まだ一度も公開していません");
    expect(text(lines, "サイト")).toBeUndefined();
  });

  it("flags unsaved edits", () => {
    expect(text(articleState(live, true, site({})), "編集")).toContain("未保存");
  });

  it("is reflected once the site deployed after this article's publish", () => {
    const lines = articleState(live, false, site({ deployedAt: "2026-10-20T00:05:00Z" }));
    expect(text(lines, "サイト")).toContain("反映済み");
  });

  it("waits when the last deploy predates the publish", () => {
    const lines = articleState(live, false, site({ deployedAt: "2026-10-19T00:00:00Z" }));
    expect(text(lines, "サイト")).toBe("サイトへの反映待ちです。");
  });

  it("is in progress when a build was requested after the publish", () => {
    const lines = articleState(
      live,
      false,
      site({ state: "building", requestedAt: "2026-10-20T00:00:01Z" }),
    );
    expect(text(lines, "サイト")).toContain("反映しています");
  });

  it("does not claim a wait when the site has no publication record", () => {
    const lines = articleState(live, false, site({ requestId: null }));
    expect(text(lines, "サイト")).toBe("サイトへの反映記録はありません。");
  });

  it("keeps showing the published version while saved changes wait", () => {
    const lines = articleState(
      { ...live, hasUnpublishedChanges: true },
      false,
      site({ deployedAt: "2026-10-01T00:00:00Z" }),
    );
    expect(text(lines, "この記事")).toContain("まだ公開していません");
    expect(text(lines, "サイト")).toBe("前回公開した版を表示しています。");
  });

  it("stays reflected when a later, unrelated build failed", () => {
    const lines = articleState(
      live,
      false,
      site({ state: "failed", deployedAt: "2026-10-20T00:05:00Z" }),
    );
    expect(text(lines, "サイト")).toContain("反映済み");
  });
});

describe("phaseOf", () => {
  it("never calls a draft's unpublished revision a pending change", () => {
    expect(
      phaseOf({
        ...live,
        status: "draft",
        isLive: false,
        hasUnpublishedChanges: true,
        publishedAt: null,
      }),
    ).toBe("draft");
    expect(phaseOf({ ...live, status: "draft", isLive: false, hasUnpublishedChanges: true })).toBe(
      "withdrawn",
    );
    expect(phaseOf({ ...live, hasUnpublishedChanges: true })).toBe("changed");
    expect(phaseOf(live)).toBe("live");
    expect(phaseOf({ ...live, isLive: false })).toBe("scheduled");
  });
});
