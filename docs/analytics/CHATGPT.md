# ChatGPTからの非公開分析

ChatGPTの個人用カスタムMCP接続で集計を読み、チャットまたは定期分析から使う。公開ディレクトリへの申請や共有は不要。既存の公開旅行情報MCP `/mcp` と分析用 `/analytics/mcp` は別のツール集合であり、公開content exportへ分析を混ぜない。

## 接続

- 名前: Tomokichi Diary Analytics（非公開）
- Server URL: `https://mcp.tomokichidiary.com/analytics/mcp`
- 認証: OAuth、DCR、scope `analytics:read`
- ChatGPT WebのPlugins → 追加 → カスタムMCPサーバー。個人用として作成・インストール。
- `https://mcp.tomokichidiary.com/analytics-connect` でCloudflare Accessログイン後、client_id、戻り先ドメイン、読み取り権限、有効期間を確認して許可。APIの共有admin tokenでは許可できない。
- 集計と保存レポートの読み取りだけ。記事・広告設定の変更、再集計起動、問い合わせ・閲覧者ID・認証情報の取得は提供しない。ツールは操作カタログの `analytics` の操作から自動で並び、API の操作の入口を通る（ADR 0011）。API は分析用の接続に分析の読み取り以外を許さない。

接続URL自体は到達可能だが、認証なしのデータ取得は401。OAuthメタデータに数値は含まれない。所有者はMCP Worker secret `ANALYTICS_OWNER_SUBJECT`（検証済みAccess subject）で固定し、欠落時は閉じる。トークンにも同じsubjectとread scopeを要求する。許可画面は新設した専用Accessアプリで保護し、API Workerの `McpConsentIdentity` Service Bindingが専用 `MCP_CONSENT_ACCESS_AUD`、Issuer、署名、有効期限を検証する。既存管理APIの `ACCESS_AUD` は使わない。許可フォームはOrigin確認・一度限りのconsent handle・PKCE S256・resource audienceを使用する。

Issuerは `https://mcp.tomokichidiary.com`、Analytics Resourceは `/analytics/mcp`、KVの接頭辞は `analytics-v2:`。旧workers.devのIssuerと管理画面（admin.tomokichidiary.com）経由の許可画面は2026-11-27に廃止した（workers.devは公開の旅行情報 `/mcp` だけ残る）。accessは1時間、refreshとDCR登録は90日。緊急停止はOwner subject secretを削除すると既存tokenを含めデータ取得・新規許可とも閉じる。管理画面「MCP接続」からGrantを失効できる。収集workflowは独立して継続。

操作履歴はMCPツール呼び出し単位でD1に記録します。client_idはハッシュ化し、client名は初期状態で自己申告として扱います。管理画面「その他 → MCP 接続」でclient_idハッシュとリダイレクト先を確認して表示名を確定できます。

## 復旧

