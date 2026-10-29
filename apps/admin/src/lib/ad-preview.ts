import type { AffiliateOffer, ArticleMonetization } from "@tomokichi/contracts";
import { adLayoutOf } from "./ad-standard";

/** What the draft preview needs to stand in for the ads readers will see. */
export interface AdPreview {
  config: ArticleMonetization;
  offers: readonly Pick<
    AffiliateOffer,
    "id" | "name" | "heading" | "provider" | "url" | "status" | "publicationApproved"
  >[];
  /** A running test's B slot: shown to B readers only, whatever its stored status. */
  testMarker: string | null;
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const box = (kind: string, label: string, note: string) =>
  `<aside class="ad-mock ad-mock--${kind}" aria-label="${escape(label)}（プレビュー）"><span class="ad-mock__label">${escape(label)}</span><span class="ad-mock__note">${escape(note)}</span></aside>`;

/** Marker lines become placeholders the rendered HTML swaps for mock boxes. */
export function markersToPlaceholders(markdown: string): string {
  return markdown.replace(
    /^\{\{monetization:([a-z0-9]+(?:-[a-z0-9]+)*)\}\}[ \t]*$/gm,
    '\n\n<div data-ad-preview="$1"></div>\n\n',
  );
}

/**
 * Swaps each placeholder for what readers get at that spot — an ad-sized box,
 * an affiliate card, or nothing for a paused or unknown slot — and adds the
 * article-end ad. Without a configuration (still loading, or a page) every
 * marker shows as a neutral slot so none silently disappears.
 */
export function withAdMocks(html: string, preview: AdPreview | null): string {
  const config = preview?.config;
  const body = html.replace(/<div data-ad-preview="([a-z0-9-]+)"><\/div>/g, (_, key: string) => {
    if (!config) return box("unknown", "広告枠", key);
    const slot = config.placements.find((p) => p.key === key);
    if (key === preview.testMarker)
      return box("ad", "広告", "本文中 300×250・テストのB（半数の読者）のみ");
    if (preview.testMarker && slot?.kind === "adsense")
      return box("off", "非表示の枠", "テスト中はBの枠だけが出ます");
    if (!slot || slot.status !== "ready")
      return box(
        "off",
        "非表示の枠",
        slot ? "一時停止中・読者には出ません" : "設定のない枠・公開前チェックで止まります",
      );
    if (slot.kind === "affiliate") {
      const offer = preview.offers.find((o) => o.id === slot.offerId);
      return box(
        "affiliate",
        offer?.heading || offer?.name || "アフィリエイト（案件未割当）",
        offer ? `${offer.provider}・PR表記付きのカード` : "案件を割り当てるまで公開されません",
      );
    }
    if (adLayoutOf(config) === "none") return box("off", "非表示の枠", "広告なしの設定");
    return box("ad", "広告", "本文中 300×250");
  });
  const end = config && adLayoutOf(config) !== "none" ? box("ad", "広告", "記事末尾 300×250") : "";
  return body + end;
}

/**
 * URLs whose inline `[ラベル](URL "広告")` links readers will get as links:
 * the offers assigned to this article's ready affiliate slots and cleared for
 * publication. Any other marked link shows as plain text, as on the site.
 */
export function approvedInlineAffiliateUrls(preview: AdPreview | null): string[] {
  if (!preview) return [];
  return preview.config.placements.flatMap((placement) => {
    if (placement.kind !== "affiliate" || placement.status !== "ready") return [];
    const offer = preview.offers.find((o) => o.id === placement.offerId);
    return offer?.url && offer.status === "ready" && offer.publicationApproved ? [offer.url] : [];
  });
}
