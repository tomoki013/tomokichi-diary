const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * What an inline affiliate link says about itself. The body marks the link with
 * the Markdown title `"広告"` — `[ラベル](https://… "広告")` — and the build
 * writes the rel and this note, so the editor never types HTML.
 */
export const INLINE_AFFILIATE_TITLE = "広告";
const DISCLOSURE =
  '<small class="affiliate-inline-disclosure">広告：このリンク経由の予約で当サイトが報酬を受け取る場合があります。料金・条件は予約先でご確認ください。</small>';

/** Inline links use the same approved placements and kill switch as the cards. */
export function enhanceInlineAffiliates(html: string, allowedUrls: readonly string[]): string {
  const allowed = new Set(allowedUrls.flatMap((url) => [url, escapeAttribute(url)]));
  const disclosure = /<small\b[^>]*class="affiliate-inline-disclosure"[^>]*>[\s\S]*?<\/small>/gi;
  let approvedLinks = 0;
  const result = html.replace(/<(p|li)\b[^>]*>[\s\S]*?<\/\1>/gi, (block) => {
    let kept = 0;
    let marked = 0;
    const transformed = block.replace(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
      (anchor, attributes: string, label: string) => {
        const href = /\bhref="([^"]*)"/i.exec(attributes)?.[1];
        const title = /\btitle="([^"]*)"/i.exec(attributes)?.[1];
        if (title === INLINE_AFFILIATE_TITLE) {
          if (!href || !allowed.has(href)) return label;
          approvedLinks++;
          kept++;
          marked++;
          return `<a href="${href}" rel="sponsored nofollow noopener">${label}</a>`;
        }
        // Bodies published before the title marker carry the rel and the note as HTML.
        const rel = /\brel="([^"]*)"/i.exec(attributes)?.[1] ?? "";
        if (!rel.split(/\s+/).includes("sponsored")) return anchor;
        if (!href || !allowed.has(href)) return label;
        approvedLinks++;
        kept++;
        return anchor;
      },
    );
    if (!kept) return transformed.replace(disclosure, "");
    if (!marked || transformed.includes('class="affiliate-inline-disclosure"')) return transformed;
    return transformed.replace(/<\/(p|li)>$/i, `\n${DISCLOSURE}</$1>`);
  });
  return approvedLinks ? result : result.replace(disclosure, "");
}
