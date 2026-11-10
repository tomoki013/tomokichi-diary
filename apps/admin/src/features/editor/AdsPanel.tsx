import {
  adLayoutLabels,
  adLayoutOf,
  testDay,
  TEST_MIN_DAYS,
  type ArticleDetailDto,
} from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp } from "../../data/hooks";
import { Badge, Button, Loaded, Panel, confirmed } from "../../ui/parts";

const touches = ["ads", "article"];

/**
 * This article's ads, by the site's ad standard: no positions or units to
 * pick by hand. A position test compares two body-ad spots on a live article.
 */
export function AdsPanel({ article }: { article: ArticleDetailDto }) {
  const ads = useOp("ads.article", { articleId: article.id });
  const { busy, run } = useAction();
  const live = article.isLive && !article.hasUnpublishedChanges;
  return (
    <Panel id="ads" title="広告" collapsible>
      <Loaded resource={ads} lines={2}>
        {(data) => {
          const running = data.experiments.find((e) => e.status === "running");
          return (
            <>
              <div className="inline">
                <span>いまの配置</span>
                <Badge tone="accent">{adLayoutLabels[adLayoutOf(data.draft)]}</Badge>
                {data.needsPublication && <Badge tone="warn">変更は未公開</Badge>}
              </div>
              {running && (
                <p className="muted">
                  位置テスト中（{testDay(running)}日目。{TEST_MIN_DAYS}日以上で判断の目安）
                </p>
              )}
              {!live && (
                <p className="muted">
                  広告の変更は、公開中で未公開の変更がない記事でだけ行えます。
                </p>
              )}
              <div className="inline">
                {(["standard", "end-only", "none"] as const).map((layout) => (
                  <Button
                    key={layout}
                    disabled={!live}
                    busy={busy === layout}
                    onClick={() =>
                      void run(
                        layout,
                        async () => {
                          if (
                            running &&
                            !confirmed("動いている位置テストは終了します。よろしいですか？")
                          )
                            return;
                          const result = await op("ads.setLayout", {
                            articleId: article.id,
                            layout,
                          });
                          return result;
                        },
                        {
                          done: "広告を揃えて下書き保存しました。「変更を公開」で反映します",
                          touches,
                        },
                      )
                    }
                  >
                    {adLayoutLabels[layout]}にする
                  </Button>
                ))}
                {running ? (
                  <Button
                    busy={busy === "stop"}
                    onClick={() =>
                      confirmed("位置テストを終了します。再開はできません。") &&
                      void run(
                        "stop",
                        () =>
                          op("ads.controlExperiment", { experimentId: running.id, action: "stop" }),
                        {
                          done: "テストを終了しました",
                          touches,
                        },
                      )
                    }
                  >
                    テストを終了
                  </Button>
                ) : (
                  <Button
                    disabled={!live}
                    busy={busy === "test"}
                    onClick={() =>
                      void run("test", () => op("ads.startTest", { articleId: article.id }), {
                        done: "位置テストを始めて下書き保存しました。「変更を公開」で開始されます",
                        touches,
                      })
                    }
                  >
                    位置テストを始める
                  </Button>
                )}
                <Button
                  kind="quiet"
                  busy={busy === "move"}
                  onClick={() =>
                    void run("move", () => op("ads.moveBodyAds", { articleId: article.id }), {
                      done: "本文中の広告を公開ルールに合う段落へ移しました",
                      touches,
                    })
                  }
                >
                  本文中の広告の位置を直す
                </Button>
              </div>
            </>
          );
        }}
      </Loaded>
    </Panel>
  );
}
