const TRAILING_COST_REPORT = /<p>\s*\{\{embed:cost-report\}\}\s*<\/p>\s*$/;
const COST_HEADING =
  /<h2\b[^>]*>(?:旅(?:行)?の)?(?:総)?費用(?:の)?(?:一覧|総括|内訳|まとめ)?<\/h2>/;

/** Legacy imports appended the report. Show it with the figures it summarizes. */
export function placeCostReport(html: string): string {
  const marker = TRAILING_COST_REPORT.exec(html);
  if (!marker) return html;

  const body = html.slice(0, marker.index);
  const heading = COST_HEADING.exec(body);
  if (!heading) return html;

  const sectionStart = heading.index + heading[0].length;
  const nextBlock = /<table\b|<h[23]\b/.exec(body.slice(sectionStart));
  const place = nextBlock?.[0] === "<table" ? sectionStart + nextBlock.index : sectionStart;
  return `${body.slice(0, place)}\n${marker[0]}\n${body.slice(place)}`;
}
