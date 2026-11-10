import { publicationStages } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import { siteStateLabel } from "../../app/SiteState";
import { formatDateTime } from "../../lib/labels";
import { Badge, Button, Loaded, Page, Panel, confirmed } from "../../ui/parts";

const stageLabels: Record<string, string> = {
  data: "データ",
  images: "画像",
  site: "ページ生成",
  checks: "検査",
  deploy: "配信",
  verify: "確認",
};

/** The site's publication: what is live, what is on its way, and a retry. */
export function SitePublication() {
  useTitle("サイト反映");
  const status = useOp("publication.status");
  const { busy, run } = useAction();
  return (
    <Page title="サイト反映" back={{ href: href.more(), label: "その他" }}>
      <Loaded resource={status}>
        {(data) => (
          <Panel title={siteStateLabel(data)}>
            <p>最後に反映: {formatDateTime(data.deployedAt)}</p>
            {data.requestedAt && (
              <p className="muted">最後の依頼: {formatDateTime(data.requestedAt)}</p>
            )}
            {data.error && <p className="error-box">{data.error}</p>}
            {data.stage && (
              <div className="inline">
                {publicationStages.map((stage) => (
                  <Badge
                    key={stage}
                    tone={data.stages[stage] ? "ok" : stage === data.stage ? "accent" : "neutral"}
                  >
                    {stageLabels[stage] ?? stage}
                  </Badge>
                ))}
              </div>
            )}
            {data.buildUrl && (
              <a href={data.buildUrl} target="_blank" rel="noreferrer">
                ビルドのログ
              </a>
            )}
            <Button
              kind="primary"
              busy={busy === "run"}
              onClick={() =>
                confirmed("いまの公開版でサイト全体を作り直して配信します。") &&
                void run("run", () => op("publication.run"), {
                  done: "反映を始めました",
                  touches: ["publication", "home"],
                })
              }
            >
              サイトに反映する
            </Button>
            <p className="muted">
              ランキングやシリーズの変更は、ここか記事の公開でサイトに出ます。
            </p>
          </Panel>
        )}
      </Loaded>
    </Page>
  );
}
