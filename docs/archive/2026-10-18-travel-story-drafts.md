# 未公開記事と場所別小話の確認記録

2026-10-18。記事情報の精査と、これまでの未コミット差分のローカル統合に伴う確認です。CMSの公開版・公開予約・公開用export・本番配信は変更していません。

## 内容

- 小話22本はです・ます調の下書き。今回の精査では本文を再編集せず、[情報精査](../../drafts/tabisaki-no-kobanashi/FACT-CHECK-2026-10-18.md)へ留保・一次資料との対応を記録しました。
- アフィリエイト改稿5本は各2リンク追加の未公開原稿。リポジトリ保存用Markdownの整形のみ行い、CMS本文は更新していません。
- 「この場所の小話」は具体的な場所の一致・公開版の本文の言及だけを対象とします。国や都市だけの一致、未公開原稿、画像altや参考資料・関連記事だけの言及は使いません。

## 検証

`pnpm run ci format lint typecheck boundaries knowledge parity test media clean-build build routes agents seo links` が成功しました。

| 検査                       | 結果                 |
| -------------------------- | -------------------- |
| 整形・lint・型・依存境界   | 成功                 |
| テスト                     | 508件成功            |
| コンテンツ比較             | 114記事一致、不一致0 |
| メディア・全アプリのビルド | 成功                 |
| ルート                     | 194/194              |
| SEO                        | 189/189              |
| リンク検査                 | 成功                 |
| 変更差分の空白検査         | 成功                 |

精査記録の最終追記後、対象Markdownの整形と差分も確認しました。Lighthouse性能測定は今回の変更では再実行していません。

## 既存の依存監査指摘

`pnpm audit --prod --json` は critical 1件・high 5件を報告しました。対象は proxy-addr、http-cache-semantics、source-map-js、sharp、@modelcontextprotocol/client、@modelcontextprotocol/sdk です。これは今回追加した依存ではなく、package.json・lockfileは変更していません。監査指摘の解消や、実行経路ごとの到達可能性の評価は今回の範囲に含めていません。依存監査を「合格」とは扱いません。

## Gitと非公開状態

ローカル作業ブランチでコミットし、ローカルmainへマージします。GitHubのmainへのpushはCIの自動デプロイを起動するため行いません。PR作成・リモートへのpush・公開ワークフロー起動・CMSの公開操作は行いません。既存の未追跡 `.tomokichi/` はコミット対象から除外します。
