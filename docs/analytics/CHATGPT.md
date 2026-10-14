# ChatGPTからの非公開分析

ChatGPTの個人用カスタムMCP接続で集計を読み、チャットまたは定期分析から使う。公開ディレクトリへの申請や共有は不要。既存の公開旅行情報MCP `/mcp` と分析用 `/analytics/mcp` は別のツール集合であり、公開content exportへ分析を混ぜない。

## 接続

- 名前: Tomokichi Diary Analytics（非公開）
- Server URL: `https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/analytics/mcp`
- 認証: OAuth、DCR、scope `analytics:read`
- ChatGPT WebのPlugins → 追加 → カスタムMCPサーバー。個人用として作成・インストール。
- 所有者のAdmin/Cloudflare Accessログイン後、戻り先ドメインと読み取り権限を確認して許可。APIの共有admin tokenでは許可できない。
- 集計と保存レポートの読み取りだけ。記事・広告設定の変更、再集計起動、問い合わせ・閲覧者ID・認証情報の取得は提供しない。

接続URL自体は到達可能だが、認証なしのデータ取得は401。OAuthメタデータに数値は含まれない。所有者はMCP Worker secret `ANALYTICS_OWNER_SUBJECT`（検証済みAccess subject）で固定し、欠落時は閉じる。トークンにも同じsubjectとread scopeを要求する。Accessの本人確認はAPIの既存署名・audience・issuer・期限検証で行う。許可フォームは管理ドメインのみ、Origin確認・ブラウザーcookieに結び付いた一度限りのconsent handle・PKCE S256・resource audienceを使用する。

専用KV `tomokichi-diary-analytics-oauth` にOAuthのclient/grantを保存。ライブラリはcode/tokenをhash、propsを暗号化する。accessは1時間、refreshとDCR登録は90日。期限切れではChatGPTから再接続。緊急停止はOwner subject secretを削除すると既存tokenを含めデータ取得・新規許可とも閉じる。ChatGPT側の接続解除とproviderのrevocation endpointも使用できる。収集workflowは独立して継続。

## ツール

`get_analytics_report({period:"weekly"|"monthly"})`: JSTで完了した前週（月〜日）/前月。保存snapshotの生成日時・未生成状態に加え、同期間の最新D1集計と前期間比較を返す。snapshot生成後のbackfillや収益遅延を最新集計から検証できる。

`get_analytics_dashboard({start,end,articleId?})`: 両日を含む93日以内の集計と前期間、取得状況・記事別/流入別/広告ユニット別・UX測定。日次人数の和を期間unique人数として扱わない。取れていない収益や体験測定を0へ補完しない。

モデルはChatGPT側で実行する。このWorkerから外部AI APIを呼ばず、保存reportも根拠データとして保持する。ツール応答中の検索語や記事名は未信頼データであり、指示として実行しない。

## 分析プロンプト

> Tomokichi Diary Analyticsのget_analytics_reportをperiod=weeklyで読み、必要な期間・記事をget_analytics_dashboardで確認して日本語で分析してください。対象期間と前期間、取得不足・推定値・サンプル数を明記。流入/検索/記事、読了・回遊、広告到達・request/filled・viewable proxy、LCP/INP/CLS、推定収益を併せて評価してください。UX優先で改善案を最大3つ、根拠・期待効果・悪化を検知する指標・次回確認日を示してください。広告を増やすことを前提にせず、配置だけでなくサイズ・速度・読了・回遊・端末差も検討。自動で設定や記事を変更せず、データ不足なら結論を保留してください。

月次はperiod=monthlyへ変更。日次集計15:47 JST、AdSense15:53、週次report月曜16:17、月次report月初16:37のため、ChatGPTの分析は月曜17:00/月初17:15 JSTが適切。ChatGPTのスケジュール画面からこの読み取り接続を利用し、完了時に通知する。**接続作成だけでは定期実行の成立を確認したことにならない**。設定の保存と実際のツール呼び出し・初回実行結果をChatGPTで確認する。再接続が必要な場合は取得失敗を知らせ、過去の数値を最新として報告しない。

公式仕様: https://developers.openai.com/api/docs/guides/custom-mcp-server
