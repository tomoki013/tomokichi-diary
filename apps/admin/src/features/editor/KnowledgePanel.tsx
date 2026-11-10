import { useState } from "react";
import type { ArticleDetailDto, TravelFactDto } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp } from "../../data/hooks";
import { Badge, Button, Empty, Loaded, Panel, Select, TextArea, TextInput } from "../../ui/parts";

export const provenanceLabels: Record<TravelFactDto["provenance"], string> = {
  firsthand: "一次体験",
  official: "公式",
  researched: "調査",
  derived: "推定",
};
export const factKindLabels: Record<TravelFactDto["kind"], string> = {
  visit: "訪問",
  food_drink: "飲食",
  transport: "交通",
  cost: "費用",
  duration: "所要時間",
  procedure: "手続き",
  observation: "見たこと",
  recommendation: "おすすめ",
  warning: "注意",
  current_fact: "最新情報",
};
const options = <T extends string>(labels: Record<T, string>) =>
  (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));

/**
 * The article's travel knowledge: facts read from the body. A new fact is a
 * candidate until the owner confirms it; only confirmed ones reach the site.
 * An AI connected over MCP can propose them too (propose_travel_facts).
 */
export function KnowledgePanel({ article }: { article: ArticleDetailDto }) {
  const [open, setOpen] = useState(false);
  return (
    <Panel
      id="knowledge"
      title="旅の知識"
      hint="本文の事実を確認済みにしてサイトや AI に出す"
      collapsible
      onOpen={() => setOpen(true)}
    >
      {open && <KnowledgeBody article={article} />}
    </Panel>
  );
}

function KnowledgeBody({ article }: { article: ArticleDetailDto }) {
  const bundle = useOp("knowledge.get", { articleId: article.id });
  const { busy, run } = useAction();
  const [statement, setStatement] = useState("");
  const [kind, setKind] = useState<TravelFactDto["kind"]>("visit");
  const [provenance, setProvenance] = useState<TravelFactDto["provenance"]>("firsthand");
  const [date, setDate] = useState(article.travelStartDate ?? "");
  const touches = ["knowledge", "home"];
  async function propose() {
    const done = await run(
      "propose",
      () =>
        op("knowledge.proposeFacts", {
          articleId: article.id,
          facts: [{ statement, kind, provenance, experiencedAt: date || null }],
        }),
      { done: "候補として追加しました", touches },
    );
    if (done) setStatement("");
  }
  const review = (factId: string, decision: "verify" | "reject") =>
    run(decision, () => op("knowledge.reviewFact", { factId, decision }), {
      done: decision === "verify" ? "確認済みにしました" : "却下しました",
      touches,
    });
  return (
    <Loaded resource={bundle} lines={3}>
      {(data) => (
        <>
          {data.article?.quickAnswer && (
            <p>
              <strong>要点:</strong> {data.article.quickAnswer.summary}
            </p>
          )}
          {data.facts.length === 0 ? (
            <Empty>まだ事実がありません。</Empty>
          ) : (
            <ul className="rows">
              {data.facts.map((fact) => (
                <li key={fact.id}>
                  <div className="row">
                    <span className="row__main">
                      <span className="row__title">{fact.statement}</span>
                      <span className="row__meta">
                        {factKindLabels[fact.kind]} · {provenanceLabels[fact.provenance]}
                        {fact.experiencedAt ? ` · ${fact.experiencedAt}` : ""}
                      </span>
                    </span>
                    <span className="row__aside">
                      {fact.status === "verified" ? (
                        <Badge tone="ok">確認済み</Badge>
                      ) : (
                        <>
                          <Button
                            kind="primary"
                            busy={busy === "verify"}
                            onClick={() => void review(fact.id, "verify")}
                          >
                            確認
                          </Button>
                          <Button
                            kind="quiet"
                            busy={busy === "reject"}
                            onClick={() => void review(fact.id, "reject")}
                          >
                            却下
                          </Button>
                        </>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h3>事実を足す</h3>
          <TextArea
            label="本文に書いてある事実（1文）"
            value={statement}
            onChange={setStatement}
            rows={2}
            max={4000}
          />
          <div className="inline">
            <Select
              label="種類"
              value={kind}
              options={options(factKindLabels)}
              onChange={setKind}
            />
            <Select
              label="出どころ"
              value={provenance}
              options={options(provenanceLabels)}
              onChange={setProvenance}
            />
            <TextInput label="体験した日" type="date" value={date} onChange={setDate} />
          </div>
          <Button
            busy={busy === "propose"}
            disabled={!statement.trim()}
            onClick={() => void propose()}
          >
            候補として追加
          </Button>
        </>
      )}
    </Loaded>
  );
}
