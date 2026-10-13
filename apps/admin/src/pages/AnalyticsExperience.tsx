import type { ExperienceCohortDto } from "@tomokichi/contracts";
const percent = (n: number | null) => (n === null ? "—" : `${(100 * n).toFixed(1)}%`);
export function AnalyticsExperience({
  cohorts,
  previous = [],
}: {
  cohorts: ExperienceCohortDto[];
  previous?: ExperienceCohortDto[];
}) {
  return (
    <>
      <p className="muted">
        広告を増やさず中盤35%・65%への到達を計測。本文末到達は読了の証明ではなく、可視ページ時間は注意・読書時間を保証しません。GA4同意・ブロック等で計測できない訪問は含みません。
      </p>
      {!cohorts.length && (
        <p>
          計測データは未取得です。導入前の数値は復元できません。GA4日次エクスポート後に表示します。
        </p>
      )}
      {cohorts.map((c) => (
        <details className="analytics-breakdown" key={`${c.layout}-${c.device}`} open>
          <summary>
            {c.device} · {c.layout} · 計測記事表示 {c.views}件
          </summary>
          <p>
            {c.firstDate}〜{c.lastDate} · データがある日 {c.measuredDays}日 ·{" "}
            {c.reviewReady
              ? "配置検討の目安を満たしています"
              : "サンプルを収集中（端末別200表示・14計測日を目安）"}
          </p>
          <p className="muted">
            {(() => {
              const prior = previous.find((p) => p.layout === c.layout && p.device === c.device);
              return prior
                ? `前期間の同じ配置・端末: ${prior.views}表示 / 本文末${percent(prior.bodyEndRate)} / 広告リクエスト${percent(prior.adRequestRate)} / 回遊操作${percent(prior.nextArticleRate)}`
                : "前期間は同じ配置・端末の計測データ未取得";
            })()}
          </p>
          <div className="analytics-table">
            <table>
              <thead>
                <tr>
                  <th>指標</th>
                  <th>数値</th>
                  <th>基準</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>中盤35% / 65%到達</td>
                  <td>
                    {percent(c.candidate35Rate)} / {percent(c.candidate65Rate)}
                  </td>
                  <td>計測記事表示</td>
                </tr>
                <tr>
                  <td>本文末到達</td>
                  <td>{percent(c.bodyEndRate)}</td>
                  <td>計測記事表示</td>
                </tr>
                <tr>
                  <td>末尾広告リクエスト</td>
                  <td>
                    {c.adRequests}件 · {percent(c.adRequestRate)}
                  </td>
                  <td>計測記事表示（広告の200px手前）</td>
                </tr>
                <tr>
                  <td>広告配信 / 未配信 / スクリプトエラー</td>
                  <td>
                    {c.adFilled} / {c.adUnfilled} / {c.adScriptErrors}
                  </td>
                  <td>配信率 {percent(c.adFillRate)}（広告リクエスト）</td>
                </tr>
                <tr>
                  <td>広告視認の目安</td>
                  <td>
                    {c.adViewableProxy}件 · {percent(c.adViewableProxyRate)}
                  </td>
                  <td>
                    配信済み枠の50%以上が可視状態で連続1秒。AdSense公式Active Viewとは異なります
                  </td>
                </tr>
                <tr>
                  <td>可視ページ時間 / 表示</td>
                  <td>
                    {c.visibleMsPerView === null
                      ? "—"
                      : `${(c.visibleMsPerView / 1000).toFixed(1)}秒`}
                  </td>
                  <td>バックグラウンドを除外・1表示最大30分</td>
                </tr>
                <tr>
                  <td>次記事 / 共有操作 / いいね操作</td>
                  <td>
                    {percent(c.nextArticleRate)} / {percent(c.shareActionRate)} /{" "}
                    {percent(c.likeActionRate)}
                  </td>
                  <td>計測記事表示。操作完了・次ページ到着の証明ではありません</td>
                </tr>
                {c.vitals.map((v) => (
                  <tr key={v.vital}>
                    <td>{v.vital} p75の区分</td>
                    <td>
                      {
                        (
                          {
                            good: "良好",
                            "needs-improvement": "改善が必要",
                            poor: "不良",
                            insufficient: "サンプル不足",
                          } as Record<string, string>
                        )[v.p75Band]
                      }
                    </td>
                    <td>
                      {v.samples}サンプル（50未満は判定しません）· 良好{v.good} / 要改善
                      {v.needsImprovement} / 不良{v.poor}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
      <p className="muted">
        週次は変化の観察、月次・28日表示は配置の再検討に利用します。収益・表示機会と本文到達・回遊・速度を併せて確認し、季節・端末・流入の違いを考慮します。前後比較だけで広告の因果効果は判断できません。広告位置・本数は自動変更しません。
      </p>
    </>
  );
}
