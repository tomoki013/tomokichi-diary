# 管理用 MCP（operator）

ChatGPT や Claude などの AI クライアントから、管理画面でできることを操作するための MCP です。スマホの ChatGPT からも使えるリモート接続と、手元で起動するローカル stdio 接続があります。どちらも同じツールです。

- **管理画面と同じ操作を使います。** ツールは操作カタログ（`packages/contracts/src/operations`）から自動で並び、`POST /v1/admin/ops/<名前>` を呼びます。入力検証・公開条件・操作ログは管理画面と同じ所で行います（ADR 0011）。
- **出さないもの**：削除、問い合わせ（読むことも不可）、旅の事実の確認、MCP 接続の失効。これ以外を管理画面専用にするとテストが落ちます。
- **権限は2段階**：読み取りツールは常に、書き込みツールは書き込みを許可した接続だけに出ます。API も同じ判定で拒否します。
- **取り消しにくい操作には確認の入力が要ります**：`publish_article` は `confirmArticleId` に同じ ID、`publish_diary_note` と `publish_site` は `confirm: "publish"`、取り下げは `confirm: "unpublish"`、アーカイブは `confirm: "archive"`。

## ツール

既存のツール名は変えていません。主なもの（全部は接続したクライアントのツール一覧で見られます）:

| 領域     | 読み取り                                                                                                                    | 書き込み                                                                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 記事     | `list_articles` `get_article` `check_publishable` `audit_article_bodies`                                                    | `create_article_draft` `save_article_draft` `publish_article` `unpublish_article` `archive_article` `schedule_article` `set_article_series_and_tags` `set_article_experience_tags` `set_article_media` |
| 日記     | `list_diary_notes` `get_diary_note` `check_diary_note_publishable`                                                          | `create_diary_note_draft` `save_diary_note_draft` `publish_diary_note` `unpublish_diary_note` `set_diary_note_date` `set_diary_note_related_articles`                                                  |
| まとめ   | `list_series` `get_series` `list_taxonomy` `list_locations` `list_places` `list_rankings` `get_ranking` `list_search_words` | `create_series` `update_series` `create_tag` `create_ranking` `update_ranking` `save_search_words`                                                                                                     |
| 写真     | `search_media` `get_media_hash_status` `find_media_by_hash`                                                                 | `upload_media`（Base64、20MB まで） `update_media`                                                                                                                                                     |
| 収益化   | `get_monetization` `get_article_ads` `check_article_ads`                                                                    | `set_ad_layout` `move_body_ad` `start_ad_test` `control_ad_experiment` `save_article_ads` `save_ad_experiment` `save_monetization_settings` `create_affiliate_offer` `update_affiliate_offer`          |
| 旅の知識 | `get_article_knowledge` `list_articles_without_knowledge` `list_pending_facts`                                              | `propose_travel_facts` `save_article_knowledge`（どちらも候補として入る）                                                                                                                              |
| 運営     | `get_home` `publication_status` `get_like_activity` `list_activity` `list_mcp_connections`                                  | `publish_site` `label_mcp_client` `recollect_analytics`                                                                                                                                                |

下書きの保存、分類や広告の変更は公開サイトを変えません。公開中の記事は `publish_article`（変更を公開）で、ランキングとシリーズは `publish_site` で反映されます。記事はランキングでは ID でも slug でも指定できます。

旅の知識は、AI が本文を読んで `propose_travel_facts` で事実の候補を登録し、本人が管理画面で確認する流れです。確認は MCP からはできません。

## 環境変数

| 変数                             | 内容                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `TOMOKICHI_ADMIN_TOKEN`          | 必須。API の secret `ADMIN_TOKEN` と同じ値。**リポジトリ内のファイルに書かない**                            |
| `TOMOKICHI_LOCAL_OPERATOR_TOKEN` | 推奨。本番 API の専用 secret `LOCAL_OPERATOR_TOKEN` と同じ値。操作履歴でローカルOperatorを識別する          |
| `TOMOKICHI_API_URL`              | 既定 `http://localhost:8787`（`pnpm --filter @tomokichi/api dev`）。本番は `https://api.tomokichidiary.com` |
| `TOMOKICHI_OPERATOR_WRITE`       | `1` で書き込みツールを出す。未設定なら読み取りのみ                                                          |

本番 API を相手にする場合、API Worker に `ADMIN_TOKEN` が設定されている必要があります（Cloudflare Access だけにしている場合はトークンが使えません）。

## クライアント設定例

Codex（`~/.codex/config.toml`）:

```toml
[mcp_servers.tomokichi-diary]
command = "pnpm"
args = ["--silent", "--dir", "/Users/tomokichi/dev/projects/tomokichi-diary", "operator:mcp"]
env = { TOMOKICHI_API_URL = "https://api.tomokichidiary.com", TOMOKICHI_ADMIN_TOKEN = "（トークン）" }
```

