# Testing

最終更新: 2026-10-28

## Philosophy

個人の旅行日記なので、ユニットテストは**壊れたら困る所だけ**に絞る（2026-10-28 に大幅に削減）。

残す範囲:

- **セキュリティ** — 認証（Admin token / Cloudflare Access JWT / OAuth）、入力検証、XSS・SQL インジェクション・パストラバーサル、秘密情報が公開データに漏れないこと。
- **管理画面の最低限** — Admin API の認証と記事ライフサイクル、Admin のルーティング・下書き差分・公開状態の表示。
- **お問い合わせフォーム** — Turnstile・honeypot・fail-closed・レート・基盤への引き渡し。
- **いいね・共有** — 記事/写真のいいね API、ブラウザ側のいいね状態、再 seed で読者のいいねを消さないこと。
- **記事品質** — 公開条件（`publishing.test`）、SEO 生成物（`seo.test` / `page-seo.test` / `check-routes.test`）と `scripts/check-*`・Lighthouse。

それ以外（広告配置、アナリティクス集計、ホームの並び、WebMCP、移行ロジックなど）はテストを書かず、preview と生成物検査で確認する。新しくテストを足すのも上の範囲に入るときだけにする。

## Unit / Integration（vitest）

- `vitest.config.ts`: `{packages,apps,infrastructure,scripts}/**/*.test.ts`。
- `@tomokichi/infra-d1/testing-context` の `createTestContext()` が **in-memory SQLite に全 migration を適用**した `AppContext` を返す。R2 は in-memory storage。時計は固定、id は連番。
- セキュリティ: `apps/api/src/__tests__/{access,api,analytics,media,monetization}.test.ts`、`apps/admin/worker/*.test.ts`、`apps/mcp-server/{operator/operator,src/__tests__/analytics}.test.ts`、`packages/contracts/src/__tests__/validation.test.ts`、`packages/{data,domain}/src/__tests__/monetization.test.ts`（非公開フィールドの除去）、`scripts/analytics/analytics.test.ts`、`scripts/lib/__tests__/publication-{originals,step}.test.ts`、`apps/admin/src/lib/ad-preview.test.ts`・`apps/chagee/src/__tests__/{markdown,seed,seo}.test.ts`（エスケープ）。
- 管理画面: `apps/api/src/__tests__/api.test.ts`、`apps/admin/src/lib/{lib,article-state}.test.ts`。
- お問い合わせ: `apps/api/src/__tests__/{contact,inquiry}.test.ts`、`packages/domain/src/__tests__/contact.test.ts`、`apps/chagee/src/__tests__/contact.test.ts`。
- いいね: `apps/api/src/__tests__/{likes,photo-likes}.test.ts`、`apps/web/src/__tests__/my-trips.test.ts`、`scripts/lib/__tests__/seed-sql.test.ts`。
- 記事品質: `packages/domain/src/__tests__/publishing.test.ts`、`packages/seo/src/__tests__/seo.test.ts`、`scripts/lib/__tests__/{page-seo,check-routes}.test.ts`。

## UI / E2E

ブラウザ自動化は無い。代わりに:

- `pnpm check:seo` / `check:links` / `check:routes` / `check:agents` が **188 ページの dist** を全件検査。
- `pnpm perf` が 6 ページ × 3 回の Lighthouse（desktop）。予算は Perf ≥ 95 / SEO 100 / LCP ≤ 2.5s / CLS ≤ 0.10 / TBT ≤ 200ms（`lighthouserc.json`, `scripts/perf.ts`）。
- `pnpm verify:live <base>` — デプロイ先で旧 URL 194 件を実 HTTP で叩く（切替の合否）。
- `pnpm verify:mcp <base>` — 本番 MCP の protocol/tool/UI。

## Running tests

```bash
pnpm test                                        # 全 vitest
npx vitest run apps/api/src/__tests__/contact.test.ts
pnpm run ci                                      # 全パイプライン（ローカル = CI）
pnpm build && pnpm check:seo && pnpm check:links # 生成物検査だけ
```

## CI

`.github/workflows/ci.yml`: push(main) / PR / 手動で `pnpm run ci`。`.cache/images` を `export/media.json` のハッシュでキャッシュ。artifact に `.artifacts/`（summary.json、Lighthouse、ログ）。**CI は deploy しない**（`OPERATIONS.md` Releasing）。

`parity` ステップ（`pnpm content:parity`）は切替までの暫定で、`LEGACY_REPO`（CI では `tomoki013/travel-diary` の sparse checkout）の `posts/` と `export/` を `NormalizedArticle` で比較する。checkout が無ければ skip。

`astro check` は CI に入っていない（`pnpm typecheck` は tsc のみ）。入れるなら `apps/web` の `typecheck` を `scripts/ci.ts` の typecheck ステップに足す。

## Mock / Fixture

- HTTP 層は依存注入: `createApp({ contextFactory, verifyChallenge, verifyAccess })`。外部（Turnstile、Access 証明書）は差し替える。
- `access.test.ts` は WebCrypto で RSA 鍵を生成し `fetch` を spy。時刻は `vi.useFakeTimers()`。
- コンテンツ fixture は `packages/domain/src/__tests__/fixtures.ts`。
- 本番データ（`export/`）を読むテストは無い（`check:*` が dist 経由で見る）。

## Critical test areas（壊れたら困る順）

1. `check:routes` + `verify:live` — 旧 URL 194 件（順位と流入の資産）。
2. `check:seo`（canonical / noindex 退行 / sitemap / **og:image の形**）。
3. `publishing.test` — 公開条件（route・cover・alt）。
4. `access.test` / `api.test` authentication — Admin が閉じていること。
5. `contact.test` — 唯一の無認証書き込み。
6. `likes.test` / `seed-sql.test` — 読者のいいねが正しく数えられ、再 seed で消えないこと。

詳細は [testing/test-gap-analysis.md](testing/test-gap-analysis.md)。

2026-10-10 管理画面修正: Accessの認証と本文を保つAPIプロキシ、写真のMarkdown挿入、固定ページの公開、予約日時の実行、下書きmetadataの分離、公開連携の失敗・再試行・競合を自動テスト。Chromeで実際のログイン後の通信エラーを確認し、ローカルの実API/SQLite/R2代替ストレージで写真選択・本文挿入・全体保存・公開を操作する。

2026-10-10 本番データ確認: D1の122記事・253 routesを取得し、移行0012の旧collections URL転送をローカルで適用した公開版でbuild/routes/SEO/links/knowledgeが成功（194 URL、SEO189、sitemap166、links5823、images13799）。移行の旧URL維持・未対応URL不変更と、D1 REST単体/一括クエリの外部契約も自動テストで確認。

2026-10-10 訂正: 0012は転送方向が最新実装と逆だったため、0013の追記移行で `/collections/*` を正本、`/trips/*` を301転送に修復する回帰テストを追加。0012適用済みのD1を再現し、転送ループ・別言語への誤転送・連載の変更を防ぐ。既存の予約公開テストはActionsと共通のapplication use caseを検証する。

2026-10-11: 配信環境の初回ビルドを `pnpm exec tsc --build --clean && pnpm build` で再現する。共通の型定義を先に生成し、APIとMCPの並行処理によるsrc/distのブランド型混在を防ぐ。
