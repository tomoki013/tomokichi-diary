# 分析データモデル

`migrations/0015_analytics.sql` は追記だけのexpand migration。既存記事・画像・routesに変更なし。

| Table             | Key              | 内容                                                               |
| ----------------- | ---------------- | ------------------------------------------------------------------ |
| analytics_days    | source,date      | 取得済み日付の集計JSON。最大800KB/日                               |
| analytics_status  | source           | attempted/succeeded/latest日付、要求期間、sanitizeされたerror code |
| analytics_reports | period,start,end | 週次/月次の集計事実と前期間比較。AI無効状態を記録                  |

Source: ga4 / gsc_site / gsc_url / adsense / affiliate。Dayはdate、retrievedAt、provisional、rows。Rowはgrain、key、観測path、articleId、数値またはnullのmetrics。個人ID、GA session ID、生イベント、メール/IPは出力しない。検索語は非匿名の集計だけ（非公開）。

Grain: site/page/query/source/device/country/search_type/event/campaign。異なるgrainを合算しない。URLとqueryのrowは観測pathを保存し、routesのredirectチェーン/canonicalからarticleIdを解決する。未対応host/URLは記事へ推測で対応させない。記事PV/クリックはaliasを足せるがdistinct users/sessionsは足せない。UIの集計ではunique指標を意図的に除外する。

保存はsource/dayの旧行を削除し新行挿入・success更新を同じD1 batch transactionで実施する。失敗時は旧成功値を維持。欠けたexport日の既存行は消さない。欠損期間はcoverage、latestDate、errorで見える。過去backfillでもlatestDateを後退させない。source間の成功・失敗は独立して記録する。

GA4日次tableの存在とGSC ExportLogのnamespace/dateで取得可能日を確認する。日次GA4/GSC siteの完全取得で該当行がなければ0を保持するが、GSC全要求期間が空ならプロパティ誤設定を疑って失敗にする。記事の行がない取得済み日は加算指標0、ソース未取得日はnull。AdSense実績未発生/未取得を架空の0収益へ変換しない。

AffiliateRecord: provider, recordId, date, campaignId, url|null, currency=JPY, clicks, pending/confirmedConversions, pending/confirmedReward。ASP adapterは各日・全providerの完全snapshotを出す。provider/recordId重複は失敗。差分イベントログをこのinterfaceへ渡さない。複数通貨は初期実装で拒否し、勝手に換算しない。
