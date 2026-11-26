# コスト監査（2026-10-13）

月約700円の原因は未確定。billingEnabled=trueは確認できたが、課金SKU/請求明細にはアクセスしていない。既存exportや履歴を削除/停止しない。

## 参照できた証拠

- 162 GA4 daily tables: logical 73,817,988 bytes、physical 5,563,444 bytes。
- GSC 3 tables: logical 22,139,773 bytes、physical 2,506,116 bytes。合計約96 MB logical / 8 MB physical。
- region-us TABLE_STORAGEは権限拒否。その後tables.get metadataで上記を集計（rawはGit除外.artifactsだけ）。将来のstorage増大やdatasetのbilling modelは未確認。
- JOBS_BY_PROJECTの30日履歴: SELECT 272件 / billed 2,279,604,224 bytes、INSERT 120件 / 83,886,080 bytes、SCRIPT 60件 / 713,031,680 bytes、LOAD 31件。script parent/childを含むので行を足して請求額とみなさない。exportによるINSERT/SCRIPTと旧集計を区別する追加調査が必要。
- 7日分dry run（10月4〜10日）: GA4 4,998,832 bytes、GSC site 361,518 bytes、URL 2,542,815 bytes、GA4 table metadata 10,485,760 bytes、GSC ExportLog 11,857 bytes。dry run値は推定processed、料金請求の最小単位とは異なる。

これらだけでは700円の根拠にならない。無料枠は請求account全体での使用にも依存する。推測でstorage/query/streamingを原因と決めない。

## 管理者の確認

[Cloud Billing Reports](https://console.cloud.google.com/billing)で対象月・project=tomokichidiary-analyticsに絞り、service→SKUで分解。BigQuery Analysis、active/long-term storage、streaming insert、その他サービス、credits・税・currencyを確認。GA4 daily/streaming設定とGSC bulk export設定を読むだけにする。billing exportがある場合は、そのdatasetでSKU別cost/credits集計。現在このprojectで参照したdataset一覧にbilling exportはない。

再確認用の読取SQL（jobUser + メタデータ参照権限が必要）:

```sql
SELECT job_type, statement_type, parent_job_id IS NULL AS root_job,
       COUNT(*) AS jobs, SUM(total_bytes_processed) AS processed_bytes,
       SUM(total_bytes_billed) AS billed_bytes, SUM(total_slot_ms) AS slot_ms
FROM `tomokichidiary-analytics.region-us.INFORMATION_SCHEMA.JOBS_BY_PROJECT`
WHERE creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY job_type, statement_type, root_job;
```

permission不足ならConsoleでBilling Account Viewer/BigQuery Resource Viewerを持つ管理者に確認を依頼する。収集SAにbilling権限を足さない。

## 新集計の制約

suffix/day partitionのbounded query。通常直近7日、backfill max31日。jobごとのmaximumBytesBilled既定1GB、設定は10MB〜10GB内のみ。日次3集計+availability（GA4 metadataとGSC logをnamespace別に2回）+期間unique用1query。期間uniqueは最大186日の必要列だけを読む（90日と前90日、または任意93日と前93日）。10/4〜10/10を終端にした期間queryはdry run 41,152,130 bytes、12windowsの実取得も成功。週次/月次レポートはD1のみ。クエリ数の最低課金、Actions無料枠、D1 read/write/storage使用量も監視する。

`pnpm exec tsx scripts/analytics/run.ts --start 2026-10-04 --end 2026-10-10 --dry-run` は書き込みなし。BigQuery最大課金量は[maximumBytesBilled](https://docs.cloud.google.com/bigquery/docs/best-practices-costs)で制限し、料金自体は[公式料金](https://cloud.google.com/bigquery/pricing)とBilling明細で確認する。expiry変更・table削除・export停止はこの実装に含めない。

## 棚卸し（2026-11-27）

直近の日次収集（2026-11-27 02:19 JST）のdry run推定：GA4 33.2MB、ga4_experience 31.3MB、ga4_entry 37.3MB、GSC site 0.4MB、GSC URL 3.0MB、GA4 availability 10.5MB（メタデータ読取の最小課金）、期間人数 **234.0MB**。合計約350MB/日、月約10.5GB。BigQueryのクエリ無料枠（月1TB）の約1%で、クエリ料金は発生していない見込み。月約700円の原因は依然として請求明細（SKU別）でしか確定できない。ローカルのgcloudはPython 3.9で起動しないため、今回もJOBS_BY_PROJECTは読めていない。

削減したもの：

- 期間人数から90日・前90日のウィンドウを外した（毎日186日分を読んでいた）。最も古い読取は前々月の初日（約60〜90日）になり、この1本の読取量は概ね半分。90日の人数が必要なときは「期間人数を集計」で取得する。
- 収集前の dry run ステップを削除。各ジョブの実際の処理・課金バイト数をログに出す。
- AdSense・週次/月次レポートの別workflow（毎日・毎週それぞれ install と build）を日次収集ジョブの後続ステップに統合。順序の入れ替わりもなくなった。
- 直近の未公開日を毎回 `ANALYTICS_INCOMPLETE_EXPORT` にしていた誤警報を止めた（取得状況の画面とMCPの `statuses` で本当の欠けが見えるようにするため）。

変えていないもの：GA4のエクスポート設定・テーブルの保存期間・D1の日次ペイロード（GA4は1日約190KB。管理画面・MCPは必要な粒度だけSQLiteで取り出しているため、Workerが全量を解析することはない）。
