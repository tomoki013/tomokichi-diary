import { useState } from "react";
import type { ArticleDetailDto } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp } from "../../data/hooks";
import { articleState, phaseOf } from "../../lib/article-state";
import { isoToJstLocal, jstLocalToIso } from "../../lib/labels";
import { publishProblem } from "../../lib/publish-messages";
import { Badge, Button, Panel, TextInput, confirmed } from "../../ui/parts";

const touches = ["article", "note", "publication", "home"];

/**
 * Where the piece stands and the ways to move it: publish (after the publish
 * check), schedule, take down, archive. Saving first is the caller's job.
 */
export function PublishPanel({
  article,
  unsaved,
  onSaveFirst,
}: {
  article: ArticleDetailDto;
  unsaved: boolean;
  onSaveFirst: () => Promise<boolean>;
}) {
  const note = article.kind === "note";
  const site = useOp("publication.status");
  const check = useOp(
    note ? "note.publishCheck" : "article.publishCheck",
    note ? { noteId: article.id } : ({ articleId: article.id } as never),
  );
  const [at, setAt] = useState(isoToJstLocal(article.scheduledAt));
  const { busy, run } = useAction();
  const phase = phaseOf(article);
  const id = article.id;
  const problems = check.data?.problems ?? [];

  async function publish() {
    if (unsaved && !(await onSaveFirst())) return;
    const label = phase === "changed" ? "変更を公開" : "公開";
    if (!confirmed(`この${note ? "日記" : "記事"}を${label}します。よろしいですか？`)) return;
    await run(
      "publish",
      () => (note ? op("note.publish", { noteId: id }) : op("article.publish", { articleId: id })),
      { done: "公開しました。サイトに反映しています", touches },
    );
  }
  async function unpublish() {
    if (!confirmed("サイトから取り下げます。URL は残り、あとで再公開できます。よろしいですか？"))
      return;
    await run(
      "unpublish",
      () =>
        note ? op("note.unpublish", { noteId: id }) : op("article.unpublish", { articleId: id }),
      { done: "取り下げました", touches },
    );
  }
  async function archive() {
    if (!confirmed("アーカイブします。サイトから取り下げ、一覧の既定表示からも外れます。")) return;
    await run("archive", () => op("article.archive", { articleId: id }), {
      done: "アーカイブしました",
      touches,
    });
  }
  async function schedule() {
    const iso = jstLocalToIso(at);
    if (!iso) return;
    if (unsaved && !(await onSaveFirst())) return;
    await run("schedule", () => op("article.schedule", { articleId: id, at: iso }), {
      done: "予約しました",
      touches,
    });
  }

  return (
    <Panel id="publish" title="公開">
      <ul className="state-lines">
        {articleState(article, unsaved, site.data, note ? "この日記" : "この記事").map((line) => (
          <li key={line.label}>
            <Badge tone={line.tone}>{line.label}</Badge>
            <span>{line.text}</span>
          </li>
        ))}
      </ul>
      {problems.length > 0 && (
        <ul className="problems">
          {problems.map((problem) => (
            <li key={`${problem.code}-${problem.message}`}>{publishProblem(problem.message)}</li>
          ))}
        </ul>
      )}
      <div className="inline">
        {phase !== "archived" && (phase !== "live" || unsaved) && (
          <Button
            kind="primary"
            busy={busy === "publish"}
            disabled={problems.length > 0 && !unsaved}
            onClick={() => void publish()}
          >
            {phase === "changed" || (phase === "live" && unsaved) ? "変更を公開" : "公開する"}
          </Button>
        )}
        {(phase === "live" || phase === "changed" || phase === "scheduled") && (
          <Button busy={busy === "unpublish"} onClick={() => void unpublish()}>
            取り下げる
          </Button>
        )}
        {!note && phase !== "archived" && (
          <Button kind="quiet" busy={busy === "archive"} onClick={() => void archive()}>
            アーカイブ
          </Button>
        )}
      </div>
      {!note && (phase === "draft" || phase === "withdrawn" || phase === "scheduled") && (
        <div className="inline">
          <TextInput
            label="予約公開（日本時間）"
            type="datetime-local"
            value={at}
            onChange={setAt}
          />
          <Button
            busy={busy === "schedule"}
            disabled={!jstLocalToIso(at)}
            onClick={() => void schedule()}
          >
            予約する
          </Button>
        </div>
      )}
    </Panel>
  );
}
