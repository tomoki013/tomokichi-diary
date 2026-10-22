# サイトポリシーの改訂

2026-10-22。プライバシーポリシー、利用規約、クッキーポリシー、執筆・編集ポリシー、アフィリエイトポリシーの5本を、現在のサイト構成に合わせて書き直した原稿です。2026-10-22 に管理画面から5本とも保存・公開しました（アフィリエイトポリシーは第3版、他は第2版）。

| ページ                 | URL                       | 原稿                                       |
| ---------------------- | ------------------------- | ------------------------------------------ |
| プライバシーポリシー   | `/legal/privacy`          | [privacy.md](privacy.md)                   |
| 利用規約               | `/legal/terms`            | [terms.md](terms.md)                       |
| クッキーポリシー       | `/legal/cookies`          | [cookie-policy.md](cookie-policy.md)       |
| 執筆・編集ポリシー     | `/legal/editorial-policy` | [editorial-policy.md](editorial-policy.md) |
| アフィリエイトポリシー | `/legal/affiliates`       | [affiliates.md](affiliates.md)             |

本文は次の実装に合わせています。実装を変えたらここも見直します。

- アクセス解析: GA4（`apps/web/src/lib/site.ts`）。本文・識別情報は送らない（`readerMeasurement.ts`）
- 広告: AdSense 記事末尾1枠と Google の同意メッセージ、「広告のプライバシー設定」リンク（`ArticleAd.astro`）
- お問い合わせ: Turnstile、IP はレート制限用のハッシュのみで保存しない（`apps/api/src/routes/contact.ts`）、通知は Resend
- いいね: 一覧は localStorage、集計用の匿名IDはサーバーでハッシュ化（`LikeButton.astro`、`apps/api/src/routes/likes.ts`）
- アフィリエイト: Trip.com / Agoda / Omio（`isAffiliateUrl`）、リンクは `rel="sponsored"` と「広告」表記

各ファイルの frontmatter の `summary` を要約に、本文をそのまま Markdown 欄に入れています。アフィリエイトの参加プログラムは本人の判断で Trip.com / Agoda / Omio の3つに絞りました（Klook・GetYourGuide・一休.com は削除）。
