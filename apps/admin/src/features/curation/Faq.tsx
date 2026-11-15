import { useCallback, useMemo, useState } from "react";
import {
  faqProblems,
  formatFaqMarkdown,
  parseFaqMarkdown,
  type ArticleDetailDto,
  type FaqGroup,
} from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp, useTitle, useUnsavedWarning } from "../../data/hooks";
import { href } from "../../app/router";
import { PublishPanel } from "../editor/PublishPanel";
import { Button, Empty, Loaded, Page, Panel, TextArea, TextInput, confirmed } from "../../ui/parts";

const FAQ_PATH = "/faq";

/**
 * The FAQ page (`/faq`) as questions and answers instead of raw Markdown.
 * It is still the fixed page's body underneath: saving writes the same
 * `## カテゴリ / ### 質問 / 答え` Markdown through `article.saveDraft`, and
 * publishing goes through the same publish check as every page.
 */
export function Faq() {
  useTitle("よくある質問");
  const list = useOp("article.list");
  return (
    <Page title="よくある質問" back={{ href: href.more(), label: "その他" }}>
      <Loaded resource={list} lines={6}>
        {(data) => {
          const page = data.items.find((item) => item.path === FAQ_PATH);
          return page ? (
            <FaqLoader id={page.id} />
          ) : (
            <Empty>/faq の固定ページが見つかりません。</Empty>
          );
        }}
      </Loaded>
    </Page>
  );
}

function FaqLoader({ id }: { id: string }) {
  const article = useOp("article.get", { articleId: id });
  return (
    <Loaded resource={article} lines={10}>
      {(data) => <Editor key={data.currentRevision?.id ?? data.id} article={data} />}
    </Loaded>
  );
}

interface EditItem {
  key: number;
  question: string;
  answer: string;
}
interface EditGroup {
  key: number;
  title: string;
  items: EditItem[];
}

let nextKey = 1;
const keyed = (groups: FaqGroup[]): EditGroup[] =>
  groups.map((group) => ({
    key: nextKey++,
    title: group.title,
    items: group.items.map((item) => ({ key: nextKey++, ...item })),
  }));
const plain = (groups: EditGroup[]): FaqGroup[] =>
  groups.map((group) => ({
    title: group.title,
    items: group.items.map(({ question, answer }) => ({ question, answer })),
  }));

function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(index + by, 0, item!);
  return next;
}

