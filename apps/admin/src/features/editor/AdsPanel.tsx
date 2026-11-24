import { adLayoutOf, bodyAdFits, type ArticleDetailDto } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction } from "../../data/hooks";
import { href } from "../../app/router";
import { previewAdBody, type AdPreview } from "../../lib/ad-preview";
import { Badge, Button, Panel } from "../../ui/parts";

export function AdsPanel({
  article,
  preview,
  body,
  dirty,
}: {
  article: ArticleDetailDto;
  preview: AdPreview | null;
  body: string;
  dirty: boolean;
}) {
  const { busy, run } = useAction();
  if (!preview) return null;
  const enabled = adLayoutOf(preview.config) !== "none";
  const live = article.isLive && !article.hasUnpublishedChanges && !dirty;
  const layout = !preview.siteAdsEnabled
    ? "サイト全体で広告オフ"
    : !enabled
      ? "広告なし"
      : previewAdBody(body, preview).markerKey
        ? "本文中＋末尾"
        : "末尾のみ";
  const misplaced = preview.config.placements.some(
    (p) =>
      p.position === "marker" &&
      body.includes(`{{monetization:${p.key}}}`) &&
      !bodyAdFits(body, p.key),
  );
  return (
    <Panel id="ads" title="広告" collapsible>
      <div className="inline">
        <span>この本文の配置</span>
        <Badge>{layout}</Badge>
      </div>
      <p className="muted">
        本文中の広告は、配置できる段落があるときに表示します。アンカー広告のテストは
        <a href={href.ads()}>収益化</a>で全記事共通の設定を使います。
      </p>
      <div className="inline">
        <Button
          disabled={!live}
          busy={busy === "layout"}
          onClick={() =>
            void run(
              "layout",
              () =>
                op("ads.setLayout", {
                  articleId: article.id,
                  layout: enabled ? "none" : "standard",
                }),
              {
                done: "広告の変更を下書きに保存しました。「変更を公開」で反映します",
                touches: ["ads", "article"],
              },
            )
          }
        >
          {enabled ? "この記事の広告を外す" : "基本配置に戻す"}
        </Button>
        {misplaced && (
          <Button
            kind="quiet"
            disabled={dirty}
            busy={busy === "move"}
            onClick={() =>
              void run("move", () => op("ads.moveBodyAds", { articleId: article.id }), {
                done: "広告マーカーを見直しました",
                touches: ["ads", "article"],
              })
            }
          >
            本文中の広告の位置を直す
          </Button>
        )}
      </div>
      {!live && (
        <p className="muted">
          個別に広告の有無を変更するには、未公開の編集がない公開中の記事を選んでください。
        </p>
      )}
    </Panel>
  );
}
