import { useState } from "react";
import type { InquiryReplyTemplateDto } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import {
  Badge,
  Button,
  Check,
  Loaded,
  Page,
  Panel,
  Row,
  Rows,
  TextArea,
  TextInput,
} from "../../ui/parts";

/** The signature and reply templates for answering readers. */
export function InquirySettings() {
  useTitle("返信の設定");
  const signature = useOp("inquiry.signature");
  const templates = useOp("inquiry.templates");
  const [editing, setEditing] = useState<InquiryReplyTemplateDto | "new" | null>(null);
  return (
    <Page title="返信の設定" back={{ href: href.inquiries(), label: "問い合わせ" }}>
      <Loaded resource={signature}>
        {(data) => (
          <Signature key={data.signature} value={data.signature} usesDefault={data.usesDefault} />
        )}
      </Loaded>
      <Panel title="テンプレート" actions={<Button onClick={() => setEditing("new")}>追加</Button>}>
        <Loaded resource={templates}>
          {(data) => (
            <Rows>
              {data.items.map((t) => (
                <Row
                  key={t.id}
                  onClick={() => setEditing(t)}
                  title={t.name}
                  meta={t.role === "opening" ? "書き出し" : (t.subject ?? "")}
                  aside={t.isActive ? undefined : <Badge>停止中</Badge>}
                />
              ))}
            </Rows>
          )}
        </Loaded>
      </Panel>
      {editing && (
        <TemplateForm
          key={editing === "new" ? "new" : editing.id}
          template={editing === "new" ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}
    </Page>
  );
}

function Signature({ value, usesDefault }: { value: string; usesDefault: boolean }) {
  const [text, setText] = useState(value);
  const { busy, run } = useAction();
  return (
    <Panel title="署名" hint={usesDefault ? "基盤の既定の署名を使っています" : undefined}>
      <TextArea label="署名" value={text} onChange={setText} rows={4} max={2000} />
      <Button
        busy={busy === "save"}
        disabled={text === value}
        onClick={() =>
          void run("save", () => op("inquiry.saveSignature", { signature: text }), {
            done: "保存しました",
            touches: ["inquiry"],
          })
        }
      >
        保存
      </Button>
    </Panel>
  );
}

function TemplateForm({
  template,
  onDone,
}: {
  template: InquiryReplyTemplateDto | null;
  onDone: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [active, setActive] = useState(template?.isActive ?? true);
  const [sortOrder, setSortOrder] = useState(String(template?.sortOrder ?? 100));
  const { busy, run } = useAction();
  async function save() {
    const input = {
      name,
      subject: subject.trim() || null,
      body,
      isActive: active,
      sortOrder: Number(sortOrder) || 0,
    };
    const done = await run(
      "save",
      () =>
        template
          ? op("inquiry.updateTemplate", { templateId: template.id, ...input })
          : op("inquiry.createTemplate", input),
      { done: "保存しました", touches: ["inquiry"] },
    );
    if (done) onDone();
  }
  return (
    <dialog open className="sheet" aria-label="テンプレート">
      <div className="sheet__body">
        <div className="spread">
          <h2>{template ? template.name : "新しいテンプレート"}</h2>
          <Button kind="quiet" onClick={onDone}>
            閉じる
          </Button>
        </div>
        <TextInput label="名前" value={name} onChange={setName} max={160} />
        <TextInput
          label="件名（初回返信のときだけ使われる）"
          value={subject}
          onChange={setSubject}
          max={200}
        />
        <TextArea
          label="本文"
          value={body}
          onChange={setBody}
          rows={8}
          max={20000}
          hint="{{userName}} {{appName}} {{siteUrl}} が使えます"
        />
        <TextInput label="表示順" type="number" value={sortOrder} onChange={setSortOrder} />
        <Check label="使う" checked={active} onChange={setActive} />
        <Button
          kind="primary"
          busy={busy === "save"}
          disabled={!name || !body}
          onClick={() => void save()}
        >
          保存
        </Button>
      </div>
    </dialog>
  );
}
