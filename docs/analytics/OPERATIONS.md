# 運用

## 初回設定・本番有効化

1. WIF/IAM/environment/接続Variablesは2026-10-13の利用者承認で設定済み。再設定はSECURITY参照。AdSense/ASP/AIは不要。
2. 既存CI green後、通常のreleaseで0015/0016 migration → API → Adminを配信。既存CI/publish workflowは変更していない。
3. analytics environment Secrets/Variablesは設定済み。APIの任意再集計用secretは別途設定。`ANALYTICS_ENABLED`はまだ無効。
4. ローカルまたは同一WIF contextでdry runし、両dataset、実際のGSC property（https://tomokichidiary.com/）、US locationを確認。
5. repository variable ANALYTICS_ENABLED=1を設定、mainでAnalytics collectを手動起動。D1保存・Admin閲覧・2度目の冪等性・期間比較を検証。
6. 31日以内に区切ってbackfill。GA4/GSCは独立した最古日から取得する。旧JSONをそのまま非公開DBへコピーしない。
7. MIGRATIONのゲートを全部満たしてから旧集計だけの撤去を別途実施。

本番WIF/IAM、GitHub environment、Cloudflare接続Secretsは設定済み。専用Cloudflare tokenのactive状態、Diary DBの識別子/名前、読み取り専用のD1 batch query（SELECT 1）を確認した。main workflowの実トークン認証、D1書込、Admin配信は未実施。ローカル7日分のBQ読取検証と自動テストは実施済み。IAM変更/認証設定/データ削除を独断で実行しない。

## 実行

```bash
# ローカル: 既存gcloud読取認証でdry run（課金クエリ実行・D1書込なし）
pnpm exec tsx scripts/analytics/run.ts --start 2026-10-04 --end 2026-10-10 --dry-run
# 検証: BQから集計を取得し.data/analytics/に保存（Git除外、D1なし）
pnpm exec tsx scripts/analytics/run.ts --start 2026-10-04 --end 2026-10-10
# 設定済み環境だけ: 明示的に非公開D1へ保存
ANALYTICS_ENABLED=1 pnpm exec tsx scripts/analytics/run.ts --start 2026-10-04 --end 2026-10-10 --persist
# BQ SQL方言を合成fixtureだけで実検証（export読取なし）
pnpm exec tsx scripts/analytics/check-sql.ts
# 任意期間の人数だけ読取検証（93日以内、D1なし）
pnpm exec tsx scripts/analytics/run.ts --start 2026-08-01 --end 2026-10-10 --period-only --dry-run
# オフラインの検証
pnpm exec vitest run scripts/analytics packages/application/src/analytics apps/api/src/__tests__/analytics.test.ts infrastructure/database/d1/src/__tests__/analytics.test.ts
```

Actionsは日次15:47 JST予定。GitHubの混雑・公開repoの無活動による停止は起こりうる。source毎のtable/ExportLog readinessを確認し、当日intradayは含めない。7日を毎回置換し、遅延・訂正に対応。1GB/jobの上限を超えると停止（cost planを見直さず上限を無限にしない）。

Admin `#/analytics` で7/28/90日、月間、任意93日以内、前期間比較、記事クリックによる詳細、取得状況を確認。「この期間を再集計」は31日以内でmainの独立workflowを起動。「期間人数を集計」は93日以内の正確なdistinctをanalytics-periods workflowで取得。過去backfillは両dateを指定。片方だけ指定は拒否。再集計を重ねてもsource/day主キーは増えない。APIは最新状態を手動reloadするだけでpollしない。

週次は月曜16:17 JSTに前週月〜日、月次は月初16:37 JSTに前月をD1から読む。sourceのcoverage/provisionalを保持。`GET /v1/admin/analytics/reports`で保存レポートを確認できる。AI provider未設定を明記し、モデルを呼ばない。

