import { useMemo, useState } from "react";
import { marked } from "marked";
import {
  validate,
  articleMonetizationSchema,
  type ArticleMonetizationDto,
  type MonetizationOverviewDto,
  type MonetizationPlacement,
} from "@tomokichi/contracts";
import { api } from "../../lib/api";
import { useResource } from "../../ui/hooks";
import { ErrorState, Panel } from "../../ui/parts";
import { useToast } from "../../ui/toast";
import { useSectionSave, type RegisterSection } from "./section-save";
import { AffiliatePreview } from "../AffiliatePreview";

type Props = {
  articleId: string;
  needsPublication: boolean;
  body: string;
  onBody: (body: string) => void;
  register: RegisterSection;
  onSaveAll: () => Promise<boolean>;
};
export function MonetizationSection(props: Props) {
  const data = useResource(
    async () => ({
      article: await api.articleMonetization(props.articleId),
      overview: await api.monetization(),
    }),
    `monetization:${props.articleId}`,
  );
  // A missing configuration must block Save/Publish until it can be read safely.
  useSectionSave(props.register, "monetization-loading", {
    dirty: !data.data,
    busy: data.loading,
    problem: "収益化設定を読み込んでください",
    save: async () => Boolean(data.data),
  });
  if (data.error)
    return (
      <Panel title="収益化">
        <ErrorState error={data.error} onRetry={() => void data.reload()} />
      </Panel>
    );
  if (!data.data)
    return (
      <Panel title="収益化">
        <p>設定を読み込み中…</p>
      </Panel>
    );
  return <Loaded {...props} data={data.data.article} overview={data.data.overview} />;
}
function Loaded({
  articleId,
  needsPublication,
  body,
  onBody,
  register,
  onSaveAll,
  data,
  overview,
}: Props & { data: ArticleMonetizationDto; overview: MonetizationOverviewDto }) {
  const [config, setConfig] = useState(data.draft);
  const [baseline, setBaseline] = useState(JSON.stringify(data.draft));
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<{ body: string; offset: number } | null>(null);
  const position = selection?.body === body ? selection.offset : null;
  const setPosition = (offset: number | null) =>
    setSelection(offset === null ? null : { body, offset });
  const [kind, setKind] = useState<"adsense" | "affiliate">("affiliate");
  const [preview, setPreview] = useState<string | null>(null);
  const toast = useToast();
  const dirty = JSON.stringify(config) !== baseline;
  const parsed = validate(articleMonetizationSchema, config);
  const problem = parsed.ok ? undefined : parsed.issues.map((i) => i.message).join(" / ");
  async function save() {
    setBusy(true);
    try {
      const result = await api.saveArticleMonetization(articleId, config);
      setConfig(result);
      setBaseline(JSON.stringify(result));
      return true;
    } catch (error) {
      toast.error(error);
      return false;
    } finally {
      setBusy(false);
    }
  }
  useSectionSave(register, "monetization", { dirty, busy, problem, save });
  const blocks = useMemo(() => insertionBlocks(body), [body]);
  const updatePlacement = (index: number, patch: Partial<MonetizationPlacement>) =>
    setConfig((c) => ({
      ...c,
      placements: c.placements.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));
  function insert() {
    if (position === null) return;
    const key = `slot-${crypto.randomUUID()}`;
    onBody(
      `${body.slice(0, position).trimEnd()}\n\n{{monetization:${key}}}\n\n${body.slice(position).trimStart()}`,
    );
    setConfig((c) => ({
      ...c,
      placements: [
        ...c.placements.map((p) =>
          kind === "adsense" && p.kind === "adsense" ? { ...p, status: "paused" as const } : p,
        ),
        {
          key,
          kind,
          position: "marker",
          status: "ready",
          adUnit: overview.settings.adUnits[0]?.id ?? "7152502134",
          offerId: null,
        },
      ],
    }));
    setPosition(null);
    setPreview(key);
  }
  return (
    <Panel title="収益化">
      <p className="muted">
        アフィリエイトは本番配信無効。保存後は「変更を公開」してサイト反映が必要です。
      </p>
      <p>
        最終編集:{" "}
        {config.updatedAt
          ? new Date(config.updatedAt).toLocaleString("ja-JP")
          : "未編集（既存の末尾広告）"}{" "}
        / {needsPublication || dirty ? "公開待ち" : "公開版あり・配信状況は公開パネルで確認"}
      </p>
      <label className="field">
        <span>収益化モード</span>
        <select
          value={config.mode}
          onChange={(e) => setConfig((c) => ({ ...c, mode: e.target.value as typeof c.mode }))}
        >
          <option value="none">広告なし</option>
          <option value="ads">AdSenseのみ</option>
          <option value="affiliate">アフィリエイト用（準備）</option>
          <option value="hybrid">両方（アフィリエイトは準備）</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={config.adsEnabled}
          onChange={(e) => setConfig((c) => ({ ...c, adsEnabled: e.target.checked }))}
        />{" "}
        AdSenseを有効にする
      </label>
      <p>最大広告枠数: 1</p>
      <label className="field">
        <span>配置実験への参加</span>
        <select
          value={config.experimentId ?? ""}
          onChange={(e) => setConfig((c) => ({ ...c, experimentId: e.target.value || null }))}
        >
          <option value="">参加しない</option>
          {overview.experiments
            .filter((e) => e.articleId === articleId)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}（{e.status}）
              </option>
            ))}
        </select>
      </label>
      <details>
        <summary>収益化スロットを挿入</summary>
        <p>
          本文プレビューでブロックを選び、その直後に配置します。広告は見出し・本文600字以上の後に置き、画像や関連カードから離してください。
        </p>
        <div className="monetization-picker" aria-label="挿入位置を選択">
          {blocks.map((b) => (
            <div
              key={b.end}
              className={position === b.end ? "monetization-block selected" : "monetization-block"}
            >
              <div className="preview" dangerouslySetInnerHTML={{ __html: b.html }} />
              <button
                type="button"
                aria-pressed={position === b.end}
                onClick={() => setPosition(b.end)}
              >
                このブロックの後を選択
              </button>
            </div>
          ))}
        </div>
        <label className="field">
          <span>スロット種別</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="affiliate">アフィリエイト予定枠</option>
            <option value="adsense">AdSense（既存の枠を一時停止）</option>
          </select>
        </label>
        <button type="button" disabled={position === null} onClick={insert}>
          広告配置を追加
        </button>
      </details>
      <ol className="monetization-placements">
        {config.placements.map((p, i) => (
          <li key={p.key}>
            <strong>
              {p.kind === "adsense" ? "AdSense" : "アフィリエイト予定"} · {p.key}
            </strong>
            <label className="field">
              <span>位置</span>
              <select
                value={p.position}
                onChange={(e) =>
                  updatePlacement(i, { position: e.target.value as typeof p.position })
                }
              >
                <option value="article_end">記事末尾</option>
                <option value="marker">本文マーカー</option>
              </select>
            </label>
            <label className="field">
              <span>状態</span>
              <select
                value={p.status}
                onChange={(e) => updatePlacement(i, { status: e.target.value as typeof p.status })}
              >
                <option value="ready">準備済み</option>
                <option value="paused">一時停止</option>
              </select>
            </label>
            {p.kind === "adsense" ? (
              <label className="field">
                <span>広告ユニット</span>
                <select
                  value={p.adUnit}
                  onChange={(e) => updatePlacement(i, { adUnit: e.target.value })}
                >
                  {overview.settings.adUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="field">
                <span>案件</span>
                <select
                  value={p.offerId ?? ""}
                  onChange={(e) => updatePlacement(i, { offerId: e.target.value || null })}
                >
                  <option value="">案件未割当</option>
                  {overview.offers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}（{o.status}）
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" onClick={() => setPreview(p.key)}>
              プレビュー
            </button>
            {p.position === "marker" && position !== null && (
              <button
                type="button"
                onClick={() => {
                  const marker = `{{monetization:${p.key}}}`;
                  const oldIndex = body.indexOf(marker);
                  const clean = body.replace(marker, "");
                  const at = position - (oldIndex >= 0 && oldIndex < position ? marker.length : 0);
                  onBody(
                    `${clean.slice(0, at).trimEnd()}\n\n${marker}\n\n${clean.slice(at).trimStart()}`,
                  );
                  setPosition(null);
                }}
              >
                選択したブロックの後へ移動
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const marker = `{{monetization:${p.key}}}`;
                if (p.position === "marker") onBody(body.split(marker).join(""));
                setConfig((c) => ({ ...c, placements: c.placements.filter((_, n) => n !== i) }));
                setPosition(null);
              }}
            >
              {p.position === "marker" ? "配置とマーカーを削除" : "配置を削除"}
            </button>
            <button
              type="button"
              disabled={i === 0}
              onClick={() =>
                setConfig((c) => {
                  const placements = [...c.placements];
                  [placements[i - 1], placements[i]] = [placements[i]!, placements[i - 1]!];
                  return { ...c, placements };
                })
              }
            >
              順序を上へ
            </button>
            {preview === p.key &&
              (p.kind === "affiliate" ? (
                <AffiliatePreview offer={overview.offers.find((o) => o.id === p.offerId)} />
              ) : (
                <div className="ad-preview">広告 · 300 × 250（実広告は読み込みません）</div>
              ))}
          </li>
        ))}
      </ol>
      {problem && <p role="alert">{problem}</p>}
      <button type="button" disabled={busy || !dirty} onClick={() => void onSaveAll()}>
        収益化設定を保存
      </button>
    </Panel>
  );
}

function insertionBlocks(body: string) {
  const result: { end: number; html: string }[] = [];
  let offset = 0;
  for (const token of marked.lexer(body)) {
    const start = body.indexOf(token.raw, offset);
    if (start < 0) continue;
    offset = start + token.raw.length;
    if (token.type === "space" || token.type === "code" || /\{\{monetization:/.test(token.raw))
      continue;
    result.push({ end: offset, html: marked.parse(token.raw, { async: false }) as string });
  }
  return result;
}
