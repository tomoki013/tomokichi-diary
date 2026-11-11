# 分析データモデル

`migrations/0015_analytics.sql` と `0016_analytics_period_counts.sql` は追記だけのexpand migration。既存記事・画像・routesに変更なし。

| Table                   | Key                   | 内容                                                                  |
| ----------------------- | --------------------- | --------------------------------------------------------------------- |
| analytics_days          | source,date           | 取得済み日付の集計JSON。最大800KB/日                                  |
| analytics_status        | source                | attempted/succeeded/latest日付、要求期間、sanitizeされたerror code    |
| analytics_period_counts | start,end             | GA4の期間distinct人数/session、取得日数、取得時刻。個人IDを保存しない |
| analytics_reports       | period,start,end      | 週次/月次の集計事実と前期間比較。AI無効状態を記録                     |
| analytics_facts         | grain,key,source,date | 長期推移用の1日1行。全体・流入経路・記事・検索種別の足せる数字だけ    |

Source: ga4 / gsc_site / gsc_url / adsense / affiliate。Dayはdate、retrievedAt、provisional、rows。Rowはgrain、key、観測path、articleId、数値またはnullのmetrics。個人ID、GA session ID、生イベント、メール/IPは出力しない。検索語は非匿名の集計だけ（非公開）。

Grain: site/page/query/source/device/country/search_type/event/campaign/entry。異なるgrainを合算しない。URLとqueryのrowは観測pathを保存し、routesのredirectチェーン/canonicalからarticleIdを解決する。未対応host/URLは記事へ推測で対応させない。記事PV/クリックはaliasを足せるがdistinct users/sessionsは足せない。日次rowからの合計ではunique指標を除外し、期間cacheの正確なdistinct数を別途使う。

保存はsource/dayの旧行を削除し新行挿入・success更新を同じD1 batch transactionで実施する。失敗時は旧成功値を維持。欠けたexport日の既存行は消さない。欠損期間はcoverage、latestDate、errorで見える。過去backfillでもlatestDateを後退させない。source間の成功・失敗は独立して記録する。

GA4日次tableの存在とGSC ExportLogのnamespace/dateで取得可能日を確認する。日次GA4/GSC siteの完全取得で該当行がなければ0を保持するが、GSC全要求期間が空ならプロパティ誤設定を疑って失敗にする。記事の行がない取得済み日は加算指標0、ソース未取得日はnull。AdSense実績未発生/未取得を架空の0収益へ変換しない。

AffiliateRecord: provider, recordId, date, campaignId, url|null, currency=JPY, clicks, pending/confirmedConversions, pending/confirmedReward。ASP adapterは各日・全providerの完全snapshotを出す。provider/recordId重複は失敗。差分イベントログをこのinterfaceへ渡さない。複数通貨は初期実装で拒否し、勝手に換算しない。

## 訪問の入口（entry）と長期推移（analytics_facts）

GA4 の日に `entry` 行を足した（2026-11-11）。1訪問（セッション）を開始日に1回だけ数え、キーは参照元ホスト・utm_source・utm_medium・初回/再訪、path は入口ページ。指標は entrances・engagedEntrances・entryPageViews・singlePageEntrances。参照元は URL ではなくホストだけ、utm は英数字40文字までで、それ以外は `(other)`。流入経路（検索・AI・SNS・参照・直接・メール・キャンペーン・サイト内）への分類は読むときに `classifyChannel` で行うので、分類を直しても再取得は要らない。

`analytics_facts` は日を保存するときに同じバッチで作り直す（`factsOf`）。grain は site / channel / article / search_type。列は page_views・entrances・engaged_entrances・new_entrances・clicks・impressions・position_sum・earnings_jpy で、その取得元が持たない数字は NULL。人数（users/sessions の distinct）は足せないので入れない。記事は articleId に解決できた行だけ（別 URL の同じ記事は1行にまとまる）。週・月の推移は SQL の SUM で出し、日ごとの JSON を読まない。

入口の行が無い日（この変更より前に取得した日）は entrances が NULL。過去分は再集計（31日ずつ）で埋まる。GA4 の BigQuery export がある日まで遡れる。
