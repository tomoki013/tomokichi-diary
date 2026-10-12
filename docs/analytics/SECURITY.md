# 認証・非公開データ

Google IAMやGitHub environmentの設定は未変更。以下は管理者がレビューして実施する初回手順。既存GA4/GSC export連携・service accountは変更しない。

## GitHub OIDC → Google WIF

監査時project numberは675943631290、repository idは1351112792、owner idは177634677。branch main、environment analytics、schedule/workflow_dispatchだけ信頼する。人名/repository名だけでなく再利用できない数値IDで制限。[Google公式設定](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)を参照。

```bash
analytics_project=tomokichidiary-analytics
analytics_number=675943631290
analytics_sa=diary-analytics@tomokichidiary-analytics.iam.gserviceaccount.com
# 新規の専用principalだけ作る。既存export用principalへ権限を足さない。
gcloud iam service-accounts create diary-analytics --project="$analytics_project"
gcloud iam workload-identity-pools create diary-analytics --project="$analytics_project" --location=global --display-name='Diary Analytics'
gcloud iam workload-identity-pools providers create-oidc github --project="$analytics_project" --location=global --workload-identity-pool=diary-analytics --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref' --attribute-condition="assertion.repository_id == '1351112792' && assertion.repository_owner_id == '177634677' && assertion.repository == 'tomoki013/tomokichi-diary' && assertion.ref == 'refs/heads/main' && assertion.sub == 'repo:tomoki013/tomokichi-diary:environment:analytics' && assertion.event_name in ['schedule', 'workflow_dispatch']"
gcloud iam service-accounts add-iam-policy-binding "$analytics_sa" --project="$analytics_project" --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/$analytics_number/locations/global/workloadIdentityPools/diary-analytics/attribute.repository_id/1351112792"
gcloud projects add-iam-policy-binding "$analytics_project" --role=roles/bigquery.jobUser --member="serviceAccount:$analytics_sa"
```

BigQuery Consoleで **analytics_535794382 と searchconsoleの2datasetそれぞれ** → 共有/権限 → この専用SA → BigQuery Data Viewer (`roles/bigquery.dataViewer`)。project全体のdataViewer/editor/ownerは付与しない。dataset metadata/table読み取りとクエリ実行だけ。テーブル作成・データ更新・billing管理は不要。

GitHub Settings → Environments → analytics → deployment branchesをmainのみ許可。reviewerが必要ならここで設定。Secretsはこのenvironmentだけ:

- ANALYTICS_CLOUDFLARE_API_TOKEN: D1編集のみ、対象Cloudflare accountへ制限。現在のtoken modelでdatabase単位の制限ができない場合は、その残存権限を管理者が確認する。デプロイ/DNS/R2権限を追加しない。
- CLOUDFLARE_ACCOUNT_ID: Tomokichi Diaryのaccount。

Environment Variables:

- ANALYTICS_WIF_PROVIDER = projects/675943631290/locations/global/workloadIdentityPools/diary-analytics/providers/github
- ANALYTICS_SERVICE_ACCOUNT = diary-analytics@tomokichidiary-analytics.iam.gserviceaccount.com
- ANALYTICS_GSC_PROPERTY = https://tomokichidiary.com/

**Repository Variable** ANALYTICS_ENABLEDを設定する前にmigration/API/adminを配信・dry runを確認する。`1`で定期処理を有効化。job-level ifなのでenvironment variableにだけ置かない。PR/forkにはid-tokenとSecretsのjobを与えない。Google長期JSON鍵をコピー/作成しない。

## API・保存

APIは既存 `/v1/admin/*` ミドルウェア（Access JWTまたは既存ADMIN_TOKEN）の下。public経路・MCPに分析はない。private/no-store、noindex/no-follow。D1への保存はCloudflare REST経由で別の収集用token。バインド先DB IDは既存Diary DBに固定し、CHAGEE環境変数から切り替わらない。

管理画面からの再集計には別fine-grained GitHub token（このrepositoryのActions writeのみ）をAPI Workerへ `ANALYTICS_GITHUB_TOKEN` secretで設定する。既存GITHUB_PUBLISH_TOKENを流用しない。ブラウザにはtokenを送らない。mainだけdispatchでき、日付は検証済み値だけをJSON送信する。

SQLのdate/propertyはBQ named parameters、D1はbind parameters。日付・期間制限、result行数、日別payloadサイズ、duplicate key、有限数値を検証する。クエリjob idは再試行でも固定して二重BQ jobを防止。401/403は再試行しない。生のupstream error/body/収益/検索語をActionsログへ出さない。privateデータをupload-artifactしない。

## AdSense・AI

AdSense APIを有効にし、accountを管理するユーザーのOAuth consentで **adsense.readonly** scopeを許可する。WIFだけではAdSense publisherへのuser OAuth認可にならない。refresh token/client secretはanalytics environment Secretsへ手動設定し、APIキーやJSON SA鍵で代用しない。ADSENSE_ACCOUNTはaccounts/pub-…、SecretsはADSENSE_CLIENT_ID / ADSENSE_CLIENT_SECRET / ADSENSE_REFRESH_TOKEN。repository variable ADSENSE_ENABLED=1はaccountの読取検証後に設定する。サイトdomain filterで他サイト収益を混ぜない。

AI provider/keyは設定しない。外部への個人情報・生検索語送信、自動記事変更・広告増設・リンク変更能力は実装しない。将来の導入は集計検証後、事実/推測/提案を分離し人間が確認する。Discord連携なし。
