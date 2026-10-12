# 移行状態と撤去ゲート

## 完了

- archived旧repo・現行code/CI/admin・Google metadataを監査。
- 専用worktree（main起点）にAnalytics実装、8文書、workflow、SQL、テストを用意。
- 2026-10-04〜10-10のGA4/GSC読み取りを検証。source毎7/7日、GA4 367 / GSC site 301 / URL 3317集計行。分析値/検索語はGit除外.dataにだけ保持。
- GSCの実propertyはhttps://tomokichidiary.com/。最初のdomain-property仮定を実データ確認で修正。空期間を成功0にしないguardを追加。

## 未完了（本番移行済みと扱わない）

- WIF専用principal/IAM、analytics GitHub environment/secrets、任意再集計token。
- migration/API/admin配信、本番D1保存、main Actions初回成功。
- 全履歴backfill、旧成功snapshotとの日別照合、本番Admin確認。
- AdSense user OAuth/account組合せ検証、記事別PAGE_URL収益。ASP未指定。AIは正確性検証後に別途導入。
- 任意期間のunique users/session合計（現時点のUIは日次平均を明示）。

## 比較

`pnpm exec tsx scripts/analytics/compare-legacy.ts /path/to/legacy/snapshot.json` は .data/analytics の新集計と旧JSONの共通日だけ照合し、private reportを書き出す。最初のローカル旧snapshotは共通日がなく0日だったため、GitHubの最新snapshot（2026-10-07生成）をprivateに読取取得し、9月28日〜10月4日の7日を再集計して照合した。

- GSC URL粒度の日別click/impressionは7/7日一致。
- GA4 PVは3日、users/sessionsは5日差分。ただし旧SQLの定義を同じ7日にboundedで再実行すると旧snapshotと7/7日一致した。
- 新しい本番hostnameフィルタを適用したPV/users、および全イベントのsession組DISTINCTは新集計と7/7日一致した。差分は意図したhostname対象・session定義の変更で説明でき、履歴欠損や未知の差分として残っていない。

これは限定期間の読取照合であり、全履歴移行や本番切替ゲートの達成ではない。詳細な数値は.data/analytics/legacy-comparison.jsonとga4-definition-audit.jsonにだけ保存。

旧snapshotのgeneratedAt/rangeを確認し、そこに含まれる共通日付だけ比較する。旧JSONは公開済みでも新データとともにGitへ再コピーしない。

1. GA4 daily PV/usersを同じhostname/日境界/観測期間で照合。旧クエリはhostnameを除去した全イベント、新クエリは本番hostnameが分かるイベントだけなので差分を説明する。sessionsは新定義の全イベント組DISTINCTと旧session_start定義を分ける。ページuniqueを合算しない。
2. GSC旧dailyはURL grain、新概要はsite grain。比較相手を新URLページ行の合計に揃える。siteとURLの差は正常な粒度差であり同値を強制しない。順位は旧丸め値の平均ではなくposition分子/分母の元データから検証。
3. URL統合によるpath→articleId変更、query/fragment除去、redirect/canonicalの対応、未知URLを一覧確認する。
4. 7日再取得を2回、31日backfill、source失敗→再実行、credentialエラーで旧成功値が消えないことを確認。最新日watermarkがbackfillで後退しないことを確認。
5. 公開web/MCP/export/Git/Actions artifactsに新分析値・収益・認証が混入しないことを検査。

## 旧撤去の必須条件

本番新基盤正常稼働、両source取得、旧新差分検証、全履歴継承、Admin閲覧、既存export継続、復旧手順の全条件を管理者が確認するまでは旧workflow/script/snapshotを残す。

旧repo全体の削除は禁止。条件達成後、管理者の権限でarchive解除→旧analytics参照箇所再検索→専用workflow/scriptと不要snapshotだけ削除するPRをレビュー→必要なら再archive。旧dashboardのsnapshot importも依存解消が必要。旧JSON鍵は他用途がないことを確認してSecretから除去し、Google側keyを失効させる。export用SA/テーブルを巻き込まない。

GA4/GSC native export、Google project、history、記事routes、CHAGEEサイトには変更しない。現時点で旧repoの撤去・archive解除・Secret削除は実施していない。
