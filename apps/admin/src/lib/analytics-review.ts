import type { ArticleReadingDto } from "@tomokichi/contracts";

const number = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("ja-JP", { maximumFractionDigits: 1 });

/**
 * Why an article may need another look. Only listed, never rewritten: the
 * author decides. Search falling or slipping, or a well-read article that has
 * not been touched in a year.
 */
export function reviewReasons(
  row: ArticleReadingDto,
  updatedAt: string | null,
  now = Date.now(),
): string[] {
  const reasons: string[] = [];
  if (
    row.clicks !== null &&
    row.clicksPrevious !== null &&
    row.clicksPrevious >= 20 &&
    row.clicks <= row.clicksPrevious * 0.7
  )
    reasons.push(`検索クリック ${row.clicksPrevious}→${row.clicks}`);
  if (
    row.position !== null &&
    row.positionPrevious !== null &&
    row.positionPrevious <= 20 &&
    (row.impressions ?? 0) >= 100 &&
    row.position - row.positionPrevious >= 2
  )
    reasons.push(`平均順位 ${number(row.positionPrevious)}→${number(row.position)}`);
  const days = updatedAt ? Math.floor((now - Date.parse(updatedAt)) / 86_400_000) : null;
  if (days !== null && days >= 365 && (row.pageViews ?? row.measuredViews) >= 50)
    reasons.push(`読まれているのに${days}日更新なし`);
  return reasons;
}
