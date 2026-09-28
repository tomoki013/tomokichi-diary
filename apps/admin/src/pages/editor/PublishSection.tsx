import { useState } from "react";
import type { ArticleDetailDto, PublishCheckDto } from "@tomokichi/contracts";
import { api } from "../../lib/api";
import { formatDateTime, isoToJstLocal, jstLocalToIso } from "../../lib/labels";
import type { Resource } from "../../ui/hooks";
import { Panel, SkeletonRows } from "../../ui/parts";
import { useToast } from "../../ui/toast";

/**
 * Everything that changes what readers see. Publishing takes the saved
 * revision, so unsaved edits are saved first rather than silently left out.
 */
export function PublishSection({
  article,
  check,
  dirty,
  save,
  onChanged,
}: {
  article: ArticleDetailDto;
  check: Resource<PublishCheckDto>;
  dirty: boolean;
  save: () => Promise<boolean>;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [when, setWhen] = useState("");

  const run = async (action: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(true);
    try {
      if (dirty && !(await save())) return;
      await action();
      toast.info(done);
      await onChanged();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  const publishable = check.data?.publishable === true;
  // A live article with nothing new would republish the same revision.
  const nothingToPublish = article.isLive && !article.hasUnpublishedChanges && !dirty;
  const liveUrl =
    article.path && article.isLive ? `https://tomokichidiary.com${article.path}` : null;

  return (
    <Panel title="公開">
      {check.loading && !check.data ? (
        <SkeletonRows rows={2} />
      ) : check.data && !check.data.publishable ? (
        <ul className="problems">
          {check.data.problems.map((problem) => (
            <li key={`${problem.code}-${problem.field ?? ""}`}>
              {problem.field ? <code>{problem.field}</code> : null} {problem.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ok-line">
          {nothingToPublish
            ? "公開中の内容は最新です"
            : `公開できます${dirty ? "（保存してから公開します）" : ""}`}
        </p>
      )}

      <div className="stack">
        <button
          type="button"
          className="primary"
          disabled={busy || !publishable || nothingToPublish}
          onClick={() =>
            void run(
              () => api.publish(article.id),
              article.isLive ? "変更を公開しました" : "公開しました",
            )
          }
        >
          {article.isLive ? "変更を公開" : "公開する"}
        </button>

        {!article.isLive &&
          (scheduling ? (
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                const at = jstLocalToIso(when);
                if (!at) return;
                void run(
                  () => api.schedule(article.id, at),
                  `${formatDateTime(at)} に予約しました`,
                );
                setScheduling(false);
              }}
            >
              <label className="field">
                <span>公開日時（日本時間）</span>
                <input
                  type="datetime-local"
                  required
                  min={isoToJstLocal(new Date().toISOString())}
                  value={when}
                  onChange={(event) => setWhen(event.target.value)}
                />
              </label>
              <div className="row">
                <button type="submit" disabled={busy || !publishable || when === ""}>
                  予約する
                </button>
                <button type="button" className="link" onClick={() => setScheduling(false)}>
                  やめる
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              disabled={busy || !publishable}
              onClick={() => {
                setWhen(isoToJstLocal(article.scheduledAt));
                setScheduling(true);
              }}
            >
              {article.status === "scheduled"
                ? `予約を変更（${formatDateTime(article.scheduledAt)}）`
                : "日時を予約して公開"}
            </button>
          ))}

        {liveUrl && (
          <a className="button" href={liveUrl} target="_blank" rel="noopener noreferrer">
            公開ページを開く ↗
          </a>
        )}

        {(article.status === "published" || article.status === "scheduled") && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const scheduled = article.status === "scheduled";
              const question = scheduled
                ? "予約を取り消して下書きに戻しますか？"
                : "非公開に戻しますか？ 公開ページは表示されなくなります。";
              if (globalThis.confirm(question)) {
                void run(
                  () => api.unpublish(article.id),
                  scheduled ? "予約を取り消しました" : "非公開に戻しました",
                );
              }
            }}
          >
            {article.status === "scheduled" ? "予約を取り消す" : "非公開に戻す"}
          </button>
        )}

        {article.status !== "archived" && (
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (globalThis.confirm("アーカイブしますか？ 一覧の「アーカイブ」に移ります。")) {
                void run(() => api.archive(article.id), "アーカイブしました");
              }
            }}
          >
            アーカイブ
          </button>
        )}
      </div>
    </Panel>
  );
}
