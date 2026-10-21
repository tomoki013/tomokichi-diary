import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicationStatus } from "../lib/api";
import { SitePublication } from "./SitePublication";
const status: PublicationStatus = {
  state: "building",
  configured: true,
  requestId: "request",
  buildId: "execution",
  stage: "site",
  requestedAt: "2026-10-21T00:00:00Z",
  startedAt: "2026-10-21T00:00:10Z",
  stageStartedAt: "2026-10-21T00:00:20Z",
  deployedAt: null,
  durationMs: null,
  elapsedMs: 42000,
  errorCode: null,
  buildUrl: "https://github.com/example/actions/runs/1",
  error: null,
  stages: {
    data: { state: "completed", startedAt: "2026-10-21T00:00:10Z" },
    images: { state: "skipped", startedAt: "2026-10-21T00:00:20Z" },
    site: { state: "running", startedAt: "2026-10-21T00:00:20Z" },
  },
};
const render = (data: PublicationStatus) =>
  renderToStaticMarkup(
    createElement(SitePublication, {
      publication: { data, loading: false, error: null, reload: async () => {}, setData: () => {} },
      disabled: false,
      onRetry: () => {},
    }),
  );
describe("site publication progress UI", () => {
  it("clearly scopes progress to the site and shows actual skipped/current stages", () => {
    const html = render(status);
    expect(html).toContain("サイト全体の公開状況");
    expect(html).toContain("現在：");
    expect(html).toContain("サイト生成中");
    expect(html).toContain("画像処理");
    expect(html).toContain("（省略）");
    expect(html).toContain('aria-current="step"');
    expect(html).not.toContain("サイトに反映済み");
    expect(html).not.toContain("%");
  });
  it("shows confirmed completion time and public link", () => {
    const html = render({
      ...status,
      state: "deployed",
      durationMs: 42000,
      deployedAt: "2026-10-21T00:00:42Z",
    });
    expect(html).toContain("サイトに反映済み");
    expect(html).toContain("42");
    expect(html).toContain("2026/10/21");
    expect(html).toContain('href="https://tomokichidiary.com"');
  });
  it("provides failure details, logs and retry without claiming completion", () => {
    const html = render({
      ...status,
      state: "failed",
      error: "配信を確認できませんでした",
      errorCode: "STEP_VERIFY",
    });
    expect(html).toContain("配信を確認できませんでした");
    expect(html).toContain("STEP_VERIFY");
    expect(html).toContain("再試行");
    expect(html).toContain(status.buildUrl!);
    expect(html).not.toContain("サイトに反映済み");
  });
  it("does not claim a deployment when no request has ever been made", () => {
    const html = render({
      ...status,
      state: "deployed",
      requestId: null,
      buildId: null,
      stages: {},
    });
    expect(html).toContain("サイトの公開要求はありません");
    expect(html).not.toContain("サイトに反映済み");
  });
});
