# ローカル操作用 MCP（operator）

ChatGPT（Codex）や Claude などの AI クライアントから、記事・シリーズ・タグを操作するための **ローカル専用** MCP サーバーです。同じツールを ChatGPT（スマホ含む）から使うリモート接続は[後半](#chatgptスマホ含むからのリモート接続)を参照してください。

- 起動したクライアントと標準入出力（stdio）だけで通信します。**ポートを開かず、どこにもデプロイしません。**
- 操作は既存の管理API `/v1/admin/*` を管理トークンで呼ぶだけです。入力検証・slug 重複チェック・公開条件はすべて API 側と同じです。
- 既定は **読み取り専用**。`TOMOKICHI_OPERATOR_WRITE=1` を渡したときだけ作成・保存ができます。
- 削除ツールはありません。公開（`publish_article`）は同じ記事IDを `confirmArticleId` に再入力したときだけ実行します。
- 管理トークンは平文 HTTP では送りません（`https` か `localhost` のみ）。

## ツール

| 種類                                        | ツール                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 読み取り                                    | `list_articles` `get_article` `check_publishable` `audit_article_bodies` `publication_status` `list_taxonomy` `list_series` `search_media` |
| 書き込み（要 `TOMOKICHI_OPERATOR_WRITE=1`） | `create_article_draft` `save_article_draft` `set_article_series_and_tags` `create_series` `update_series` `create_tag` `publish_article`   |

下書きの保存やシリーズ・タグの付け替えは公開サイトを変えません。公開中の記事は「変更を公開」（`publish_article`）で反映されます。

## 環境変数

| 変数                       | 内容                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `TOMOKICHI_ADMIN_TOKEN`    | 必須。API の secret `ADMIN_TOKEN` と同じ値。**リポジトリ内のファイルに書かない**                            |
| `TOMOKICHI_API_URL`        | 既定 `http://localhost:8787`（`pnpm --filter @tomokichi/api dev`）。本番は `https://api.tomokichidiary.com` |
| `TOMOKICHI_OPERATOR_WRITE` | `1` で書き込みを許可。未設定なら読み取りのみ                                                                |

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

- Server URL: `https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/operator/mcp`
- 認証: OAuth（DCR・PKCE S256）。分析とは別の issuer `…/operator` で、client・grant・token は共有 KV 内の `operator:` 接頭辞に分けて保存し、互いのトークンは使えません。
- 許可できるのは MCP Worker secret `OPERATOR_OWNER_SUBJECT`（本人の検証済み Cloudflare Access subject）と一致する人だけ。許可画面は `https://admin.tomokichidiary.com/operator-connect`（Access の内側）にだけ出ます。
- スコープ: `operator:read`（読み取りツールのみ表示）と `operator:write`（書き込みツールも表示）。どちらにするかは許可画面のボタンで本人が選びます。
- 削除ツールはありません。公開は従来どおり `publish_article` の `confirmArticleId`（`publish_site` が入れば `confirm: "publish"`）が必要です。
- **共有の `ADMIN_TOKEN` は MCP Worker に置きません。** ツールは API Worker の名前付き入口 `AdminOperator` を Service Binding（`OPERATOR_API`）で呼びます。この入口には公開URLがなく、`caller` が MCP Worker のときだけ `/v1/admin/*` を通し、`DELETE` は拒否します。API のログでは操作者が `operator-mcp` と記録されます。
- アクセストークンは1時間、接続（refresh）は最大30日。期限が切れたら ChatGPT から再接続します。

### 接続手順

1. ChatGPT Web（PC かスマホのブラウザ）の Plugins → 追加 → カスタムMCPサーバーで、個人用として作成・インストールします（分析用と同じ手順）。名前は「Tomokichi Diary Operator（非公開）」、URL は上の Server URL、認証は OAuth。
2. 管理画面の Cloudflare Access ログインが出たら本人でログインし、許可画面で戻り先（`chatgpt.com`）を確認して「読み取りのみ許可」か「読み書きを許可」を押します。
3. スマホの ChatGPT アプリは同じアカウントでログインしていれば、チャットの「+」→ 接続から同じ接続を選んで使えます（接続の作成と OAuth 許可は Web 側で行います）。
4. 書き込みを後から足す・外すときは、ChatGPT で接続し直して許可画面で選び直します（同じクライアントの前回の許可は置き換わります）。

### 緊急停止

| 目的                                 | 方法                                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| すぐに全部止める（既存トークン含む） | `pnpm exec wrangler secret delete OPERATOR_OWNER_SUBJECT --name tomokichi-diary-mcp`。許可画面もツール呼び出しも 403 になります。分析用 MCP には影響しません。       |
| 発行済みの接続を消す                 | ChatGPT 側で接続を削除し、KV（`OAUTH_KV`）の `operator:` で始まるキーを Cloudflare ダッシュボードか `wrangler kv key list --prefix operator:` で確認して削除します。 |
| API 側の入口も閉じる                 | MCP Worker の `OPERATOR_API` バインドを外してデプロイすると `/operator/mcp` は 503 になります。                                                                      |

再開するときは `OPERATOR_OWNER_SUBJECT` を設定し直し、ChatGPT から再接続します。共有トークンを使っていないので、トークンのローテーションは不要です。
