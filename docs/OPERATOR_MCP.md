# ローカル操作用 MCP（operator）

ChatGPT（Codex）や Claude などの AI クライアントから、記事・シリーズ・タグを操作するための **ローカル専用** MCP サーバーです。

- 起動したクライアントと標準入出力（stdio）だけで通信します。**ポートを開かず、どこにもデプロイしません。**
- 操作は既存の管理API `/v1/admin/*` を管理トークンで呼ぶだけです。入力検証・slug 重複チェック・公開条件はすべて API 側と同じです。
- 既定は **読み取り専用**。`TOMOKICHI_OPERATOR_WRITE=1` を渡したときだけ作成・保存ができます。
- 削除ツールはありません。公開（`publish_article`）は同じ記事IDを `confirmArticleId` に再入力したときだけ実行します。
- 管理トークンは平文 HTTP では送りません（`https` か `localhost` のみ）。

## ツール

| 種類                                        | ツール                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 読み取り                                    | `list_articles` `get_article` `check_publishable` `publication_status` `list_taxonomy` `list_series` `search_media`                      |
| 書き込み（要 `TOMOKICHI_OPERATOR_WRITE=1`） | `create_article_draft` `save_article_draft` `set_article_series_and_tags` `create_series` `update_series` `create_tag` `publish_article` |

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

書き込みを使うときだけ `TOMOKICHI_OPERATOR_WRITE=1` を追加します。ChatGPT のブラウザ版はリモートの HTTPS MCP しか使えないため対象外です（このサーバーを公開トンネルで外に出さないでください）。