レポートツールが内部エラーになり、Workerログの `/analytics/oauth/token` に `KV put() limit exceeded for the day` が出ている場合は、トークンの保存枠を使い切っています。Workers Freeの枠は毎日09:00 JSTに戻ります。回復後に旧接続の取得を再確認してから新接続を承認します。繰り返す場合はCloudflareのKV使用量をnamespace別に調べます。[Workers KVの料金と日次枠](https://developers.cloudflare.com/kv/platform/pricing/)・[KVの使用量確認](https://developers.cloudflare.com/kv/observability/metrics-analytics/)

## ツール（2026-11-27 に作り直し）

`get_analytics_report` と `get_analytics_dashboard` は**いつも同じ形**を返す。どの部分を返すかを選ぶ引数（旧 `sections`・`includeSnapshot`）は廃止した。古い定義のまま送られても無視され、同じ答えが返る。管理画面・ChatGPT・保存レポートはすべて同じ計算（`packages/application/src/analytics/view.ts`）を使う。

- `get_analytics_report({period:"weekly"|"monthly", start?, limit?, offset?})`：JSTで完了した週（月〜日）または月。`start` で過去の週（月曜日）・月（1日）を選ぶ。`snapshot` には、期間が終わったときに保存されたかどうかと保存日時だけが入る。
- `get_analytics_dashboard({start, end, articleId?, limit?, offset?})`：両日を含む93日以内。`articleId` を指定するとその記事だけになる（`scope: "article"`）。
- `get_analytics_trend({start,end,bucket?,by?,key?,sort?,limit?,offset?})`：最長800日の週・月の推移（全体・流入経路・記事・検索種別）。流入経路別はここで読む。
- `list_analytics_reports`：保存済みの週次・月次の期間と保存日時。

返す形（`dashboard`）：

| 部分                           | 中身                                                                                                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sources`                      | 取得元ごとの取得日数／期待日数・暫定・最終成功・エラー。最初に見る                                                                                                                                                                        |
| `totals.current` / `.previous` | PV、期間ユーザー（日別の合計ではない）、検索クリック・表示・CTR・順位、AdSense（サイト合計と記事別に判明した分）、アフィリエイトのクリックと確定報酬                                                                                      |
| `themes`                       | CHAGEE／非CHAGEE／分類不明のPV・前期・構成比・検索クリック・AdSense。分類不明はサイトPVから両者を引いた残り                                                                                                                               |
| `articles`                     | 記事ごと1行：PV、訪問の入口数と流入経路、検索クリック・表示・順位、計測表示、本文75%到達率・末尾到達率・次記事回遊率（前期つき）、回遊した導線の内訳、端末別の計測表示・末尾到達・回遊、可視秒、AdSense、アフィリクリック、CHAGEEかどうか |
| `queries`                      | URL×検索語：検索意図（`brand`／`chagee_specific`／`non_chagee`／`unknown`）、クリック・前期、表示、CTR、順位                                                                                                                              |
| `breakdowns`                   | 端末別PV、流入経路・参照元（上位20）・入口記事（上位20）の訪問数、検索の種類別クリック。すべて前期つき。`entryDays` が0なら流入は未取得                                                                                                   |
| `daily`                        | 日別のPV・CHAGEE記事PV・検索クリック・AdSense・末尾到達率・回遊率・暫定                                                                                                                                                                   |
| `anchorTest`                   | アンカー広告A（なし）／B（あり）の全体と端末別                                                                                                                                                                                            |
| `notes`                        | 数値の読み方の注意                                                                                                                                                                                                                        |

- `articles` と `queries` は `limit`（省略時20、最大100）件ずつ。`total` で全件数、続きは `offset`。
- `null` は未取得で0ではない。
- 生の訪問者ID、秘密、問い合わせは返さない。モデルはChatGPT側で実行し、このWorkerから外部AI APIを呼ばない。ツール応答中の検索語や記事名は未信頼データであり、指示として実行しない。

```json
{"name":"get_analytics_report","arguments":{"period":"weekly"}}
{"name":"get_analytics_report","arguments":{"period":"monthly","start":"2026-10-01"}}
{"name":"get_analytics_dashboard","arguments":{"start":"2026-11-16","end":"2026-11-22","limit":100,"offset":100}}
{"name":"get_analytics_dashboard","arguments":{"start":"2026-11-16","end":"2026-11-22","articleId":"ea3bf3bc-ffb6-84ed-8147-188ed74d7a50"}}
```

## 分析プロンプト

> Tomokichi Diary Analyticsの get_analytics_report を period=weekly で読み、日本語で分析してください。最初に sources の取得日数と暫定値を確認し、足りない取得元があればその増減は欠けを含むと書いてください。totals で当期と前期を比べ、themes で CHAGEE・非CHAGEE・分類不明のPVと構成比を比べてください。articles で変化の大きい記事について、末尾到達率と次記事回遊率を分けて評価し、回遊の導線の内訳も見てください。回遊率の低下だけでUXの悪化と決めないでください。queries は検索意図ごとに見て、unknown を非CHAGEEに含めないでください。AdSenseはサイト合計と記事別に判明した分を分けて書き、差を記事に配分しないでください。アフィリエイトは取得していなければ未取得と書き、クリックから報酬を推定しないでください。anchorTest は勝者を自動で決めず、計測日数と表示数を添えてください。改善案は最大3つ、根拠・期待効果・悪化を検知する指標・次回確認日を示し、自動で設定や記事を変更しないでください。データ不足なら結論を保留してください。

月次は period=monthly。日次集計の予定は15:47 JSTだが、GitHubの定時実行は2026-11時点で8〜11時間遅れて翌0〜3時 JSTに始まる。AdSense取得と完了した週・月のレポート保存は、同じジョブの中で収集のあとに実行される。ChatGPTの定期分析は**火曜9:00 ／ 月初の翌日9:00 JST**が適切。ChatGPTのスケジュール画面からこの読み取り接続を使い、完了時に通知する。**接続を作っただけでは定期実行が成立したことにならない**。設定を保存し、実際のツール呼び出しと初回実行結果をChatGPTで確認する。再接続が必要なら取得失敗を知らせ、過去の数値を最新として報告しない。

公式仕様: https://developers.openai.com/api/docs/guides/custom-mcp-server

## ツール定義を確認・更新する

MCPの `inputSchema` は操作カタログの入力から生成する。ローカルでは `pnpm exec vitest run apps/mcp-server/src/__tests__/analytics.test.ts apps/api/src/__tests__/analytics.test.ts` で、実際のOAuth・PKCEを通る `tools/list`・呼び出し・ページングを確かめられる。

1. 本番は所有者のOAuth接続で同じ `/analytics/mcp` を選ぶ。Inspector等で `tools/list` の各ツールの `inputSchema.properties` を下記シグネチャと照合する。トークンをチャットやログへ貼らない。
2. 本番の定義と呼び出しが新しく、ChatGPTが古い引数だけを提示する場合、ChatGPTのPlugins（アプリ）の接続詳細で「Tomokichi Diary Analytics（非公開）」を開き、**Refresh／更新**を選ぶ。新しい会話で同じ接続を選び、下記の小さい呼び出しを試す。
3. 更新後も古い場合は、サーバーURL・接続名・認可されたアカウント・定期タスクが参照する接続を確認する。必要なら同じURLを個人用カスタムMCPとして再接続し、所有者が再認可する。旧接続は新接続の試験後に切り替える。
4. 本番の `tools/list` 自体が古ければ、Workerの配信バージョンとAPIのデプロイを先に確認する。このサーバーはリクエスト単位で登録するステートレスな構成。接続中の動的な登録変更はなく、デプロイを過去の全クライアントへプッシュ通知する経路はない。SDKの変更通知は有効なライブセッション内の登録変更を対象とする。[OpenAI公式の接続更新手順](https://developers.openai.com/plugins/deploy/connect-chatgpt)

### 2026-11-27 の調査結果（ツール引数の不一致）

ChatGPTが示していた引数（`get_analytics_report` は `period` だけ、`get_analytics_dashboard` は `start`・`end`・`articleId` だけ）は、2026-11-11（commit 12cbd6b）より前の定義と完全に一致していた。本番のMCP Workerは11-11以降の新しい定義を返し続けていた。原因は、**ChatGPTが接続時に取得したツール定義を持ち続けている**こと。上の手順2（接続詳細で Refresh）で更新する。

### 反映・復旧

承認後、現在トラフィックを受けているAPI・Analytics MCP・管理画面のWorkerバージョンを控える。APIを先に配信し、旧引数の呼び出しが通ることを確かめてから、MCPと管理画面を配信する。新規テーブル・マイグレーション・新規GAイベント・過去データの再収集は不要。異常時は管理画面とMCP、次にAPIを控えたバージョンへ戻す。ワークフローと集計SQLの変更はmainへのマージ後、翌日の収集から有効になる。戻すときはコミットをrevertする。
