# ローカル操作用 MCP（operator）

ChatGPT（Codex）や Claude などの AI クライアントから、旅行記事・一言日記・シリーズ・タグを操作するための Operator MCP です。ローカル stdio 接続と ChatGPT 向けリモート接続の両方があります。

- 起動したクライアントと標準入出力（stdio）だけで通信します。**ポートを開かず、どこにもデプロイしません。**
- 操作は既存の管理API `/v1/admin/*` を管理トークンで呼ぶだけです。入力検証・slug 重複チェック・公開条件はすべて API 側と同じです。
- 既定は **読み取り専用**。`TOMOKICHI_OPERATOR_WRITE=1` を渡したときだけ作成・保存ができます。
- 削除ツールはありません。公開（`publish_article`）は同じ記事IDを `confirmArticleId` に再入力したときだけ実行します。
- 管理トークンは平文 HTTP では送りません（`https` か `localhost` のみ）。

## ツール

| 種類                                        | ツール                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 読み取り                                    | `list_articles` `get_article` `check_publishable` `audit_article_bodies` `list_diary_notes` `get_diary_note` `check_diary_note_publishable` `publication_status` `list_taxonomy` `list_series` `list_rankings` `search_media`                                                               |
| 書き込み（要 `TOMOKICHI_OPERATOR_WRITE=1`） | `create_article_draft` `save_article_draft` `create_diary_note_draft` `save_diary_note_draft` `set_diary_note_related_articles` `create_series` `update_series` `create_tag` `create_ranking` `update_ranking` `publish_article` `publish_diary_note` `unpublish_diary_note` `publish_site` |

下書きの保存やシリーズ・タグの付け替えは公開サイトを変えません。公開中の記事は「変更を公開」（`publish_article`）で反映されます。

一言日記は `list_diary_notes` / `get_diary_note` で旅行記事から分けて取得します。`create_diary_note_draft` と `save_diary_note_draft` はD1に下書きを保存します。公開前に `check_diary_note_publishable` を実行し、利用者が明示的に公開を頼んだ場合だけ `publish_diary_note` に `confirm: "publish"` を渡します。取り下げも明示指示と `confirm: "unpublish"` が必要です。関連記事の変更も日記を再公開するまで公開版に反映されません。

ランキング（トップページの「ともきち的ランキング」）は `update_ranking` で順位・一言を保存し、`publish_site`（`confirm: "publish"` が必要）でサイト全体を再生成して反映します。記事は ID でも slug でも指定できます。サイトポリシー（/legal/ の固定ページ）は記事と同じツールで編集・公開します。

## 環境変数

| 変数                             | 内容                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `TOMOKICHI_ADMIN_TOKEN`          | 必須。API の secret `ADMIN_TOKEN` と同じ値。**リポジトリ内のファイルに書かない**                            |
| `TOMOKICHI_LOCAL_OPERATOR_TOKEN` | 推奨。本番 API の専用 secret `LOCAL_OPERATOR_TOKEN` と同じ値。操作履歴でローカルOperatorを識別する          |
| `TOMOKICHI_API_URL`              | 既定 `http://localhost:8787`（`pnpm --filter @tomokichi/api dev`）。本番は `https://api.tomokichidiary.com` |
| `TOMOKICHI_OPERATOR_WRITE`       | `1` で書き込みを許可。未設定なら読み取りのみ                                                                |

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

同じツール（`createOperatorServer`）を MCP Worker の `/operator/mcp` でも提供します。仕組みは分析用 `/analytics/mcp`（[analytics/CHATGPT.md](analytics/CHATGPT.md)）と同じで、本人だけが OAuth で接続できます。

- Server URL: `https://mcp.tomokichidiary.com/operator/mcp`
- 認証: OAuth（DCR・PKCE S256）。新 issuer は `https://mcp.tomokichidiary.com/operator`。新旧Issuerのclient・grant・tokenは共有KVの `operator-v2:` / `operator:` に分離し、相互利用できません。
- 許可できるのは MCP Worker secret `OPERATOR_OWNER_SUBJECT`（本人の検証済み Cloudflare Access subject）と一致する人だけ。許可画面は `https://mcp.tomokichidiary.com/operator-connect` で、専用Cloudflare AccessアプリのJWTを別Audienceで検証します。
- スコープ: `operator:read`（読み取りツールのみ表示）と `operator:write`（書き込みツールも表示）。どちらにするかは許可画面のボタンで本人が選びます。
- 削除ツールはありません。公開は `publish_article` の `confirmArticleId`、一言日記は `publish_diary_note` の `confirm: "publish"`、サイト全体は `publish_site` の `confirm: "publish"` が必要です。取り下げには一言日記専用の `unpublish_diary_note` が必要です。
- **共有の `ADMIN_TOKEN` は MCP Worker に置きません。** ツールは API Worker の名前付き入口 `AdminOperator` を Service Binding（`OPERATOR_API`）で呼びます。この入口には公開URLがなく、`caller` が MCP Worker の場合だけOperator用に許可したAPIルートへ到達できます。読み取りGrantはGETだけ、書き込みGrantも許可済みルートのみで、`DELETE` は拒否します。D1にはOAuth主体、ハッシュ化したclient_id、自己申告名、MCPツール名、API更新を同じrequest_idで記録します。
- アクセストークンは1時間、接続（refresh）は最大30日。期限が切れたら ChatGPT から再接続します。

