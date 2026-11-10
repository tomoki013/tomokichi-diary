import { useState } from "react";
import { op } from "../../data/client";
import { useAction, useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import { Badge, Button, Empty, Loaded, Page, Row, Rows, Tabs } from "../../ui/parts";
import { factKindLabels, provenanceLabels } from "../editor/KnowledgePanel";

/**
 * Facts waiting for the owner, across every article. Candidates come from
 * the editor or from an AI over MCP; only what is confirmed here reaches the
 * site, structured data and the public MCP.
 */
export function KnowledgeReview() {
  useTitle("旅の知識");
  const [tab, setTab] = useState<"pending" | "backlog">("pending");
  const pending = useOp("knowledge.pending");
  const backlog = useOp("knowledge.backlog");
  const { busy, run } = useAction();
  const review = (factId: string, decision: "verify" | "reject") =>
    run(`${decision}:${factId}`, () => op("knowledge.reviewFact", { factId, decision }), {
      done: decision === "verify" ? "確認済みにしました" : "却下しました",
      touches: ["knowledge", "home"],
    });
  return (
    <Page title="旅の知識" back={{ href: href.more(), label: "その他" }}>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "pending", label: "確認待ち", count: pending.data?.items.length },
          { value: "backlog", label: "未着手の記事", count: backlog.data?.pending },
        ]}
      />
      {tab === "pending" && (
        <Loaded resource={pending}>
          {(data) =>
            data.items.length === 0 ? (
              <Empty>確認待ちの事実はありません。</Empty>
            ) : (
              <Rows>
                {data.items.map((fact) => (
                  <li key={fact.id}>
                    <div className="row" style={{ alignItems: "flex-start" }}>
                      <span className="row__main">
                        <span className="row__title">{fact.statement}</span>
                        <span className="row__meta">
                          {fact.article ? (
                            <a href={href.article(fact.article.id)}>{fact.article.title}</a>
                          ) : (
                            "記事なし"
                          )}{" "}
                          · {factKindLabels[fact.kind]} · {provenanceLabels[fact.provenance]}
                          {fact.experiencedAt ? ` · ${fact.experiencedAt}` : ""}
                        </span>
                      </span>
                      <span className="row__aside" style={{ flexDirection: "column" }}>
                        <Button
                          kind="primary"
                          busy={busy === `verify:${fact.id}`}
                          onClick={() => void review(fact.id, "verify")}
                        >
                          確認
                        </Button>
                        <Button
                          kind="quiet"
                          busy={busy === `reject:${fact.id}`}
                          onClick={() => void review(fact.id, "reject")}
                        >
                          却下
                        </Button>
                      </span>
                    </div>
                  </li>
                ))}
              </Rows>
            )
          }
        </Loaded>
      )}
      {tab === "backlog" && (
        <Loaded resource={backlog}>
          {(data) => (
            <>
              <p className="muted">
                済み {data.migrated}本 · 残り {data.pending}本。ChatGPT や Claude
                に「旅の知識がない記事を5本やって」と頼むと候補が届きます。
              </p>
              <Rows>
                {data.items.map((item) => (
                  <Row
                    key={item.id}
                    href={href.article(item.id)}
                    title={item.title}
                    meta={item.path ?? item.slug}
                    aside={<Badge>未着手</Badge>}
                  />
                ))}
              </Rows>
            </>
          )}
        </Loaded>
      )}
    </Page>
  );
}
