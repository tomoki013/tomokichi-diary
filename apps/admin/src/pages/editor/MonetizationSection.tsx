import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import {
  validate,
  renderArticleMarkdown,
  articleMonetizationSchema,
  type ArticleMonetization,
  type ArticleMonetizationDto,
  type MonetizationOverviewDto,
  type MonetizationPlacement,
} from "@tomokichi/contracts";
import { api } from "../../lib/api";
import {
  adLayoutLabels,
  adLayoutOf,
  applyLayout,
  bodyAdFits,
  insertMarker,
  modeFor,
  removeMarker,
  type AdLayout,
} from "../../lib/ad-standard";
import { href } from "../../lib/route";
import type { AdPreview } from "../../lib/ad-preview";
import { useResource } from "../../ui/hooks";
import { Badge, ErrorState, Panel } from "../../ui/parts";
import { useToast } from "../../ui/toast";
import { useSectionSave, type RegisterSection } from "./section-save";
import { AffiliatePreview } from "../AffiliatePreview";

type Props = {
  articleId: string;
  body: string;
  onBody: (body: string) => void;
  register: RegisterSection;
  onSaveAll: () => Promise<boolean>;
  /** Tells the draft preview which ads to draw, unsaved choices included. */
  onPreview?: (preview: AdPreview) => void;
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

/** What the picker is choosing a block for. */
type Picking = "body-ad" | "affiliate" | "adsense" | null;

function Loaded({
  articleId,
  body,
  onBody,
  register,
  onSaveAll,
  onPreview,
  data,
  overview,
}: Props & { data: ArticleMonetizationDto; overview: MonetizationOverviewDto }) {
  const [config, setConfigRaw] = useState(data.draft);
  const [baseline, setBaseline] = useState(JSON.stringify(data.draft));
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<Picking>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const toast = useToast();
  const dirty = JSON.stringify(config) !== baseline;
  const parsed = validate(articleMonetizationSchema, config);
  const problem = parsed.ok ? undefined : parsed.issues.map((i) => i.message).join(" / ");
  // The mode is never picked by hand: it follows from the ads and affiliate slots.
  const setConfig = (next: (c: ArticleMonetization) => ArticleMonetization) =>
    setConfigRaw((c) => {
      const n = next(c);
      return { ...n, mode: modeFor(n.adsEnabled, n.placements) };
    });
  async function save() {
    setBusy(true);
    try {
      const result = await api.saveArticleMonetization(articleId, config);
      setConfigRaw(result);
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

  const experiment = overview.experiments.find(
    (e) => e.id === config.experimentId && e.status === "running",
  );
  const layout = adLayoutOf(config);
  useEffect(() => {
    onPreview?.({ config, offers: overview.offers, testMarker: experiment?.markerKey ?? null });
  }, [config, overview.offers, experiment, onPreview]);
  const bodyAd = config.placements.find(
    (p) => p.kind === "adsense" && p.position === "marker" && p.status === "ready",
  );
  const affiliates = config.placements.filter((p) => p.kind === "affiliate");
  const blocks = useMemo(() => (picking ? insertionBlocks(body) : []), [body, picking]);

  function chooseLayout(next: AdLayout) {
    const plan = applyLayout(next, config, body, null);
    if ("error" in plan) {
      // No paragraph qualifies: keep the end ad and let the author pick.
      const endOnly = applyLayout("end-only", config, body, null);
      if (!("error" in endOnly)) {
        setConfig(() => endOnly.config);
        onBody(endOnly.body);
      }
      setPicking("body-ad");
      toast.info("自動で置ける段落がありません。本文中の広告を置く位置を選んでください");
      return;
    }
    setConfig(() => plan.config);
    if (plan.body !== body) onBody(plan.body);
  }

  function place(offset: number) {
    if (picking === "body-ad") {
      const key = bodyAd?.key ?? "body-ad";
      const clean = bodyAd ? removeMarker(body, key) : body;
      // The offset was measured on `body`; removing an earlier marker shifts it.
      const marker = bodyAd ? body.indexOf(`{{monetization:${key}}}`) : -1;
      const shift = marker >= 0 && marker < offset ? body.length - clean.length : 0;
      const next = insertMarker(clean, offset - shift, key);
      if (!bodyAdFits(next, key))
        toast.info("この位置は導入文や画像・カードに近いため、公開前チェックで止まります");
      onBody(next);
      setConfig((c) => ({
        ...c,
        adsEnabled: true,
        placements: bodyAd
          ? c.placements
          : [
              ...c.placements,
              {
                key,
                kind: "adsense",
                position: "marker",
                status: "ready",
                adUnit: overview.settings.adUnits[0]?.id ?? "7152502134",
                offerId: null,
              },
            ],
      }));
    } else if (picking) {
      const key = `slot-${crypto.randomUUID()}`;
      const kind = picking === "affiliate" ? "affiliate" : "adsense";
      onBody(insertMarker(body, offset, key));
      setConfig((c) => ({
        ...c,
        placements: [
          ...c.placements.map((p) =>
            // A new body ad replaces the previous one; the end ad stays.
            kind === "adsense" && p.kind === "adsense" && p.position === "marker"
              ? { ...p, status: "paused" as const }
              : p,
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
      setPreview(key);
    }
    setPicking(null);
  }

  const updatePlacement = (key: string, patch: Partial<MonetizationPlacement>) =>
    setConfig((c) => ({
      ...c,
      placements: c.placements.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    }));
  function remove(p: MonetizationPlacement) {
    if (p.position === "marker") onBody(removeMarker(body, p.key));
    setConfig((c) => ({ ...c, placements: c.placements.filter((x) => x.key !== p.key) }));
  }

  return (
    <Panel title="収益化">
      <div className="ad-layout">
        <fieldset className="segmented" disabled={Boolean(experiment)}>
          <legend>AdSense</legend>
          {(Object.keys(adLayoutLabels) as AdLayout[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={layout === key}
              onClick={() => layout !== key && chooseLayout(key)}
            >
              {adLayoutLabels[key]}
              {key === "standard" && <small>おすすめ</small>}
            </button>
          ))}
        </fieldset>
        {experiment ? (
          <p className="notice notice--accent">
            A/Bテスト中です（半数の読者は末尾のみ）。終了して標準にするには{" "}
            <a href={href.monetization()}>収益化 → 広告配置</a> でまとめて揃えます。
          </p>
        ) : layout === "end-only" ? (
          <p className="notice notice--warn">
            本文中の広告がありません。「標準」を押すと、見出しと600字以上の後の段落を自動で選びます。
          </p>
        ) : null}
        {layout === "standard" && bodyAd && (
          <div className="ad-spot">
            <span className="muted small">本文中の広告：この段落の後</span>
            <q>{paragraphBefore(body, bodyAd.key) || "（段落を読み取れません）"}</q>
            {!bodyAdFits(body, bodyAd.key) && (
              <p className="form-error">導入文・画像・カードに近すぎます。位置を変えてください。</p>
            )}
            <button type="button" className="link" onClick={() => setPicking("body-ad")}>
              位置を変える
            </button>
          </div>
        )}
      </div>

      <div className="ad-affiliates">
        <div className="row">
          <strong>アフィリエイト枠</strong>
          <span className="muted small">
            {overview.settings.affiliateEnabled
              ? "承認済みの案件だけ公開されます"
              : "サイト方針で無効（管理画面のみ）"}
          </span>
        </div>
        {affiliates.length === 0 && <p className="muted small">なし</p>}
        <ul className="ad-slots">
          {affiliates.map((p) => (
            <li key={p.key}>
              <select
                aria-label="案件"
                value={p.offerId ?? ""}
                onChange={(e) => updatePlacement(p.key, { offerId: e.target.value || null })}
              >
                <option value="">案件未割当</option>
                {overview.offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}（{o.status}）
                  </option>
                ))}
              </select>
              {p.position === "article_end" && <Badge>記事末尾</Badge>}
              {p.status === "paused" && <Badge tone="warn">停止中</Badge>}
              <button
                type="button"
                className="link"
                onClick={() => setPreview(preview === p.key ? null : p.key)}
              >
                プレビュー
              </button>
              <button type="button" className="link" onClick={() => remove(p)}>
                削除
              </button>
              {preview === p.key && (
                <AffiliatePreview offer={overview.offers.find((o) => o.id === p.offerId)} />
              )}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setPicking("affiliate")}>
          アフィリエイト枠を本文に追加
        </button>
      </div>

      {picking && (
        <div className="ad-picker">
          <div className="row">
            <strong>
              {picking === "body-ad"
                ? "本文中の広告を置く段落を選ぶ"
                : picking === "affiliate"
                  ? "アフィリエイト枠を置く段落を選ぶ"
                  : "AdSense枠を置く段落を選ぶ"}
            </strong>
            <button type="button" className="link" onClick={() => setPicking(null)}>
              やめる
            </button>
          </div>
          <div className="monetization-picker" aria-label="挿入位置を選択">
            {blocks.map((b) => (
              <div key={b.end} className="monetization-block">
                <div className="preview" dangerouslySetInnerHTML={{ __html: b.html }} />
                <button type="button" onClick={() => place(b.end)}>
                  この後に置く
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <details className="ad-advanced">
        <summary>詳細設定（A/Bテスト・ユニット・個別の枠）</summary>
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
        <button type="button" onClick={() => setPicking("adsense")}>
          AdSense枠を位置を選んで追加（既存の本文枠は一時停止）
        </button>
        <ol className="monetization-placements">
          {config.placements.map((p) => (
            <li key={p.key}>
              <strong>
                {p.kind === "adsense" ? "AdSense" : "アフィリエイト"} · <code>{p.key}</code>
              </strong>
              <div className="row">
                <label className="field">
                  <span>位置</span>
                  <select
                    value={p.position}
                    onChange={(e) =>
                      updatePlacement(p.key, { position: e.target.value as typeof p.position })
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
                    onChange={(e) =>
                      updatePlacement(p.key, { status: e.target.value as typeof p.status })
                    }
                  >
                    <option value="ready">表示</option>
                    <option value="paused">一時停止</option>
                  </select>
                </label>
                {p.kind === "adsense" && (
                  <label className="field">
                    <span>広告ユニット</span>
                    <select
                      value={p.adUnit}
                      onChange={(e) => updatePlacement(p.key, { adUnit: e.target.value })}
                    >
                      {overview.settings.adUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button type="button" className="link" onClick={() => remove(p)}>
                  {p.position === "marker" ? "枠とマーカーを削除" : "枠を削除"}
                </button>
              </div>
            </li>
          ))}
        </ol>
      </details>

      {problem && <p role="alert">{problem}</p>}
      <div className="row">
        <button type="button" disabled={busy || !dirty} onClick={() => void onSaveAll()}>
          保存
        </button>
        <span className="muted small">
          {config.updatedAt
            ? `最終編集 ${new Date(config.updatedAt).toLocaleString("ja-JP")}`
            : "未編集（既定の末尾広告）"}
          ・保存後「変更を公開」でサイトに出ます
        </span>
      </div>
    </Panel>
  );
}

/** The paragraph a marker follows, trimmed for a one-line reminder. */
function paragraphBefore(body: string, key: string): string {
  const at = body.indexOf(`{{monetization:${key}}}`);
  if (at < 0) return "";
  const text = body
    .slice(0, at)
    .trim()
    .split(/\n\s*\n/)
    .at(-1)
    ?.replace(/[#*_>`[\]]/g, "")
    .trim();
  return text && text.length > 80 ? `…${text.slice(-80)}` : (text ?? "");
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
    result.push({ end: offset, html: renderArticleMarkdown(token.raw) });
  }
  return result;
}