function Editor({ article }: { article: ArticleDetailDto }) {
  const savedBody = article.currentRevision?.bodyMarkdown ?? "";
  const savedSummary = article.currentRevision?.summary ?? "";
  const [groups, setGroups] = useState(() => keyed(parseFaqMarkdown(savedBody)));
  const [summary, setSummary] = useState(savedSummary);
  const [problems, setProblems] = useState<string[]>([]);
  const body = useMemo(() => formatFaqMarkdown(plain(groups)), [groups]);
  const dirty = body !== formatFaqMarkdown(parseFaqMarkdown(savedBody)) || summary !== savedSummary;
  useUnsavedWarning(dirty);
  const { busy, run } = useAction();

  const setGroup = (index: number, change: (group: EditGroup) => EditGroup) =>
    setGroups((current) => current.map((group, i) => (i === index ? change(group) : group)));
  const setItem = (groupIndex: number, itemIndex: number, change: Partial<EditItem>) =>
    setGroup(groupIndex, (group) => ({
      ...group,
      items: group.items.map((item, i) => (i === itemIndex ? { ...item, ...change } : item)),
    }));

  const save = useCallback(async (): Promise<boolean> => {
    const found = faqProblems(plain(groups));
    setProblems(found);
    if (found.length > 0) return false;
    const result = await run(
      "save",
      () =>
        op("article.saveDraft", {
          articleId: article.id,
          summary,
          bodyMarkdown: body,
          changeSummary: "よくある質問を更新",
        }),
      { done: "保存しました。公開するとサイトに出ます", touches: ["article", "home"] },
    );
    return result !== undefined;
  }, [article.id, body, groups, run, summary]);

  const count = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div className="stack">
      <p className="muted">
        カテゴリごとに質問と答えを並べます。答えは記事の本文と同じ書き方で、
        [お問い合わせ](/contact) のようにリンクも書けます。
      </p>
      <TextArea
        label="ページの説明（見出しの下と検索結果に出ます）"
        value={summary}
        onChange={setSummary}
        rows={3}
        max={400}
      />
      {groups.map((group, groupIndex) => (
        <Panel
          key={group.key}
          title={group.title || "名前のないカテゴリ"}
          hint={`${group.items.length}問`}
          actions={
            <>
              <Button
                kind="quiet"
                disabled={groupIndex === 0}
                onClick={() => setGroups((c) => move(c, groupIndex, -1))}
              >
                上へ
              </Button>
              <Button
                kind="quiet"
                disabled={groupIndex === groups.length - 1}
                onClick={() => setGroups((c) => move(c, groupIndex, 1))}
              >
                下へ
              </Button>
              <Button
                kind="quiet"
                onClick={() => {
                  if (
                    group.items.length > 0 &&
                    !confirmed(`「${group.title}」を質問ごと消しますか？`)
                  )
                    return;
                  setGroups((c) => c.filter((_, i) => i !== groupIndex));
                }}
              >
                消す
              </Button>
            </>
          }
        >
          <TextInput
            label="カテゴリ名"
            value={group.title}
            onChange={(title) => setGroup(groupIndex, (g) => ({ ...g, title }))}
          />
          {group.items.map((item, itemIndex) => (
            <div
              key={item.key}
              className="stack"
              style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}
            >
              <div className="spread">
                <strong>Q{itemIndex + 1}</strong>
                <span className="inline">
                  <Button
                    kind="quiet"
                    disabled={itemIndex === 0}
                    onClick={() =>
                      setGroup(groupIndex, (g) => ({ ...g, items: move(g.items, itemIndex, -1) }))
                    }
                  >
                    上へ
                  </Button>
                  <Button
                    kind="quiet"
                    disabled={itemIndex === group.items.length - 1}
                    onClick={() =>
                      setGroup(groupIndex, (g) => ({ ...g, items: move(g.items, itemIndex, 1) }))
                    }
                  >
                    下へ
                  </Button>
                  <Button
                    kind="quiet"
                    onClick={() =>
                      setGroup(groupIndex, (g) => ({
                        ...g,
                        items: g.items.filter((_, i) => i !== itemIndex),
                      }))
                    }
                  >
                    消す
                  </Button>
                </span>
              </div>
              <TextInput
                label="質問"
                value={item.question}
                onChange={(question) => setItem(groupIndex, itemIndex, { question })}
              />
              <TextArea
                label="答え"
                value={item.answer}
                rows={4}
                onChange={(answer) => setItem(groupIndex, itemIndex, { answer })}
              />
            </div>
          ))}
          <Button
            onClick={() =>
              setGroup(groupIndex, (g) => ({
                ...g,
                items: [...g.items, { key: nextKey++, question: "", answer: "" }],
              }))
            }
          >
            質問を足す
          </Button>
        </Panel>
      ))}
      <Button onClick={() => setGroups((c) => [...c, { key: nextKey++, title: "", items: [] }])}>
        カテゴリを足す
      </Button>
      {problems.map((problem) => (
        <p key={problem} className="muted" role="alert">
          {problem}
        </p>
      ))}
      <div className="inline">
        <Button kind="primary" busy={busy === "save"} disabled={!dirty} onClick={() => void save()}>
          保存
        </Button>
        <span className="muted">
          {groups.length}カテゴリ・{count}問{dirty ? "・保存していない変更があります" : ""}
        </span>
      </div>
      <PublishPanel article={article} unsaved={dirty} onSaveFirst={save} />
    </div>
  );
}
