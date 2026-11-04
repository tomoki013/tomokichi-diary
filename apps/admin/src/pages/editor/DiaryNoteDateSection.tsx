import { useState } from "react";
import type { ArticleDetailDto } from "@tomokichi/contracts";
import { api } from "../../lib/api";
import { Panel } from "../../ui/parts";
import { useToast } from "../../ui/toast";

export function DiaryNoteDateSection({
  article,
  onSaved,
}: {
  article: ArticleDetailDto;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const serverDate = article.publishedAt?.slice(0, 10) ?? "";
  const [date, setDate] = useState(serverDate);
  const [seen, setSeen] = useState(serverDate);
  const [busy, setBusy] = useState(false);
  if (seen !== serverDate) {
    setSeen(serverDate);
    setDate(serverDate);
  }

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await api.saveDiaryNoteDate(article.id, date || null);
      toast.info("投稿日を保存しました");
      await onSaved();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="投稿日">
      <label className="field">
        <span>公開ページに表示する日付</span>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </label>
      <p className="muted small">未設定のまま公開すると、公開した日が投稿日になります。</p>
      <button type="button" disabled={busy || date === serverDate} onClick={() => void save()}>
        保存
      </button>
    </Panel>
  );
}
