# Testing

最終更新: 2026-09-21

## Philosophy

2 層で守る。

1. **純関数の単体テスト**（`packages/*`）— ルール（公開条件、ルート解決、firsthand の人間確認、お問い合わせ検証）はフレームワーク無しで網羅する。ADR 0003 の帰結。
2. **生成物の検査**（`scripts/check-*`）— サイトは静的生成なので、`dist/` を読めば「本当に出るもの」が検査できる。旧サイトの URL・SEO・内部リンク・Lighthouse をここで見る。ADR 0005 の帰結として、失敗は stable code で報告する。

書かないもの: フレームワークの再確認、モックの自己検証、Astro コンポーネントのスナップショット（生成物検査で代替）。
直っていない仕様は `it.fails` で望ましい契約を書く（`webmcp.test.ts` の catalog 外記事）。

## Unit（vitest）

- `vitest.config.ts`: `{packages,apps,infrastructure,scripts}/**/*.test.ts`。18 ファイル、171 テスト（うち 1 expected fail）。
- `packages/domain/src/__tests__/` — publishing / routing / knowledge / listing / contact / primitives。fixture は `fixtures.ts`。
- `packages/seo/src/__tests__/seo.test.ts` — metadata / JSON-LD / sitemap / RSS / robots。
- `packages/contracts/src/__tests__/validation.test.ts` — 入力検証の網羅報告。
- `scripts/lib/__tests__/page-seo.test.ts` — built HTML の抽出関数と画像 URL の規則（`SEO_IMAGE_URL_INVALID`）。

## Integration（実 D1 スキーマ・実 HTTP）

- `@tomokichi/infra-d1/testing-context` の `createTestContext()` が **in-memory SQLite に全 migration を適用**した `AppContext` を返す。R2 は in-memory storage。時計は固定、id は連番。
- `apps/api/src/__tests__/` — `api.test.ts`（認証・検証・記事ライフサイクル・media・knowledge）、`access.test.ts`（Cloudflare Access JWT: aud/iss/exp/署名/alg）、`contact.test.ts`（Turnstile 注入・honeypot・fail-closed・レート）、`likes.test.ts`（visitorId・未公開記事・toggle）。
- `infrastructure/database/d1/src/__tests__/` — migration の冪等、content-hash 重複、snapshot が published のみ、seed 復元。
- `apps/mcp-server/src/__tests__/protocol.test.ts` — tool 一覧、firsthand 限定、MCP App resource。
- `apps/web/src/lib/__tests__/webmcp.test.ts` — WebMCP 4 tool、登録/解除、不正入力、catalog 外記事（`it.fails`）。

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

`parity` ステップ（`pnpm content:parity`）は切替までの暫定で、`LEGACY_REPO`（CI では `tomoki013/travel-diary` の sparse checkout）の `posts/` と `export/` を `NormalizedArticle` で比較する。checkout が無ければ skip。ロジックのユニットテストは `scripts/legacy-sync/__tests__/`。

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
6. `knowledge.test` + `check:knowledge` — AI が firsthand を「確認済み」にできないこと。
7. `migrations.test` — 追記のみ、expand/contract。

詳細は [testing/test-gap-analysis.md](testing/test-gap-analysis.md)。
