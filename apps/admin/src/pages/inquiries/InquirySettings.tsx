import { useState } from "react";
import type { InquiryReplyTemplateDto, InquirySignatureDto } from "@tomokichi/contracts";
import { api, type TemplateInput } from "../../lib/api";
import { formatRelative } from "../../lib/labels";
import { href } from "../../lib/route";
import { useResource, useTitle, useUnsavedWarning } from "../../ui/hooks";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../../ui/parts";
import { useToast } from "../../ui/toast";

/**
 * What every reply from this site carries: the signature under it, and the
 * templates a reply can start from. Both live on the inquiry platform, scoped
 * to this site's project.
 */
export function InquirySettings() {
  useTitle("返信の設定");
  return (
    <>
      <PageHeader title="返信の設定" meta={<a href={href.inquiries()}>← お問い合わせ</a>} />
      <SignaturePanel />
      <TemplatesPanel />
    </>
  );
}

/**
 * Until the site has a signature of its own, replies carry the deployment's
 * (Tomokichi Studio's), so the panel says so.
 */
function SignaturePanel() {
  const signature = useResource(() => api.getSignature(), "inquiry-signature");
  if (signature.error) {
    return (
      <Panel title="署名">
        <ErrorState error={signature.error} onRetry={() => void signature.reload()} />
      </Panel>
    );
  }
  if (!signature.data) {
    return (
      <Panel title="署名">
        <SkeletonRows rows={2} />
      </Panel>
    );
  }
  return <SignatureForm initial={signature.data} />;
}

function SignatureForm({ initial }: { initial: InquirySignatureDto }) {
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [text, setText] = useState(initial.signature);
  const [busy, setBusy] = useState(false);
  const dirty = text.trim() !== saved.signature.trim();
  useUnsavedWarning(dirty);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const next = await api.saveSignature(text.trim());
      setSaved(next);
      setText(next.signature);
      toast.info("署名を保存しました");
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="署名"
      actions={
        saved.usesDefault ? (
          <Badge tone="warn">未設定（Tomokichi Studio の署名で送られます）</Badge>
        ) : undefined
      }
    >
      <p className="muted small">
        返信メールの末尾に自動で付きます。「以上、よろしくお願いいたします。」は返信ごとに付けるか選べます。
      </p>
      <textarea
        rows={4}
        maxLength={2000}
        aria-label="署名"
        placeholder={"ともきちの旅行日記\nhttps://tomokichidiary.com"}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="panel__foot">
        <button
          type="button"
          className="primary"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          署名を保存
        </button>
      </div>
    </Panel>
  );
}

const EMPTY: TemplateInput = { name: "", subject: null, body: "", isActive: true, sortOrder: 100 };

