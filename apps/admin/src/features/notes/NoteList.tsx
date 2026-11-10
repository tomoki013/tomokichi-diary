import { useState } from "react";
import { op } from "../../data/client";
import { useAction, useOp, useTitle } from "../../data/hooks";
import { go, href } from "../../app/router";
import { formatRelative } from "../../lib/labels";
import { PhaseBadge } from "../../ui/PhaseBadge";
import { Button, Empty, Loaded, Page, Row, Rows, TextInput } from "../../ui/parts";

const today = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

/** Short diary notes, kept apart from travel articles. A new one needs only a title. */
export function NoteList() {
  useTitle("一言日記");
  const notes = useOp("note.list");
  const [title, setTitle] = useState("");
  const { busy, run } = useAction();
  async function create() {
    const slug = `note-${today()}-${Math.random().toString(36).slice(2, 6)}`;
    const created = await run("create", () => op("note.create", { slug, title }), {
      touches: ["note", "home"],
    });
    if (created) go(href.note(created.id));
  }
  return (
    <Page title="一言日記">
      <div className="panel">
        <div className="panel__body" style={{ paddingTop: 12 }}>
          <TextInput label="新しい日記のタイトル" value={title} onChange={setTitle} max={120} />
          <Button
            kind="primary"
            busy={busy === "create"}
            disabled={!title.trim()}
            onClick={() => void create()}
          >
            書き始める
          </Button>
        </div>
      </div>
      <Loaded resource={notes} lines={6}>
        {(data) =>
          data.items.length === 0 ? (
            <Empty>まだ日記はありません。</Empty>
          ) : (
            <Rows>
              {data.items
                .toSorted((a, b) =>
                  (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt),
                )
                .map((note) => (
                  <Row
                    key={note.id}
                    href={href.note(note.id)}
                    title={note.title || note.slug}
                    meta={
                      note.publishedAt
                        ? note.publishedAt.slice(0, 10)
                        : formatRelative(note.updatedAt)
                    }
                    aside={<PhaseBadge article={note} />}
                  />
                ))}
            </Rows>
          )
        }
      </Loaded>
    </Page>
  );
}