AdSenseはrepository variable ADSENSE_ENABLED=1のときだけ別workflowで読取。OAuth不足、空実績、API警告/truncationはsite収集を妨げない。API提供値を無理に0へ補完せず、推定/確定を分離する。AffiliateはASP確定後、.data/analytics/配下の共通モデルJSONを実adapterで生成し、`ANALYTICS_START`/`ANALYTICS_END`を指定して `revenue.ts --affiliate .data/analytics/import.json` で検証。`--persist` は全providerを含む完全日次snapshotに限る。個人情報を含むASP CSVはそのままこのJSONへ入れない。

## 失敗・復旧

| Code                                                                    | 対応                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ANALYTICS_INVALID_RANGE                                                 | 実在するYYYY-MM-DD、両date、取得31日/閲覧93日制限を確認                                     |
| ANALYTICS_UNCONFIGURED                                                  | API再集計用token設定、environment Variablesを確認                                           |
| ANALYTICS_DISPATCH_FAILED                                               | repository限定Actions write権限、main、workflow名を確認                                     |
| ANALYTICS_INVALID_DATA / INVALID_METRIC / DUPLICATE_ROW / DAY_TOO_LARGE | 旧成功値は保持。SQL schemaとgrainを調査。結果をActionsへ貼らない                            |
| ANALYTICS_SOURCE_NOT_READY / INCOMPLETE_EXPORT                          | ExportLog/table existence、source latest dateを確認し後で再実行                             |
| ANALYTICS_NO_GSC_ROWS                                                   | 実プロパティ値の誤設定/データ未発生を確認。0の成功へ変換しない                              |
| ANALYTICS_HTTP_401 / 403                                                | WIFのrepo ID/ref/sub/event、dataset Viewer/jobUser、CF D1 permissionを確認。自動retry対象外 |
| ANALYTICS_QUERY_FAILED / COLLECTION_FAILED                              | dry runでschema・partition・cost上限を調査。BQ job詳細はCloud Consoleで確認                 |
| ANALYTICS_ADSENSE_UNCONFIGURED / REVENUE_FAILED / NO_REVENUE_DATA       | OAuth/readonly scope/account domain、実績の有無を確認。GA4/GSCは独立して継続                |

429/5xx/ネットワーク失敗は最大4回、0.5/1/2秒のbackoff。BQ jobs.insertは同じjobIdで再試行、409時は同じjobを取得。D1 batchはsource単位の置換なので再送可能。sourceの一部失敗でも他sourceを試し、最後にworkflowをfailにする。GitHub標準実行履歴とAdminのattempt/error/successで検知。Discordなし。

停止はrepository variable ANALYTICS_ENABLEDを0へ戻すだけ（exportは継続）。不具合修正→再集計で復旧。0015/0016追加tablesを即dropせず、旧成功日データ・BQ元データを保持。既存公開/CIワークフローを止めない。

## Cloudflare Secretsと更新

2026-10-13に利用者の作成直前の承認を受け、account-owned token `tomokichi-diary-analytics-d1`を作成した。D1 Writeだけ、対象accountのみ、有効期限1年。GitHub Settings → Environments → analyticsのEnvironment Secretsに `ANALYTICS_CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録し、名前/更新日時を読み直した。productionの広いデプロイtokenは流用していない。

CloudflareのD1 tokenはDB単位に制限できず、対象account内のD1全体への残存権限がある。この制約は利用者へ説明し承認済み。収集コードのDB IDはDiaryの既存DBに固定。Workers配信/DNS/R2権限は含めない。CHAGEEや他DBの設定・データは変更していない。

期限前に同じ権限の専用tokenを作成し、analytics environmentのSecretを更新、Diary DBでSELECT 1の接続確認後に旧tokenを失効する。秘密値をチャットや公開Gitへ貼らない。任意再集計ボタンは別途API Worker secret `ANALYTICS_GITHUB_TOKEN` が必要。

main配信と実認証の検証準備が整うまでANALYTICS_ENABLED=0のままにする。旧週次集計・GA4/GSC native exportsは継続。
