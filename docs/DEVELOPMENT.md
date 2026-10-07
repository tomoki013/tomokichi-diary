# Development

最終更新: 2026-09-21。コマンドはこのリポジトリで実際に動くものだけ。

## Requirements

| もの     | 版                           | 出所                                                        |
| -------- | ---------------------------- | ----------------------------------------------------------- |
| Node     | **24.18.0**                  | `mise.toml`（`latest` は使わない、`ARCHITECTURE.md`）       |
| pnpm     | **11.11.0**                  | `mise.toml` / `package.json` `packageManager`               |
| mise     | 任意だが推奨                 | `mise install` で上の 2 つが揃う。CI も `jdx/mise-action`   |
| Chrome   | Lighthouse 用（`pnpm perf`） | ローカルの `Google Chrome.app`。headless で起動             |
| cf       | 各アプリの devDependency     | deploy / D1 の操作。手元で使う人だけ `cf auth login`        |
| wrangler | 各アプリの devDependency     | cf のビルド実装と、secret / R2 / rollback。`wrangler login` |

## Setup

```bash
git clone <repo> tomokichi-diary && cd tomokichi-diary
mise install          # node / pnpm
pnpm install          # --frozen-lockfile が CI の挙動
cp .env.example .env  # 必要なら。既定値で動く
pnpm run ci           # 全部通れば環境は正しい（約 3.5 分、Lighthouse 込み）
```

`pnpm ci`（ハイフン無し）は pnpm 組込みの clean install なので **必ず `pnpm run ci`**。

## Environment

`.env.example` が一覧。公開サイトはビルド時に読む（`PUBLIC_*`）、Admin は `VITE_API_URL`、API は Worker の vars / secrets。

| 変数                        | 既定                                             | 用途                                                                                                                                                |
| --------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_SITE_URL`           | `https://tomokichidiary.com`                     | canonical / sitemap / OG                                                                                                                            |
| `PUBLIC_INDEXABLE`          | `true`                                           | `false` で全ページ noindex + robots 全拒否（プレビュー用）                                                                                          |
| `PUBLIC_MEDIA_URL`          | `https://media.tomokichidiary.com`               | R2 のメディアドメイン                                                                                                                               |
| `PUBLIC_BUILD_TIME`         | 未設定                                           | 固定すると同一コミットのビルドが byte 同一                                                                                                          |
| `PUBLIC_API_URL`            | `https://api.tomokichidiary.com`                 | お問い合わせフォームの POST 先                                                                                                                      |
| `PUBLIC_TURNSTILE_SITE_KEY` | 未設定                                           | 未設定ならフォームを描画しない。dev では試験キー                                                                                                    |
| `VITE_API_URL`              | `http://localhost:8787`                          | Admin → API。本番ビルドは `https://api.tomokichidiary.com`                                                                                          |
| API secrets                 | `wrangler secret put --name tomokichi-diary-api` | `ADMIN_TOKEN`, `TURNSTILE_SECRET_KEY`, `IP_HASH_SALT`, `LIKE_HASH_SALT`（`apps/api/src/env.ts`）。ローカルは `apps/api/.dev.vars`（gitignore 済み） |
| API vars                    | `apps/api/cloudflare.config.ts`                  | `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_ORIGINS`, `TURNSTILE_EXPECTED_HOSTNAME`                                                                |

## Install / Development server

```bash
pnpm --filter @tomokichi/web dev        # http://localhost:4321（Claude Code の launch.json と同じ）
pnpm --filter @tomokichi/admin dev      # http://localhost:5173（VITE_API_URL の API を叩く）
pnpm --filter @tomokichi/api dev        # http://localhost:8787（cf dev、ローカル D1/R2）
pnpm --filter @tomokichi/mcp-server dev # 公開 MCP
```

Claude Code の `.claude/launch.json` には `api`（8795）と `admin`（5173、`VITE_API_URL=http://localhost:8795`）もある。ローカル D1 が空なら `apps/api` で `cf d1 migrations apply <DB ID> --local --persist-to .wrangler/state --dir ../../migrations` → `pnpm seed:sql` → `cf d1 raw <DB ID> --local --persist-to .wrangler/state --batch @../../.artifacts/seed.batch.json`。DB ID は `apps/api/cloudflare.config.ts` の `DB`。`--persist-to .wrangler/state` が無いと `cf dev` とは別の場所（`~/.config/cloudflare/state`）に書かれる。Admin の「お問い合わせ」は `INQUIRY_OPERATOR`（別 Worker への Service Binding）が要るので、ローカルでは基盤の `apps/api` を同時に立てるか、「未設定」表示のまま触る。

公開サイトは `export/` から静的生成するので、**D1 が無くても動く**（ADR 0006）。記事を直したいときは Admin → API → D1 → `pnpm export:data` → commit の順。ローカルの D1 は `.data/tomokichi.db`（`pnpm import:legacy` か `export/` から復元）。

## Build

```bash
pnpm build                                   # 全アプリ
PUBLIC_SITE_URL=https://tomokichidiary.com PUBLIC_INDEXABLE=true pnpm --filter @tomokichi/web build
pnpm media:build                             # media/** → .cache/images（AVIF/WebP ラダー、CI でキャッシュ）
```

