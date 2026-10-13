# 現状監査（2026-10-13 JST）

対象: tomoki013/tomokichi-diary と archived の tomoki013/travel-diary。CHAGEEメディアサイトは対象外。実装は origin/main = e1717d1 から専用worktree / codex/diary-analytics-v2 で行う。並行作業の feat/chagee-guide、apps/chagee、コンテンツを変更しない。

## 旧集計

- `analytics-snapshot.yml`: 水曜07:00 JST予定、contents:write、JSONサービスアカウント鍵 `GCP_ANALYTICS_CREDENTIALS`、mainへ直接コミット。直近成功は [2026-10-07 10:04 JST](https://github.com/tomoki013/travel-diary/actions/runs/37555224819)。予定から遅れて実行されている。
- 8クエリすべて全履歴を読む。GSC 4回、GA4 4回。増分、スキャン上限、dry run、再試行なし。bq失敗で停止し、全クエリ成功後にJSON出力。
- GA4: 数字8桁suffixでintradayを排除するが、日付によるテーブル絞り込みなし。セッションはsession_startだけ、区切りなし連結による衝突の可能性。ページ離脱は全期間のsession内最後のPVを採用。欠損IDは計上不能。
- GSC: URL粒度をサイト合計として利用。site粒度とは別物。sum_position/impressions+1は正しい加重計算だが、保持された丸め値からの再集計は避ける。query IS NOT NULLだけでは匿名化の空文字を除外できない。重複キーの行はエクスポートの増分値なのでSUMが正しく、DISTINCTによる除去は誤り。
- GSC URLはfragmentだけ除去、GA4はquery/fragment除去。hostを一律除去し、別hostを誤統合しうる。canonical、redirect、記事ID対応なし。
- 数字に見える検索語もcoerceNumbersで数値に変換される。公開JSONは旧 `src/app/(pages)/admin/analytics/page.tsx` からimportされる。秘密データを公開Gitへ保存する方式を移行先で踏襲しない。

## 現行と文書の差

- CIはmainの検証後、production environmentから既存の4 Workersを配信。Publish contentは5分間隔でD1公開版をpullしてビルドする。既存workflowは変更しない。
- BaseLayoutは本番hostnameでgtagを遅延ロード。analytics.tsはsemantic eventをgtagへ送る。DECISIONSの「GA4未導入」は古い。
- ARCHITECTUREの「旧Netlifyへの切替前」「公開サイトは完全にJSなし」「配信はGit exportだけ」は現在の実装・ADMIN.mdと一致しない。公開ビルドはD1公開版を一時exportへpullするが、AstroからD1へ直接問い合わせることはない。
- AdminはReact hash router、同一origin `/api` service binding、API `/v1/admin/*` のAccess JWT/既存admin tokenゲート。分析もこの下で提供する。
- D1/R2は既存binding。公開用export・MCP catalogは分析テーブルを読まない。新サービス・公開R2 bucketは不要。

## Google Cloud参照

既存認証で読み取りを実施。両datasetはUS。GA4 daily tableは162個、最新events_20261011。GSC URLはdata_date DAY partition、約18.4 MB logical / 1.59 MB physical、siteは約3.71 MB / 0.90 MB。ExportLog存在・schemaを確認。billingEnabled=true、参照時WIF pool一覧は空。エクスポート設定、テーブル、IAM、課金は変更していない。課金内訳はCOST_REVIEWを参照。

## 推奨構成

日次Actions → GitHub OIDC/WIF → 既存BQのbounded query → 検証 → 既存非公開D1のsource/day集計。Admin/APIで日次データから週次・月次・前期間を投影。BQの生イベント、個人IDは複製しない。直近7日を置換し、backfillは31日単位。旧集計撤去は実データ比較と本番検証が済むまで保留。

## 実装前提の実データ照合

GSC実propertyはdomain形式ではなく `https://tomokichidiary.com/`。bounded取得で確認し既定値を合わせた。旧最新snapshotとの9/28〜10/4の7日比較ではGSC URL日次click/impressionがすべて一致。GA4差分は本番hostname限定と全イベントsession組の新定義で全日説明できた（MIGRATION参照）。本番配信・全履歴backfillの検証は未完了。
