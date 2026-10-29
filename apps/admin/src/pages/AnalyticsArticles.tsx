import type { ArticleReadingDto, ArticleSummaryDto } from "@tomokichi/contracts";
import { reviewReasons } from "../lib/analytics-review";
import { href } from "../lib/route";
import { Panel } from "../ui/parts";

const percent = (n: number | null) => (n === null ? "—" : `${(100 * n).toFixed(1)}%`);
const number = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
const change = (current: number | null, previous: number | null) =>
  current !== null && previous !== null && previous > 0
    ? `${current >= previous ? "+" : ""}${(((current - previous) / previous) * 100).toFixed(0)}%`
    : "—";

/** Per-article reading and the articles worth another look, site view only. */
export function AnalyticsArticles({
  rows,
  articles,
  onSelect,
}: {
  rows: ArticleReadingDto[];
  articles: readonly ArticleSummaryDto[];
  onSelect: (articleId: string) => void;
}) {
  const byId = new Map(articles.map((a) => [a.id, a]));
  const title = (row: ArticleReadingDto) =>
    byId.get(row.articleId)?.title ?? row.path ?? row.articleId;
  const review = rows
    .map((row) => ({
      row,
      reasons: reviewReasons(row, byId.get(row.articleId)?.updatedAt ?? null),
    }))
    .filter((item) => item.reasons.length > 0);
  return (
    <>
      <Panel title="記事ごとの読まれ方">
        <p className="muted">
          到達率と次の記事へは計測できた記事表示（GA4同意・ブロック等を除く）が分母。収益はAdSenseのページ別レポートから。
        </p>
        <div className="analytics-table">
          <table>
            <thead>
              <tr>
                <th>記事</th>
                <th>PV</th>
                <th>75%到達</th>
                <th>本文末</th>
                <th>次の記事へ</th>
                <th>検索クリック（前比）</th>
                <th>収益（円）</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((row) => (
                <tr key={row.articleId}>
                  <td>
                    <button type="button" className="link" onClick={() => onSelect(row.articleId)}>
                      {title(row)}
                    </button>
                  </td>
                  <td>{number(row.pageViews)}</td>
                  <td>{percent(row.body75Rate)}</td>
                  <td>{percent(row.bodyEndRate)}</td>
                  <td>{percent(row.nextArticleRate)}</td>
                  <td>
                    {number(row.clicks)}（{change(row.clicks, row.clicksPrevious)}）
                  </td>
                  <td>{number(row.earningsJPY)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="見直し候補">
        <p className="muted">
          前期間より検索クリックが3割以上減った・平均順位が2以上下がった・1年以上更新していないのに読まれている記事。書き直すかは記事を見て判断してください。
        </p>
        {review.length === 0 ? (
          <p>今の期間に該当する記事はありません。</p>
        ) : (
          <ul className="analytics-review">
            {review.map(({ row, reasons }) => (
              <li key={row.articleId}>
                <a href={href.article(row.articleId)}>{title(row)}</a>
                <small>{reasons.join(" · ")}</small>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
