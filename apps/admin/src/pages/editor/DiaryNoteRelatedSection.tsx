import { useMemo, useState } from "react";
import type { ArticleDetailDto } from "@tomokichi/contracts";
import { api } from "../../lib/api";
import { useResource } from "../../ui/hooks";
import { EmptyState, ErrorState, Panel, SkeletonRows } from "../../ui/parts";
import { useToast } from "../../ui/toast";
import { useSectionSave, type RegisterSection } from "./section-save";

export function DiaryNoteRelatedSection({
  article,
  onSaved,
  register,
}: {
  article: ArticleDetailDto;
  onSaved: () => Promise<void>;
  register: RegisterSection;
}) {
  const toast = useToast();
  const available = useResource(
    () => api.listArticles().then((result) => result.items),
    "diary-note-related",
  );
  const current = article.relatedArticleIds ?? [];
  const currentJson = JSON.stringify(current);
  const [selected, setSelected] = useState<string[]>(() => [...current]);
  const [baseline, setBaseline] = useState(currentJson);
  const [seen, setSeen] = useState(currentJson);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(selected) !== baseline;
  const published = useMemo(
    () =>
      (available.data ?? [])
        .filter((item) => item.kind === "article" && item.isLive)
        .toSorted((a, b) => a.title.localeCompare(b.title, "ja")),
    [available.data],
  );

  if (seen !== currentJson) {
    setSeen(currentJson);
    if (!dirty) {
      setSelected([...current]);
      setBaseline(currentJson);
    }
  }

  async function save(): Promise<boolean> {
    setBusy(true);
    try {
      const result = await api.saveDiaryNoteRelatedArticles(article.id, selected);
      setSelected(result.relatedArticleIds);
      setBaseline(JSON.stringify(result.relatedArticleIds));
      setSeen(JSON.stringify(result.relatedArticleIds));
      toast.info("関連記事を保存しました。公開中の日記には「変更を公開」で反映されます。");
      await onSaved();
      return true;
    } catch (error) {
      toast.error(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  useSectionSave(register, "relations", { dirty, busy, save });

  return (
    <Panel title="関連する旅行記事">
      <p className="muted small">日記から自然に案内したい公開済みの記事だけを選びます。</p>
      {available.error ? (
        <ErrorState error={available.error} onRetry={() => void available.reload()} />
      ) : available.loading ? (
        <SkeletonRows rows={4} />
      ) : published.length === 0 ? (
        <EmptyState>選べる公開記事はありません。</EmptyState>
      ) : (
        <div className="stack">
          {published.map((item) => (
            <label className="check-row" key={item.id}>
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={(event) =>
                  setSelected((before) =>
                    event.target.checked
                      ? [...before, item.id]
                      : before.filter((id) => id !== item.id),
                  )
                }
              />
              <span>{item.title}</span>
            </label>
          ))}
        </div>
      )}
      <div className="row">
        <span className="muted small">選択 {selected.length}件</span>
        <button type="button" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? "保存中…" : "関連記事を保存"}
        </button>
      </div>
    </Panel>
  );
}
