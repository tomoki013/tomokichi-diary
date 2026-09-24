# AI Instructions — Tomokichi Diary 2.0

AI コーディングエージェント向け。最終更新: 2026-09-21。

## Project goal

個人の旅行ブログ（114 記事、日本語）。**URL と一次体験の価値を壊さずに**、人間・検索エンジン・LLM・AI Agent の 4 者に読ませる。現在は Netlify の旧サイトから Cloudflare の 2.0 へ切替直前（`audit/diary-2.0-full-audit.md` §12）。

## 最初に読むもの

1. `README.md` → `docs/ARCHITECTURE.md`（層と依存、コマンド）
2. `docs/DATA_MODEL.md`（entity）
3. `docs/adr/*`（9 本、各 17 行）と `docs/DECISIONS.md`
4. 触る領域の監査項目（`docs/audit/diary-2.0-full-audit.md`）

## Architecture rules

- `packages/*` と `infrastructure/*` に Astro / React / Hono / Vite / Cloudflare を import しない。`scripts/check-boundaries.ts` が落とす。外部は `packages/application/src/ports/*` の port に出す。
- URL は `routes` テーブル。**既存の path を削除・変更しない**。動かすなら redirect route を足す（`ROUTE_LEGACY_MISSING`）。
- 本文は Markdown。HTML / コンポーネント名をデータに入れない（ADR 0001 / 0007）。
- 公開サイトは `export/` だけを読む。D1 を読む Astro コードを書かない（ADR 0006）。
- AI の出力は `ai_artifacts`。revision に直接書かない。firsthand を `verified` にできるのは `verifyFirsthandCandidate`（人間の identity 必須）だけ（ADR 0004 / 0009）。
- migration は `migrations/000N_*.sql` を追記のみ。rename / drop / NOT NULL 化は 2 リリースに分ける（expand → contract）。
- `mediaUrl()` の結果は既に絶対 URL。`absoluteUrl()` に通さない（`SEO_IMAGE_URL_INVALID`）。
- 新しい CI 検査は stable code（`packages/contracts/src/error-codes.ts`）を足し、`OPERATIONS.md` に runbook を書く。

## Naming / Directory

- apps: `apps/web`（Astro）、`apps/admin`（Vite+React、hash router）、`apps/api`（Hono）、`apps/mcp-server`。
- packages: `domain`（entity / value / rule）、`application`（use case / port / read model）、`contracts`（DTO / zod / error code）、`data`（row ↔ entity、export 形式）、`seo`（純関数）。
- Astro: `src/views/*Page.astro`（route type ごと）、`src/components/*.astro`、`src/lib/*.ts`。Home は `HomePage.astro` + `components/home/*` に分割済み。`IndexPage.astro` は残り 5 画面を持つ（分割予定、監査 §15）。HOME の選定は `lib/editorial.ts`、体験タグの表示名は `lib/experiences.ts`（`docs/EDITORIAL.md`）。
- テスト: `src/__tests__/*.test.ts` か `__tests__/` 隣接。built-site の検査は `scripts/check-*.ts` + `scripts/lib/*`。
- id は UUID v7（`generateId`）。時刻は `Instant`（ISO 文字列）。

## Testing

- `pnpm test`（vitest）と `pnpm run ci`（全パイプライン、ローカル = CI）。
- 純関数はユニット、HTTP は `createApp({ contextFactory: () => ctx, verifyChallenge, verifyAccess })` + `createTestContext()`（in-memory D1）。
- 生成物の検査は `pnpm build && pnpm check:seo && pnpm check:links && pnpm check:routes`。
- 直していない契約は `it.fails` で書く。直したら `it` に戻す。
- `docs/testing/test-gap-analysis.md` の Risk Map を更新する。

## Security

- 秘密は `wrangler secret`。`.env` に本番値を書かない。`ci.yml` に Cloudflare token を足さない。
- お問い合わせの IP / メールをログに出さない。`ctx.logger` に本文を渡さない。
- `/v1/admin/*` は必ず認証ミドルウェアの下（`v1.use("/admin/*")`）。新しい admin route はその下に `route()` する。
- 公開 write を足すなら Turnstile かレート制限。

## SEO / LLMO

- `packages/seo` の純関数で metadata / JSON-LD を組む。View に直書きしない。
- `<h1>` は 1 つ、記事タイトルをそのまま描画（`check:seo` の h1 検査）。
- noindex は `article.noindex` か `route.noindex`。旧サイトで index だったページを noindex にしない（`SEO_NOINDEX_REGRESSION`）。
- 内部リンクは本文の `](./slug)` 形式（記事基準で解決、カード化される）。
- 一次体験と一般情報は `TravelFact.provenance` で分ける。本文の言い回しで濁さない。

## Do not

- `pnpm ci`（clean install）。`pnpm run ci` を使う。
- `export/` を手で編集しない（Admin → API → D1 → `pnpm export:data`、またはローカルで `pnpm db:restore-local` → `pnpm content:revise` → `pnpm export:data`）。
- 旧サイト（`../travel-diary`）の `posts/` を手で編集しない。切替までは `pnpm legacy:export` の出力だけを置く（`docs/migration/legacy-content-sync.md`）。
- `dist/` を commit しない。
- `IndexPage.astro` に画面を増やさない（分割の方向）。
- `WebMcpTools.astro` の inline JSON に大きなデータを足さない（fetch に変える方向、監査 §9）。
- 旧サイトのコード（このリポジトリ外）を参照して挙動を再現しない。`migration/*.json` のベースラインだけが正。

## Commands

```bash
mise install && pnpm install
pnpm run ci
pnpm test
pnpm --filter @tomokichi/web dev            # :4321
pnpm --filter @tomokichi/api dev            # :8787
pnpm export:data && pnpm knowledge:catalog
pnpm verify:live https://tomokichi-diary-web.tomoki-ttttt.workers.dev
```

## Definition of Done

- [ ] `pnpm run ci` green（ローカル）
- [ ] 新しい検査コードは `error-codes.ts` + `OPERATIONS.md`
- [ ] URL を足したら `routes` に行がある（`check:routes` / `check:seo`）
- [ ] コンテンツを変えたら `export/` を再生成して commit
- [ ] 該当する `docs/*.md` と `DECISIONS.md` を更新
- [ ] PR は `main` 宛て、本文に「何をなぜ」
