import { useMemo, useState } from "react";
import type { ArticleSummaryDto } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { invalidate, useAction, useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import { phaseOf, type Phase } from "../../lib/article-state";
import { formatRelative } from "../../lib/labels";
import { PhaseBadge } from "../../ui/PhaseBadge";
import {
  Button,
  Check,
  Empty,
  LinkButton,
  Loaded,
  Page,
  Rows,
  Tabs,
  TextInput,
  confirmed,
} from "../../ui/parts";

type Filter = "all" | "draft" | "changed" | "live" | "scheduled" | "pages" | "archived";
const FILTERS: { value: Filter; label: string; test: (a: ArticleSummaryDto) => boolean }[] = [
  { value: "all", label: "すべて", test: (a) => a.kind === "article" && phaseOf(a) !== "archived" },
  {
    value: "draft",
    label: "下書き",
    test: (a) => a.kind === "article" && ["draft", "withdrawn"].includes(phaseOf(a)),
  },
  { value: "changed", label: "未公開の変更", test: (a) => phaseOf(a) === "changed" },
  {
    value: "live",
    label: "公開中",
    test: (a) => a.kind === "article" && ["live", "changed"].includes(phaseOf(a)),
  },
  { value: "scheduled", label: "予約", test: (a) => phaseOf(a) === "scheduled" },
  { value: "pages", label: "固定ページ", test: (a) => a.kind === "page" },
  { value: "archived", label: "アーカイブ", test: (a) => phaseOf(a) === "archived" },
];
const publishable = (phase: Phase) =>
  phase === "draft" || phase === "withdrawn" || phase === "changed";

/**
 * Every article and page. Picking several publishes them in one go: each
 * passes its own publish check, and the site is rebuilt once at the end.
 */
export function ArticleList({ filter }: { filter: string | null }) {
  useTitle("記事");
  const list = useOp("article.list");
  const [tab, setTab] = useState<Filter>(
    (FILTERS.some((f) => f.value === filter) ? filter : "all") as Filter,
  );
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const { busy, run } = useAction();

  const items = useMemo(() => {
    const test = FILTERS.find((f) => f.value === tab)!.test;
    const needle = query.trim().toLowerCase();
    return (list.data?.items ?? [])
      .filter(test)
      .filter(
        (a) => !needle || `${a.title} ${a.slug} ${a.path ?? ""}`.toLowerCase().includes(needle),
      )
      .toSorted((a, b) =>
        (b.contentUpdatedAt ?? b.updatedAt).localeCompare(a.contentUpdatedAt ?? a.updatedAt),
      );
  }, [list.data, tab, query]);

  async function publishPicked() {
    if (!confirmed(`${picked.length}件を公開します。よろしいですか？`)) return;
    const failed: string[] = [];
    await run(
      "bulk",
      async () => {
        for (const id of picked) {
          const check = await op("article.publishCheck", { articleId: id });
          if (!check.publishable) {
            failed.push(id);
            continue;
          }
          await op("article.publish", { articleId: id, deferBuild: true }).catch(() =>
            failed.push(id),
          );
        }
        if (failed.length < picked.length) await op("publication.run");
      },
      { touches: ["article", "publication", "home"] },
    );
    setPicked(failed);
    if (failed.length > 0) invalidate("article");
  }

  return (
    <Page
      title="記事"
      actions={
        <>
          <LinkButton href={href.newArticle()} kind="primary">
            新しい記事
          </LinkButton>
          <LinkButton href={href.newArticle("page")}>固定ページ</LinkButton>
        </>
      }
    >
      <Tabs
        value={tab}
        onChange={(value) => {
          setTab(value);
          setPicked([]);
        }}
        options={FILTERS.map((f) => ({
          value: f.value,
          label: f.label,
          count: list.data?.items.filter(f.test).length,
        }))}
      />
      <TextInput
        label="絞り込み"
        type="search"
        value={query}
        onChange={setQuery}
        placeholder="タイトル・slug・URL"
      />
      {picked.length > 0 && (
        <div className="spread">
          <span className="muted">
            {picked.length}件を選択中（公開前チェックに通らないものは残ります）
          </span>
          <Button kind="primary" busy={busy === "bulk"} onClick={() => void publishPicked()}>
            まとめて公開
          </Button>
        </div>
      )}
      <Loaded resource={list} lines={8}>
        {() =>
          items.length === 0 ? (
            <Empty>該当する記事はありません。</Empty>
          ) : (
            <Rows>
              {items.map((article) => (
                <li key={article.id}>
                  <div className="row">
                    {publishable(phaseOf(article)) && (
                      <Check
                        label={<span className="visually-hidden">{article.title}を選ぶ</span>}
                        checked={picked.includes(article.id)}
                        onChange={(on) =>
                          setPicked((current) =>
                            on
                              ? [...current, article.id]
                              : current.filter((id) => id !== article.id),
                          )
                        }
                      />
                    )}
                    <a
                      className="row__main"
                      href={href.article(article.id)}
                      style={{ textDecoration: "none", color: "inherit" }}
                    >
                      <span className="row__title">{article.title || article.slug}</span>
                      <span className="row__meta">
                        {article.path ?? article.slug} ·{" "}
                        {formatRelative(article.contentUpdatedAt ?? article.updatedAt)}
                      </span>
                    </a>
                    <span className="row__aside">
                      <PhaseBadge article={article} />
                    </span>
                  </div>
                </li>
              ))}
            </Rows>
          )
        }
      </Loaded>
    </Page>
  );
}
