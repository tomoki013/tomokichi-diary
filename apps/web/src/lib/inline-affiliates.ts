const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** Inline links use the same approved placements and kill switch as the cards. */
export function enhanceInlineAffiliates(html: string, allowedUrls: readonly string[]): string {
  const allowed = new Set(allowedUrls.flatMap((url) => [url, escapeAttribute(url)]));
  const disclosure = /<small\b[^>]*class="affiliate-inline-disclosure"[^>]*>[\s\S]*?<\/small>/gi;
  let approvedLinks = 0;
  const result = html.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, (paragraph) => {
    let kept = 0;
    const transformed = paragraph.replace(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
      (anchor, attributes: string, label: string) => {
        const rel = /\brel="([^"]*)"/i.exec(attributes)?.[1] ?? "";
        if (!rel.split(/\s+/).includes("sponsored")) return anchor;
        const href = /\bhref="([^"]*)"/i.exec(attributes)?.[1];
        if (!href || !allowed.has(href)) return label;
        approvedLinks++;
        kept++;
        return anchor;
      },
    );
    return kept ? transformed : transformed.replace(disclosure, "");
  });
  return approvedLinks ? result : result.replace(disclosure, "");
}