本番用のビルドは **必ず** `PUBLIC_SITE_URL` と `PUBLIC_INDEXABLE=true` を付ける（既定のままだと noindex が入る。`OPERATIONS.md`）。

## Cloudflare CLI（cf と wrangler）

Worker の設定は各アプリの `cloudflare.config.ts`（cf の形式）。`wrangler.toml` は無い。Wrangler 固有の設定（静的アセットのディレクトリ、HTML の text import）だけ `wrangler.config.ts` に残る。

| 操作                | コマンド                                                      | 備考                                                                                                                                  |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| deploy              | `pnpm deploy:*` → `cf-wrangler build && cf deploy --prebuilt` | `cf-wrangler` は cf が Wrangler に委ねるときと同じビルド実装。`--prebuilt` で cf に Vite / Astro をフレームワークとして再検出させない |
| dev（api）          | `cf dev`                                                      | ローカル状態は `apps/api/.wrangler/state`                                                                                             |
| D1 migration / seed | `pnpm db:migrate` / `pnpm db:seed`                            | cf の D1 コマンドは DB 名ではなく ID を取る                                                                                           |
| secret              | `wrangler secret put <NAME> --name tomokichi-diary-api`       | `cf workers secrets update` は値を引数で渡すのでシェル履歴に残る                                                                      |
| R2 へのメディア送信 | `pnpm media:sync`（wrangler）                                 | `cf r2 objects put` は Cache-Control を付けられない                                                                                   |
| rollback            | `wrangler rollback --name <Worker 名>`                        | cf に相当する一発のコマンドが無い                                                                                                     |

cf は beta（`1.0.0-beta.*` を exact で固定）。Vite / Astro を cf のフレームワーク連携で直接ビルドするには `@cloudflare/vite-plugin` v2 と Astro の Cloudflare adapter（Astro 7.4 以上）が要るので、それまでは上の `--prebuilt` で運用する。

## Debug

| 目的                | 手段                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| CI が落ちた理由     | `.artifacts/ci/summary.json`（stable code）。`OPERATIONS.md` がコード別の runbook                                           |
| 1 ページの SEO      | `pnpm build` → `pnpm check:seo`。`SEO_*` コードで報告                                                                       |
| 旧 URL が解決するか | `pnpm check:routes`（ローカル dist）、`pnpm verify:live <base>`（デプロイ先）                                               |
| リンク切れ          | `pnpm check:links`                                                                                                          |
| Lighthouse          | `pnpm perf`（desktop）。mobile で見るなら `node node_modules/.pnpm/lighthouse@*/node_modules/lighthouse/cli/index.js <url>` |
| WebMCP              | ブラウザで記事を開き `document.modelContext`。`pnpm check:agents` が生成物を検査                                            |
| MCP 本番            | `pnpm verify:mcp https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev`                                                      |
| 型                  | `pnpm typecheck` + `pnpm --filter @tomokichi/web exec astro check`（後者は CI 外。2026-09-21 に 0 error）                   |

## Common commands

`ARCHITECTURE.md` の Commands 表が正本。よく使う順:

```bash
pnpm run ci            # format / lint / typecheck / boundaries / knowledge / test / media / build / routes / agents / seo / links / perf
pnpm test              # vitest（18 ファイル）
pnpm format            # prettier --write
pnpm lint              # oxlint + eslint(astro)
pnpm export:data       # D1 → export/
pnpm knowledge:catalog # export → WebMCP/MCP の read model
pnpm knowledge:backlog # 人手レビュー待ちの記事一覧
```

## Troubleshooting

| 症状                                            | 対処                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm ci` が clean install を始めた             | `pnpm run ci`                                                                               |
| `FORMAT_CHECK_FAILED`                           | `pnpm format`                                                                               |
| `BOUNDARY_VIOLATION`                            | `packages/` から framework を import している。port に出す（`scripts/check-boundaries.ts`） |
| `ROUTE_LEGACY_MISSING`                          | 旧 URL を消した。redirect route を足す（削除しない）                                        |
| `SEO_IMAGE_URL_INVALID`                         | `mediaUrl()` の結果を `absoluteUrl()` に通した（`OPERATIONS.md`）                           |
| `PERF_*`                                        | Chrome が無い / hero の `width`/`height` 欠落                                               |
| `astro check` が `dataLayer` や `path` で落ちる | 2026-09-21 に修正済み。再発したら `apps/web/src/lib/analytics.ts` の `declare global`       |
| Admin にログインできない                        | `VITE_API_URL` が空文字（`api.ts` のコメント）/ `ADMIN_TOKEN` 未設定 = API 閉鎖             |
| 画像が 404                                      | `media/` にある → `media:build` → `media:sync`（`OPERATIONS.md` Media）                     |

## 関連

- 構成: [ARCHITECTURE.md](ARCHITECTURE.md)、[DATA_MODEL.md](DATA_MODEL.md)
- テスト: [TESTING.md](TESTING.md)
- リリース・切替: [RELEASE.md](RELEASE.md)、[OPERATIONS.md](OPERATIONS.md)
- 監査: [audit/diary-2.0-full-audit.md](audit/diary-2.0-full-audit.md)