Claude Code:

```bash
claude mcp add tomokichi-diary --env TOMOKICHI_API_URL=https://api.tomokichidiary.com --env TOMOKICHI_ADMIN_TOKEN=（トークン） -- pnpm --silent --dir /Users/tomokichi/dev/projects/tomokichi-diary operator:mcp
```

書き込みを使うときだけ `TOMOKICHI_OPERATOR_WRITE=1` を追加します。このローカルサーバーを公開トンネルで外に出さないでください。ChatGPT（ブラウザ・スマホアプリ）からは次のリモート接続を使います。

## ChatGPT（スマホ含む）からのリモート接続

同じツールを MCP Worker の `/operator/mcp` でも提供します。仕組みは分析用 `/analytics/mcp`（[analytics/CHATGPT.md](analytics/CHATGPT.md)）と同じで、本人だけが OAuth で接続できます。

- Server URL: `https://mcp.tomokichidiary.com/operator/mcp`
- 認証: OAuth（DCR・PKCE S256）。新 issuer は `https://mcp.tomokichidiary.com/operator`。新旧Issuerのclient・grant・tokenは共有KVの `operator-v2:` / `operator:` に分離し、相互利用できません。
- 許可できるのは MCP Worker secret `OPERATOR_OWNER_SUBJECT`（本人の検証済み Cloudflare Access subject）と一致する人だけ。許可画面は `https://mcp.tomokichidiary.com/operator-connect` で、専用Cloudflare AccessアプリのJWTを別Audienceで検証します。
- スコープ: `operator:read`（読み取りツールのみ表示）と `operator:write`（書き込みツールも表示）。どちらにするかは許可画面のボタンで本人が選びます。
- **共有の `ADMIN_TOKEN` は MCP Worker に置きません。** ツールは API Worker の名前付き入口 `AdminOperator` を Service Binding（`OPERATOR_API`）で呼びます。この入口には公開URLがなく、`caller` が MCP Worker の場合だけ操作の入口（`/v1/admin/ops/*`）へ到達できます。どの操作を実行できるかは、接続の種類（管理か分析か）と書き込み権限から API が判定します。D1にはOAuth主体、ハッシュ化したclient_id、自己申告名、MCPツール名、操作名を記録します。
- アクセストークンは1時間、接続（refresh）は最大30日。期限が切れたら ChatGPT から再接続します。

移行期間中は旧URL `https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/operator/mcp` も稼働します。旧IssuerのGrantは旧URLにだけ有効で、新URLではOAuthを再認可してください。旧Workerの許可画面 `https://admin.tomokichidiary.com/operator-connect` は既存接続のために残します。

### 接続手順

1. ChatGPT Web（PC かスマホのブラウザ）の Plugins → 追加 → カスタムMCPサーバーで、個人用として作成・インストールします（分析用と同じ手順）。名前は「Tomokichi Diary Operator（非公開）」、URL は上の Server URL、認証は OAuth。
2. MCP許可画面のCloudflare Accessログインが出たら本人でログインし、許可画面でclient IDと戻り先を確認して「読み取りのみ許可」か「読み書きを許可」を押します。
3. スマホの ChatGPT アプリは同じアカウントでログインしていれば、チャットの「+」→ 接続から同じ接続を選んで使えます（接続の作成と OAuth 許可は Web 側で行います）。
4. Museなど他のクライアントは最初に読み取り専用で接続し、必要な場合に限り別Grantで書き込みを承認します。書き込みを後から足す・外すときは、対象クライアントで接続し直して許可画面で選び直します。

### Cloudflare 設定と移行