移行期間中は旧URL `https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/operator/mcp` も稼働します。旧IssuerのGrantは旧URLにだけ有効で、新URLではOAuthを再認可してください。旧Workerの許可画面 `https://admin.tomokichidiary.com/operator-connect` は既存接続のために残します。

### 接続手順

1. ChatGPT Web（PC かスマホのブラウザ）の Plugins → 追加 → カスタムMCPサーバーで、個人用として作成・インストールします（分析用と同じ手順）。名前は「Tomokichi Diary Operator（非公開）」、URL は上の Server URL、認証は OAuth。
2. MCP許可画面のCloudflare Accessログインが出たら本人でログインし、許可画面でclient IDと戻り先を確認して「読み取りのみ許可」か「読み書きを許可」を押します。
3. スマホの ChatGPT アプリは同じアカウントでログインしていれば、チャットの「+」→ 接続から同じ接続を選んで使えます（接続の作成と OAuth 許可は Web 側で行います）。
4. Museなど他のクライアントは最初に読み取り専用で接続し、必要な場合に限り別Grantで書き込みを承認します。書き込みを後から足す・外すときは、対象クライアントで接続し直して許可画面で選び直します。

### Cloudflare 設定と移行

既存の本番APIとMCP Workerを起点に、[通常の本番CI](OPERATIONS.md#releasing)のデプロイジョブで反映します。

1. マージ前に、Cloudflare Zero Trustに本人だけを許可するSelf-hosted Accessアプリを作り、`mcp.tomokichidiary.com/analytics-connect` と `mcp.tomokichidiary.com/operator-connect` を登録します。MCP・OAuthの登録／トークン・Discoveryの各経路はAccessアプリの対象外です。アプリのAudience TagをGitHub Actionsの`production`環境変数 `MCP_CONSENT_ACCESS_AUD` に登録します。
2. 本番CIがD1に `0025_operator_audit_events.sql` を適用します。MCPのツール実行と管理APIの更新は、先にこのテーブルへ監査行を記録します。
3. Custom Domainが未登録の初回に限り、CIが `MCP_CONSENT_BOOTSTRAP=1` でMCP Workerを反映します。この段階では既存のworkers.devホストを使い、新しい `OperatorConnections` 入口をService Bindingから参照できるようにします。CIが旧URLの公開MCPも検証します。
4. CIが専用Audienceを渡してAPIを反映し、`McpConsentIdentity` を追加します。通常のMCPデプロイで専用本人確認用のService Bindingと新Custom Domainが有効になります。CIが管理画面を反映し、新旧ホストの公開MCPを検証します。
5. 新旧それぞれで公開MCPを検証します。新ホストでDiscoveryが認証なしで取得でき、私用MCPはOAuthなしでは401、許可画面はAccessログインへ遷移することを確かめます。Museは読み取り専用で始め、ChatGPTのOperatorとAnalyticsは新URLで再認可します。両クライアントの識別と操作履歴を確認し、週次・月次分析タスクが新URLでツールを呼び出すことを確認します。

検証中の切り戻しは旧URLへの再接続で行います。旧トークンは旧Issuerのリソースで使えます。Worker自体を以前のバージョンへ戻す場合、先に新しいService Bindingの呼び出し元を戻してから参照先を戻します。初回用の `MCP_CONSENT_BOOTSTRAP` は新ドメインを追加する前に使う設定です。

この実装ではclient名やUser-AgentからChatGPT/Museを推測しません。接続一覧の「自己申告名」は初期値にすぎません。管理画面 `/mcp-connections` でclient_idハッシュとリダイレクト先を確認した後、表示名を確認済みにできます。管理画面 `/activity` では操作履歴を検索でき、記事編集画面から記事単位の履歴を開けます。

### 緊急停止

| 目的                                 | 方法                                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| すぐに全部止める（既存トークン含む） | `pnpm exec wrangler secret delete OPERATOR_OWNER_SUBJECT --name tomokichi-diary-mcp`。許可画面もツール呼び出しも 403 になります。分析用 MCP には影響しません。        |
| 発行済みの接続を消す                 | 管理画面の「MCP接続」でGrantを失効します。緊急時は旧接続を含め `OPERATOR_OWNER_SUBJECT` を削除します。KV手動削除では旧 `operator:` と新 `operator-v2:` を区別します。 |
| API 側の入口も閉じる                 | MCP Worker の `OPERATOR_API` バインドを外してデプロイすると `/operator/mcp` は 503 になります。                                                                       |

再開するときは `OPERATOR_OWNER_SUBJECT` を設定し直し、ChatGPT から再接続します。共有トークンを使っていないので、トークンのローテーションは不要です。

ローカルstdio Operatorを履歴上で識別するには、API Workerに `LOCAL_OPERATOR_TOKEN` を設定し、クライアント環境に `TOMOKICHI_LOCAL_OPERATOR_TOKEN` を渡します。これはOperator用の読み書き許可ルートだけに通る専用bearer secretで、通常の `ADMIN_TOKEN` と異なる値にしてください。省略時も従来どおり `TOMOKICHI_ADMIN_TOKEN` で動作しますが、その場合は通常の管理APIトークンとして扱われ、Actorは `admin-token` になります。
