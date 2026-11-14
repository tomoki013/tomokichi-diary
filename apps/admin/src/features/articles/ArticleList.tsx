import { useMemo, useState } from "react";
import type { ArticleSummaryDto } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { invalidate, useAction, useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import {
  GROUP_OPTIONS,
  filedUnder,
  groupArticles,
  type GroupBy,
  type GroupNames,
} from "../../lib/article-groups";
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
  Panel,
  Rows,
  Select,
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

const GROUP_KEY = "admin.articles.groupBy";
function storedGroup(): GroupBy {
  try {
    const value = localStorage.getItem(GROUP_KEY);
    if (GROUP_OPTIONS.some((option) => option.value === value)) return value as GroupBy;
  } catch {
    // Private windows: the choice simply is not remembered.
  }
  return "trip";
}

/**
 * Every article and page, in the piles an author looks for one in (a journey,
 * a country, a category). Picking several publishes them in one go: each
 * passes its own publish check, and the site is rebuilt once at the end.
 */
export function ArticleList({ filter }: { filter: string | null }) {
  useTitle("記事");
  const list = useOp("article.list");
  const series = useOp("series.list", {});
  const locations = useOp("location.list");
  const taxonomy = useOp("taxonomy.get");
  const [groupBy, setGroupBy] = useState<GroupBy>(storedGroup);
  const [tab, setTab] = useState<Filter>(
    (FILTERS.some((f) => f.value === filter) ? filter : "all") as Filter,
  );
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const { busy, run } = useAction();

  const names = useMemo<GroupNames>(
    () => ({
      collections: series.data?.items ?? [],
      locations: locations.data?.items ?? [],
      categories: taxonomy.data?.categories ?? [],
    }),
    [series.data, locations.data, taxonomy.data],
  );
  const needles = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const groups = useMemo(() => {
    const test = FILTERS.find((f) => f.value === tab)!.test;
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const items = (list.data?.items ?? []).filter(test).filter((a) => {
      if (words.length === 0) return true;
      const text = `${a.title} ${a.slug} ${a.path ?? ""} ${filedUnder(a, names)}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
    // Pages are not filed anywhere: one flat list.
    return groupArticles(items, tab === "pages" ? "none" : groupBy, names);
  }, [list.data, tab, query, groupBy, names]);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

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
        placeholder="タイトル・slug・旅程・国"
      />
      {tab !== "pages" && (
        <Select
          label="まとめ方"
          value={groupBy}
          options={GROUP_OPTIONS}
          onChange={(value) => {
            setGroupBy(value);
            try {
              localStorage.setItem(GROUP_KEY, value);
            } catch {
              // Not remembered; the list still regroups.
            }
          }}
        />
      )}
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
        {() => {
          const rows = (items: readonly ArticleSummaryDto[]) => (
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
          );
          if (total === 0) return <Empty>該当する記事はありません。</Empty>;
          if (groups.length === 1 && groups[0]!.label === "") return rows(groups[0]!.items);
          return (
            <>
              {groups.map((group, index) => (
                <Panel
                  key={group.key}
                  title={group.label}
                  hint={`${group.hint ? `${group.hint} · ` : ""}${group.items.length}件`}
                  collapsible
                  open={needles.length > 0 || index === 0}
                >
                  {rows(group.items)}
                </Panel>
              ))}
            </>
          );
        }}
      </Loaded>
    </Page>
  );
}
