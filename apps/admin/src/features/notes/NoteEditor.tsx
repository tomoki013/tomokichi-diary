import { useMemo, useState } from "react";
import type { ArticleDetailDto } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp, useTitle, useUnsavedWarning } from "../../data/hooks";
import { go, href } from "../../app/router";
import { PhaseBadge } from "../../ui/PhaseBadge";
import { Button, Chips, Loaded, Page, Panel, TextInput, confirmed } from "../../ui/parts";
import { BodyPanel } from "../editor/BodyPanel";
import { MediaPanel } from "../editor/MediaPanel";
import { PublishPanel } from "../editor/PublishPanel";

export function NoteEditor({ id }: { id: string }) {
  const note = useOp("note.get", { noteId: id });
  return (
    <Loaded resource={note} lines={8}>
      {(data) => <Editor key={data.currentRevision?.id ?? data.id} note={data} />}
    </Loaded>
  );
}

function Editor({ note }: { note: ArticleDetailDto }) {
  const saved = useMemo(
    () => ({
      title: note.currentRevision?.title ?? "",
      body: note.currentRevision?.bodyMarkdown ?? "",
    }),
    [note],
  );
  const [title, setTitle] = useState(saved.title);
  const [body, setBody] = useState(saved.body);
  const [date, setDate] = useState(note.publishedAt?.slice(0, 10) ?? "");
  const dirty = title !== saved.title || body !== saved.body;
  useUnsavedWarning(dirty);
  useTitle(title || "一言日記");
  const { busy, run } = useAction();
  const save = async () =>
    (await run("save", () => op("note.saveDraft", { noteId: note.id, title, bodyMarkdown: body }), {
      done: "保存しました",
      touches: ["note", "home"],
    })) !== undefined;
  return (
    <Page
      title={
        <>
          {title || "（無題）"} <PhaseBadge article={note} />
        </>
      }
      back={{ href: href.notes(), label: "一言日記" }}
    >
      <div className="editor__bar">
        <span className="muted">{dirty ? "未保存の変更があります" : "保存済み"}</span>
        <Button kind="primary" busy={busy === "save"} disabled={!dirty} onClick={() => void save()}>
          保存
        </Button>
      </div>
      <div className="editor">
        <div className="panel">
          <div className="panel__body" style={{ paddingTop: 12 }}>
            <TextInput label="タイトル" value={title} onChange={setTitle} max={120} />
          </div>
        </div>
        <BodyPanel body={body} onChange={setBody} />
        <PublishPanel article={note} unsaved={dirty} onSaveFirst={save} />
        <Panel title="投稿日" hint="空欄なら公開した日" collapsible>
          <div className="inline">
            <TextInput label="日付" type="date" value={date} onChange={setDate} />
            <Button
              busy={busy === "date"}
              onClick={() =>
                void run(
                  "date",
                  () => op("note.setDate", { noteId: note.id, date: date || null }),
                  {
                    done: "投稿日を保存しました",
                    touches: ["note"],
                  },
                )
              }
            >
              保存
            </Button>
          </div>
        </Panel>
        <RelatedPanel note={note} />
        <MediaPanel article={note} />
        <Panel title="削除" collapsible>
          <p className="muted">日記を消します。元に戻せません。</p>
          <Button
            kind="danger"
            busy={busy === "delete"}
            onClick={async () => {
              if (!confirmed("この日記を削除します。元に戻せません。よろしいですか？")) return;
              const done = await run(
                "delete",
                () => op("note.delete", { noteId: note.id, confirm: "delete" }),
                {
                  done: "削除しました",
                  touches: ["note", "home"],
                },
              );
              if (done) go(href.notes());
            }}
          >
            この日記を削除
          </Button>
        </Panel>
      </div>
    </Page>
  );
}

/** Travel articles the note points to, chosen by searching their titles. */
function RelatedPanel({ note }: { note: ArticleDetailDto }) {
  const articles = useOp("article.list");
  const [picked, setPicked] = useState<string[]>([...(note.relatedArticleIds ?? [])]);
  const [query, setQuery] = useState("");
  const { busy, run } = useAction();
  const all = (articles.data?.items ?? []).filter((a) => a.kind === "article");
  const titleOf = (id: string) => all.find((a) => a.id === id)?.title ?? id;
  const matches = query.trim()
    ? all.filter((a) => a.title.includes(query.trim()) && !picked.includes(a.id)).slice(0, 8)
    : [];
  const dirty = JSON.stringify(picked) !== JSON.stringify(note.relatedArticleIds ?? []);
  return (
    <Panel title="関連する旅の記事" hint={`${picked.length}本`} collapsible>
      <Chips
        options={picked.map((id) => ({ value: id, label: `${titleOf(id)} ×` }))}
        selected={picked}
        onToggle={(id) => setPicked((current) => current.filter((x) => x !== id))}
      />
      <TextInput label="記事を探す" type="search" value={query} onChange={setQuery} />
      {matches.length > 0 && (
        <Chips
          options={matches.map((a) => ({ value: a.id, label: a.title }))}
          selected={[]}
          onToggle={(id) => {
            setPicked((current) => [...current, id].slice(0, 10));
            setQuery("");
          }}
        />
      )}
      {dirty && (
        <Button
          kind="primary"
          busy={busy === "save"}
          onClick={() =>
            void run(
              "save",
              () => op("note.setRelatedArticles", { noteId: note.id, relatedArticleIds: picked }),
              {
                done: "関連記事を保存しました",
                touches: ["note"],
              },
            )
          }
        >
          保存
        </Button>
      )}
    </Panel>
  );
}