既存の本番APIとMCP Workerを起点に、[通常の本番CI](OPERATIONS.md#releasing)のデプロイジョブで反映します。

1. 既存のMCP・API・管理画面Workerの稼働バージョンIDを控えます。マージ前に、Cloudflare Zero Trustに本人だけを許可するSelf-hosted Accessアプリを作り、`mcp.tomokichidiary.com/analytics-connect` と `mcp.tomokichidiary.com/operator-connect` を登録します。MCP・OAuthの登録／トークン・Discoveryの各経路はAccessアプリの対象外です。アプリのAudience TagをGitHub Actionsの`production`環境変数 `MCP_CONSENT_ACCESS_AUD` に登録します。
2. 本番CIがD1に `0027_operator_audit_events.sql` を適用します。MCPのツール実行と管理APIの更新は、先にこのテーブルへ監査行を記録します。
3. Custom Domainが未登録の初回に限り、CIが `MCP_CONSENT_BOOTSTRAP=1` でMCP Workerを反映します。この段階では既存のworkers.devホストを使い、新しい `OperatorConnections` 入口をService Bindingから参照できるようにします。CIが旧URLの公開MCPも検証します。切り戻しに備えて、このデプロイのバージョンIDも控えます。
4. CIが専用Audienceを渡してAPIを反映し、`McpConsentIdentity` を追加します。通常のMCPデプロイで専用本人確認用のService Bindingと新Custom Domainが有効になります。CIが管理画面を反映して新旧ホストの公開MCPを検証し、新ホストではDiscovery・匿名リクエストの401・専用Accessアプリへの遷移も確認します。手動で同じ検証をする場合は `MCP_CONSENT_ACCESS_AUD` を渡し、`pnpm verify:mcp https://mcp.tomokichidiary.com --private-access` を実行します。
5. Museは読み取り専用で始め、ChatGPTのOperatorとAnalyticsは新URLで再認可します。両クライアントの識別と操作履歴を確認し、週次・月次分析タスクが新URLでツールを呼び出すことを確認します。

切替前に以下の結果を記録します。OAuthトークンやAccess JWTは検証記録に含めません。

| 対象       | 本番で確認する結果                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Muse       | 読み取り専用の新規接続でOperatorの読み取りが成功し、書き込みツールが利用できない                                                              |
| ChatGPT    | 新URLのAnalyticsで週次・月次レポートを取得でき、Operatorで承認したscopeのツールが使える                                                       |
| 監査       | 所有者が許可した検証用下書きの作成・保存が履歴に表示される。MCPツールとAPIイベントのrequest IDが一致し、接続一覧で確認したclient IDに対応する |
| 定期タスク | 週次・月次の実行履歴に、新URLへ移した接続でのツール呼び出しが残る                                                                             |
| 既存機能   | 旧URLの公開MCPと既存Grant、公開サイトの検索・画像、管理画面、ローカルstdio Operatorを使える                                                   |

新接続だけに問題がある場合は旧URLに戻します。旧トークンは旧Issuerのリソースで使えます。

Workerも移行前へ戻す場合は、管理画面、MCPの初回先行バージョン、移行前のAPI、移行前のMCPの順で戻します。先行バージョンに戻すとAPIの新しい `McpConsentIdentity` への参照が外れ、移行前のAPIに戻すとMCPの新しい `OperatorConnections` への参照が外れます。D1の監査テーブルと新旧のOAuth KVは残し、旧接続の読み取りを確認します。Workerのバージョンを戻した後、新ドメインのルートとAccess設定も別途確認します。[Cloudflare Workersの切り戻し](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

この実装ではclient名やUser-AgentからChatGPT/Museを推測しません。接続一覧の「自己申告名」は初期値にすぎません。管理画面「その他 → MCP 接続」でclient_idハッシュとリダイレクト先を確認した後、表示名を確認済みにできます。「操作ログ」では操作履歴を検索でき、記事編集画面から記事単位の履歴を開けます。

### 緊急停止

| 目的                                 | 方法                                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| すぐに全部止める（既存トークン含む） | `pnpm exec wrangler secret delete OPERATOR_OWNER_SUBJECT --name tomokichi-diary-mcp`。許可画面もツール呼び出しも 403 になります。分析用 MCP には影響しません。        |
| 発行済みの接続を消す                 | 管理画面の「MCP接続」でGrantを失効します。緊急時は旧接続を含め `OPERATOR_OWNER_SUBJECT` を削除します。KV手動削除では旧 `operator:` と新 `operator-v2:` を区別します。 |
| API 側の入口も閉じる                 | MCP Worker の `OPERATOR_API` バインドを外してデプロイすると `/operator/mcp` は 503 になります。                                                                       |

再開するときは `OPERATOR_OWNER_SUBJECT` を設定し直し、ChatGPT から再接続します。共有トークンを使っていないので、トークンのローテーションは不要です。

個別失効ではGrantと発行済みトークンをOAuthストアから削除します。すでに読み込まれたKVの値が各拠点で期限切れになるまで、失効の反映に時間がかかる場合があります。[Cloudflare Workers KVの整合性](https://developers.cloudflare.com/kv/concepts/how-kv-works/#consistency)

ローカルstdio Operatorを履歴上で識別するには、API Workerに `LOCAL_OPERATOR_TOKEN` を設定し、クライアント環境に `TOMOKICHI_LOCAL_OPERATOR_TOKEN` を渡します。これは操作の入口だけに通る専用bearer secretで、通常の `ADMIN_TOKEN` と異なる値にしてください。省略時も従来どおり `TOMOKICHI_ADMIN_TOKEN` で動作しますが、その場合は通常の管理APIトークンとして扱われ、Actorは `admin-token` になります。
