# 認証・非公開データ

2026-10-13: 利用者の承認を受け、専用サービスアカウント、WIF pool/provider、IAM、GitHub analytics environmentと接続Variablesを設定済み。Google長期鍵は作成していない。Cloudflare/GitHub再集計用のSecretsと本番実行検証は未完了。以下は設定内容と再設定時の手順。既存GA4/GSC export連携・service accountは変更していない。

## GitHub OIDC → Google WIF

監査時project numberは675943631290、repository idは1351112792、owner idは177634677。branch main、environment analytics、schedule/workflow_dispatchだけ信頼する。人名/repository名だけでなく再利用できない数値IDで制限。[Google公式設定](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)を参照。

```bash
analytics_project=tomokichidiary-analytics
analytics_number=675943631290
analytics_sa=diary-analytics@tomokichidiary-analytics.iam.gserviceaccount.com
# 新規の専用principalだけ作る。既存export用principalへ権限を足さない。
gcloud iam service-accounts create diary-analytics --project="$analytics_project"
gcloud iam workload-identity-pools create diary-analytics --project="$analytics_project" --location=global --display-name='Diary Analytics'
gcloud iam workload-identity-pools providers create-oidc github --project="$analytics_project" --location=global --workload-identity-pool=diary-analytics --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref' --attribute-condition="assertion.repository_id == '1351112792' && assertion.repository_owner_id == '177634677' && assertion.repository == 'tomoki013/tomokichi-diary' && assertion.ref == 'refs/heads/main' && assertion.sub == 'repo:tomoki013@177634677/tomokichi-diary@1351112792:environment:analytics' && assertion.event_name in ['schedule', 'workflow_dispatch']"
gcloud iam service-accounts add-iam-policy-binding "$analytics_sa" --project="$analytics_project" --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/$analytics_number/locations/global/workloadIdentityPools/diary-analytics/attribute.repository_id/1351112792"
gcloud projects add-iam-policy-binding "$analytics_project" --role=roles/bigquery.jobUser --member="serviceAccount:$analytics_sa"
```

設定済み: 2datasetのaccess listに専用SAのREADER（Data Viewer相当）を追加。PATCHには取得したetagを付け、既存ACL・location・保持期限・storage設定を保存前後で照合した。Project全体にはjobUserだけ。IAM/iamcredentials/STS APIsは認証のため有効化済み。

再設定時はBigQuery Consoleで **analytics_535794382 と searchconsoleの2datasetそれぞれ** → 共有/権限 → この専用SA → BigQuery Data Viewer (`roles/bigquery.dataViewer`)。project全体のdataViewer/editor/ownerは付与しない。dataset metadata/table読み取りとクエリ実行だけ。テーブル作成・データ更新・billing管理は不要。

GitHubのOIDC設定をread-onlyで確認した結果、use_default=true / use_immutable_subject=true、sub_claim_prefixは `repo:tomoki013@177634677/tomokichi-diary@1351112792` だった。providerは実際のprefixにenvironment:analyticsを付けたsubjectを信頼する。既存のimmutable subject設定をlegacy形式へ戻さない。名前だけのsubjectを使う古い例では認証に失敗する。[GitHub公式OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)を参照。

GitHub Settings → Environments → analytics → deployment branchesをmainのみ許可（設定済み）。reviewerが必要ならここで設定。Secretsはこのenvironmentだけ:

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

## 設定後の確認結果（2026-10-13）

providerはACTIVE、issuer/mapping/conditionを再取得して一致を確認。専用SAのuser-managed key一覧は空。project権限はjobUserのみ、SAには対象repository principalSetのWorkloadIdentityUserのみ。GitHub environmentはmainのbranch policyのみ、3つの接続Variablesを確認。RepositoryのANALYTICS_ENABLED=0を明示設定し、未設定Secretsの状態で定期ジョブを起動しない。

mainに承認済みworkflowが入った後、実際のGitHub OIDC → SA → BigQuery dry runを確認する。現在PR #81はDraftで、設定の読み直しは完了したが、GitHubからの実トークン認証はまだ検証していない。認証用に人間へ追加のToken Creator権限を付けたり、SA鍵を作ったりしていない。
