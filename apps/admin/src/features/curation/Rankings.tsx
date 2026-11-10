import { useState } from "react";
import type { RankingAdminDto } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp, useTitle } from "../../data/hooks";
import { go, href } from "../../app/router";
import { experienceLabels } from "../../lib/labels";
import { MediaPicker } from "../../ui/MediaPicker";
import { Badge, Button, Loaded, Page, Panel, Row, Rows, Select, TextInput } from "../../ui/parts";

/** The home page's rankings: ordered picks, each with a word on why. */
export function RankingList() {
  useTitle("ランキング");
  const list = useOp("ranking.list");
  const [title, setTitle] = useState("");
  const { busy, run } = useAction();
  return (
    <Page title="ランキング" back={{ href: href.more(), label: "その他" }}>
      <Loaded resource={list} lines={5}>
        {(data) => (
          <Rows>
            {data.items.map((ranking) => (
              <Row
                key={ranking.id}
                href={href.ranking(ranking.id)}
                title={ranking.title}
                meta={ranking.note || `${ranking.picks.length}本`}
                aside={
                  <Badge tone={ranking.liveCount > 0 ? "ok" : "neutral"}>
                    {ranking.liveCount > 0 ? `表示 ${ranking.liveCount}本` : "非表示"}
                  </Badge>
                }
              />
            ))}
          </Rows>
        )}
      </Loaded>
      <Panel title="ランキングを作る" collapsible>
        <TextInput label="名前" value={title} onChange={setTitle} max={60} />
        <Button
          kind="primary"
          busy={busy === "create"}
          disabled={!title.trim()}
          onClick={async () => {
            const created = await run("create", () => op("ranking.create", { title }), {
              touches: ["ranking"],
            });
            if (created) go(href.ranking(created.id));
          }}
        >
          作る
        </Button>
      </Panel>
    </Page>
  );
}

export function RankingEdit({ id }: { id: string }) {
  const ranking = useOp("ranking.get", { rankingId: id });
  return (
    <Loaded resource={ranking}>
      {(data) => <RankingForm key={data.updatedAt ?? data.id} ranking={data} />}
    </Loaded>
  );
}

interface Pick {
  article: string;
  comment: string;
  title: string;
}

function RankingForm({ ranking }: { ranking: RankingAdminDto }) {
  useTitle(ranking.title);
  const articles = useOp("article.list");
  const [title, setTitle] = useState(ranking.title);
  const [note, setNote] = useState(ranking.note);
  const [tag, setTag] = useState(ranking.experienceTag ?? "");
  const [sortOrder, setSortOrder] = useState(String(ranking.sortOrder));
  const [photo, setPhoto] = useState<{ id: string | null; url: string | null }>({
    id: ranking.photo?.mediaId ?? null,
    url: ranking.photo?.thumbnailUrl ?? ranking.photo?.url ?? null,
  });
  const [picks, setPicks] = useState<Pick[]>(
    ranking.picks.map((p) => ({ article: p.articleId, comment: p.comment, title: p.title })),
  );
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const { busy, run } = useAction();
  const matches = query.trim()
    ? (articles.data?.items ?? [])
        .filter(
          (a) =>
            a.kind === "article" &&
            a.title.includes(query.trim()) &&
            !picks.some((p) => p.article === a.id),
        )
        .slice(0, 8)
    : [];
  const move = (index: number, by: number) =>
    setPicks((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item!);
      return next;
    });
  return (
    <Page title={ranking.title} back={{ href: href.rankings(), label: "ランキング" }}>
      <Panel title="基本">
        <TextInput label="名前" value={title} onChange={setTitle} max={60} />
        <TextInput label="手書き風の添え書き" value={note} onChange={setNote} max={40} />
        <Select
          label="「もっと読む」の行き先"
          value={tag}
          options={[
            { value: "", label: "なし" },
            ...Object.entries(experienceLabels).map(([value, label]) => ({ value, label })),
          ]}
          onChange={setTag}
        />
        <TextInput label="表示順" type="number" value={sortOrder} onChange={setSortOrder} />
        <div className="inline">
          {photo.url && (
            <img
              src={photo.url}
              alt=""
              width={96}
              height={64}
              style={{ objectFit: "cover", borderRadius: 6 }}
            />
          )}
          <Button onClick={() => setPicking(true)}>
            {photo.id ? "写真を変える" : "写真を選ぶ"}
          </Button>
          {photo.id && (
            <Button kind="quiet" onClick={() => setPhoto({ id: null, url: null })}>
              外す
            </Button>
          )}
        </div>
      </Panel>
      <Panel title="順位" hint={`${picks.length}/15`}>
        {picks.map((pick, index) => (
          <div
            key={pick.article}
            className="stack"
            style={{ borderTop: index ? "1px solid var(--line)" : 0, paddingTop: index ? 8 : 0 }}
          >
            <div className="spread">
              <strong>
                {index + 1}位 {pick.title}
              </strong>
              <span className="inline">
                <Button kind="quiet" disabled={index === 0} onClick={() => move(index, -1)}>
                  上へ
                </Button>
                <Button
                  kind="quiet"
                  disabled={index === picks.length - 1}
                  onClick={() => move(index, 1)}
                >
                  下へ
                </Button>
                <Button
                  kind="quiet"
                  onClick={() => setPicks((c) => c.filter((_, i) => i !== index))}
                >
                  外す
                </Button>
              </span>
            </div>
            <TextInput
              label="一言"
              value={pick.comment}
              max={80}
              onChange={(comment) =>
                setPicks((c) => c.map((p, i) => (i === index ? { ...p, comment } : p)))
              }
            />
          </div>
        ))}
        {picks.length < 15 && (
          <>
            <TextInput
              label="記事を足す"
              type="search"
              value={query}
              onChange={setQuery}
              placeholder="タイトルで探す"
            />
            {matches.map((a) => (
              <Button
                key={a.id}
                kind="quiet"
                onClick={() => {
                  setPicks((c) => [...c, { article: a.id, comment: "", title: a.title }]);
                  setQuery("");
                }}
              >
                ＋ {a.title}
              </Button>
            ))}
          </>
        )}
      </Panel>
      <Button
        kind="primary"
        busy={busy === "save"}
        onClick={() =>
          void run(
            "save",
            () =>
              op("ranking.update", {
                rankingId: ranking.id,
                title,
                note,
                experienceTag: tag || null,
                photoMediaId: photo.id,
                sortOrder: Number(sortOrder) || 0,
                picks: picks.map(({ article, comment }) => ({ article, comment })),
              }),
            { done: "保存しました。トップページへは次の反映で出ます", touches: ["ranking"] },
          )
        }
      >
        保存
      </Button>
      {picking && (
        <MediaPicker
          title="ランキングの写真"
          onClose={() => setPicking(false)}
          onPick={(asset) => {
            setPhoto({ id: asset.id, url: asset.thumbnailUrl ?? asset.url });
            setPicking(false);
          }}
        />
      )}
    </Page>
  );
}