function TemplatesPanel() {
  const templates = useResource(() => api.listReplyTemplates(), "reply-templates:admin");
  /** The template open in the editor: an id, `new`, or none. */
  const [editing, setEditing] = useState<string | null>(null);

  const items = templates.data?.items ?? [];
  const current = items.find((template) => template.id === editing);

  return (
    <Panel
      title="返信テンプレート"
      actions={
        editing === null && (
          <button type="button" onClick={() => setEditing("new")}>
            ＋ 追加
          </button>
        )
      }
    >
      <p className="muted small">
        返信は「冒頭（宛名・名乗り）→ 本文 →（以上、よろしくお願いいたします。）→
        署名」の順に組み立てます。冒頭は宛名まで自動で入り、返信画面の「名乗り」で髙木・ともきちを選べます。本文はここのテンプレートから選べます。
        名前を「区分：名前」にすると、返信画面で区分ごとにまとまります。
        記事名や場所など、その返信でしか書けないことは {"{{articleTitle}}"}{" "}
        のように書いておくと、埋めるまで送信できません。冒頭の {"{{operatorName}}"}{" "}
        は名乗りの選択に応じて置き換わります。
      </p>
      {editing !== null && (
        <TemplateEditor
          key={editing}
          template={current}
          onDone={async (changed) => {
            setEditing(null);
            if (changed) await templates.reload();
          }}
        />
      )}
      {templates.error ? (
        <ErrorState error={templates.error} onRetry={() => void templates.reload()} />
      ) : !templates.data ? (
        <SkeletonRows rows={3} />
      ) : items.length === 0 ? (
        <EmptyState>
          テンプレートはまだありません。よく書く返信を登録しておくと、返信画面から差し込めます。
        </EmptyState>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>名前</th>
              <th className="hide-narrow">件名</th>
              <th>更新</th>
            </tr>
          </thead>
          <tbody>
            {items.map((template) => (
              <tr key={template.id}>
                <td>
                  <button
                    type="button"
                    className="link table__title"
                    onClick={() => setEditing(template.id)}
                  >
                    {template.name}
                  </button>
                  {template.role === "opening" && <Badge tone="accent">冒頭・自動で入る</Badge>}
                  {!template.isActive && <Badge>停止中</Badge>}
                </td>
                <td className="hide-narrow muted">
                  {template.role === "opening" ? "—" : (template.subject ?? "（既定の件名）")}
                </td>
                <td className="muted nowrap">{formatRelative(template.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/**
 * `{{userName}}` becomes the name the reader typed, `{{appName}}` and
 * `{{supportUrl}}` this site's name and contact page. Anything else in braces
 * has to be filled in by hand before the reply can be sent.
 */
function TemplateEditor({
  template,
  onDone,
}: {
  template: InquiryReplyTemplateDto | undefined;
  onDone: (changed: boolean) => Promise<void>;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<TemplateInput>(
    template
      ? {
          name: template.name,
          subject: template.subject,
          body: template.body,
          isActive: template.isActive,
          sortOrder: template.sortOrder,
        }
      : EMPTY,
  );
  const [busy, setBusy] = useState(false);
  const set = (change: Partial<TemplateInput>): void => setDraft({ ...draft, ...change });
  const valid = draft.name.trim() !== "" && draft.body.trim() !== "";
  useUnsavedWarning(true);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const input = { ...draft, subject: draft.subject?.trim() || null };
      if (template) await api.updateReplyTemplate(template.id, input);
      else await api.createReplyTemplate(input);
      toast.info("テンプレートを保存しました");
      await onDone(true);
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="template-editor">
      <div className="form-grid">
        <label className="field field--wide">
          <span>名前</span>
          <input
            maxLength={160}
            placeholder="例: 写真利用のお礼"
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </label>
        <label className="field field--wide">
          <span>
            件名 <em className="field__hint">空なら既定の件名</em>
          </span>
          <input
            maxLength={200}
            value={draft.subject ?? ""}
            onChange={(event) => set({ subject: event.target.value })}
          />
        </label>
        <label className="field field--wide">
          <span>本文</span>
          <textarea
            className="composer"
            rows={10}
            maxLength={20_000}
            value={draft.body}
            onChange={(event) => set({ body: event.target.value })}
          />
          <small className="muted">
            {"{{userName}}"} はフォームに入力されたニックネーム、{"{{appName}}"} はサイト名、
            {"{{siteUrl}}"} はサイトの URL に置き換わります（件名でも使えます）。ほかの {"{{…}}"}{" "}
            は返信のときに書き換えるまで送信できません。
          </small>
        </label>
        <label className="field">
          <span>並び順</span>
          <input
            type="number"
            min={0}
            max={9999}
            value={draft.sortOrder}
            onChange={(event) =>
              set({ sortOrder: Math.max(0, Math.floor(Number(event.target.value) || 0)) })
            }
          />
        </label>
        <label className="field check">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(event) => set({ isActive: event.target.checked })}
          />
          返信画面に出す
        </label>
      </div>
      <div className="panel__foot">
        <button type="button" className="link" disabled={busy} onClick={() => void onDone(false)}>
          やめる
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !valid}
          onClick={() => void save()}
        >
          保存
        </button>
      </div>
    </div>
  );
}
