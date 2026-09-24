# Decisions

最終更新: 2026-09-21

ADR の索引と、ADR になっていないが実装から読み取れる判断。ADR 本文は `docs/adr/`。ここでは 1 行の要約と「その後どうなったか」を足す。根拠が無いものは `Reason unknown` / `Current implementation suggests …`。

## ADR 一覧（`docs/adr/`）

| #    | 決定                                                                 | 状態 / その後                                                                         |
| ---- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 0001 | 本文は Markdown を正本にする（HTML/MDX を保存しない）                | 維持。`ArticleBody.astro` がビルド時に HTML 化                                        |
| 0002 | URL は `routes` テーブルの data。slug から導出しない                 | 維持。`[...route].astro` がテーブルを走査、`check:routes` が旧 URL 194 件を守る       |
| 0003 | core（domain/application/contracts/data/seo）は framework を知らない | 維持。`check-boundaries.ts` が CI で強制                                              |
| 0004 | AI 生成物は `ai_artifacts`、人が採用するまで表示しない               | 維持。`AIProvider` port、未設定でもビルド可                                           |
| 0005 | CI は成功時 1 行、失敗時は stable code                               | 維持。`scripts/lib/report.ts`、`OPERATIONS.md` はコード別 runbook                     |
| 0006 | 公開サイトは commit 済み `export/` から生成。D1 を読まない           | 維持。公開が 2 段階（Admin → export → deploy）になる帰結を監査 §13 A-1/A-2 で緩和予定 |
| 0007 | 埋め込みは「何であるか」を保存し、コンポーネント名を保存しない       | 維持。`EmbedBlock.astro` / `CostReport.astro`                                         |
| 0008 | series / journey は `Collection` entity                              | 維持。`/series/*` `/journey/*` は 301                                                 |
| 0009 | 旅行知識は記事とは別の sidecar graph                                 | 維持。3 記事のみ移行、111 記事が backlog                                              |

## ADR 化されていない判断（コード・設定・履歴から）

| 判断                                                                                              | 根拠                                                                          | 状態                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **記事 URL（`/posts/*`）は凍結、それ以外（destination / journey / series / legal）は 301 で移動** | `migration/legacy-routes.json` + `export/routes.json`（redirect 59 件）       | 決定済み。ただし移動した 37 URL の検索流入は未確認（監査 §4.2）。GSC を見て `isCanonical` を戻す余地あり                                   |
| **4 Workers、Pages を使わない**                                                                   | `ARCHITECTURE.md` Deployment。静的アセット Worker は per-request コストが無い | 維持                                                                                                                                       |
| **CI は deploy しない。Cloudflare token をリポジトリに置かない**                                  | `ci.yml` コメント、`OPERATIONS.md`                                            | 維持。コンテンツ公開の自動化（監査 A-2）と両立させる場合は GitHub Environment secret で例外を明示                                          |
| **Admin と API を同一ホスト（`/api`）に置き、Access 1 つで守る**                                  | `ARCHITECTURE.md` API、`apps/admin/worker/index.ts`                           | 維持                                                                                                                                       |
| **お問い合わせはメールを送らず D1 に保存**                                                        | `OPERATIONS.md` Contact form                                                  | 維持。送信者 IP は salted hash                                                                                                             |
| **画像は R2 の独自ドメイン、AVIF/WebP ラダーは再生成可能な成果物**                                | `ARCHITECTURE.md` Media、`.cache/images`                                      | 維持                                                                                                                                       |
| **末尾スラッシュ無し、`file` 出力**                                                               | `astro.config.mjs` コメント（旧サイトと同じ挙動）                             | 維持                                                                                                                                       |
| **Web フォント無し（システムフォント）**                                                          | `BaseLayout.astro`（フォント読み込み無し）                                    | **Reason unknown**。Current implementation suggests 性能優先（旧サイトは 41〜45 ファイル）。ブランドフォントを入れるなら 1〜2 weight       |
| **WebMCP の catalog を各記事 HTML に inline**                                                     | `WebMcpTools.astro`                                                           | Current implementation suggests catalog が 3 記事で小さかったため。記事数に比例して膨らむ（監査 §9）                                       |
| **`dateModified` を import 日で埋めた**                                                           | `export/articles.json`（全件 2026-08-24）                                     | Reason unknown（import の副作用と推定）。監査 SEO-3                                                                                        |
| **JSON-LD の `about` に Location の slug**                                                        | `structured-data.ts:62`                                                       | `Location` に name が無く `location_names` を引かなかった。監査 SEO-2                                                                      |
| **GA4 / GTM を入れていない**                                                                      | `BaseLayout.astro`                                                            | Reason unknown。`analytics.ts` は `dataLayer.push` 前提の形なので GTM を想定していたと読める。切替前に決める                               |
| **タイトル区切りを `｜`（全角）に変更**                                                           | `site.ts` `titleSeparator`                                                    | Reason unknown。旧サイトは `\|`。順位影響は小                                                                                              |
| **タグの slug がハッシュ（`tag-xxxxxxxx`）**                                                      | `export/tags.json`、`slugify` が非ラテンで諦める（`primitives.test`）         | 日本語タグ名から slug を作れないため。タグページを作る時に人が付ける                                                                       |
| **お問い合わせの保持期限を決めていない**                                                          | schema に期限列無し                                                           | 未決定                                                                                                                                     |
| **likes にレート制限を付けない**                                                                  | `routes/likes.ts`                                                             | Reason unknown。監査 §15 で追加を提案                                                                                                      |
| **切替まで旧サイト（travel-diary）へ NEW → OLD の一方向同期、比較は NormalizedArticle**           | `scripts/legacy-sync/`、`docs/migration/legacy-content-sync.md`               | 暫定。双方向にしない（更新ループ・古い文章の復活・updatedAt 破壊を避ける）。切替後に丸ごと削除                                             |
| **experienceTags は閉じた語彙で、`articles` の JSON 列**                                          | `entities/experience.ts`、migration 0009、`docs/EDITORIAL.md`                 | 気分から記事に入る導線の軸なので表記揺れを許さない。語彙は小さく常に記事と一緒に読むため join table にしない。既存 `tags` は自由語彙のまま |
| **HOME の選定（ベストエピソード・ランキング）は記事 metadata に持たない**                         | `apps/web/src/lib/editorial.ts`                                               | 記事の内容を表す情報と、ページ上の編集的な見せ方を分ける                                                                                   |
| **Lighthouse は desktop preset**                                                                  | `lighthouserc.json`                                                           | Reason unknown。mobile は 93〜95（監査 §11）                                                                                               |

## 決めるべきこと（未決定）

1. 切替時に `/destination/<city>` 等 37 URL を移動したままにするか（GSC の流入次第）。
2. GA4 を GTM 経由にするか gtag 直か。
3. `ADMIN_TOKEN` を Access 導入後に削除するか。
4. お問い合わせの保持期限。
5. AI クローラ（GPTBot 等）の robots 方針（今は全許可）。
