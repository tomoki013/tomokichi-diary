import type { HomeTaskDto } from "@tomokichi/contracts";
import { useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import { Badge, Empty, Loaded, Page, Row, Rows } from "../../ui/parts";
import { formatDateTime } from "../../lib/labels";

const kindLabel: Record<
  HomeTaskDto["kind"],
  { label: string; tone: "danger" | "warn" | "accent" | "neutral" }
> = {
  "publication-failed": { label: "要対応", tone: "danger" },
  "open-inquiries": { label: "問い合わせ", tone: "warn" },
  "pending-facts": { label: "確認待ち", tone: "accent" },
  "unpublished-changes": { label: "未公開の変更", tone: "warn" },
  scheduled: { label: "予約", tone: "accent" },
  draft: { label: "下書き", tone: "neutral" },
};

/**
 * What needs the owner now, and where to start writing. Nothing to read
 * through: each line is one tap into the screen that deals with it.
 */
export function Home() {
  useTitle("");
  const home = useOp("home.get");
  return (
    <Page title="ホーム">
      <div className="write">
        <a href={href.newArticle()}>記事を書く</a>
        <a href={href.notes()}>日記を書く</a>
        <a href={href.media()}>写真を上げる</a>
      </div>
      <h2>やること</h2>
      <Loaded resource={home} lines={5}>
        {({ tasks }) =>
          tasks.length === 0 ? (
            <Empty>いま手を付けることはありません。</Empty>
          ) : (
            <Rows>
              {tasks.map((task) => {
                const kind = kindLabel[task.kind];
                return (
                  <Row
                    key={`${task.kind}-${task.href}-${task.title}`}
                    href={task.href}
                    title={task.title}
                    meta={
                      task.kind === "scheduled" && task.detail
                        ? `${formatDateTime(task.detail)} に公開`
                        : (task.detail ?? undefined)
                    }
                    aside={<Badge tone={kind.tone}>{kind.label}</Badge>}
                  />
                );
              })}
            </Rows>
          )
        }
      </Loaded>
    </Page>
  );
}
