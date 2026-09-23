# Release

最終更新: 2026-09-21。手順の正本は [OPERATIONS.md](OPERATIONS.md#releasing)。ここは「いつ・どの順で・何を根拠に」。

## Branch strategy

- `main` 1 本。機能は `feat/*` / `fix/*` / `chore/*` / `codex/*` ブランチから PR（履歴上 26 PR、全て `main` 宛て）。
- タグは使っていない。`package.json` の `version` は `2.0.0` 固定。
- `main` に入ったもの = deploy してよいもの。CI（`pnpm run ci`）が緑でなければ merge しない。
- 環境ブランチ（staging 等）は無い。プレビューは `PUBLIC_INDEXABLE=false` でビルドして workers.dev に出す（noindex + robots 全拒否）。

## Versioning

- サイトにバージョンは無い。「いつのコンテンツか」は `export/manifest.json` の `generatedAt` と git の履歴。
- API は URL に `/v1`。互換を壊す変更は `/v2` を足し、`/v1` は静的 HTML（フォーム）とキャッシュが参照し続けるので残す。
- D1 migration は `migrations/000N_*.sql` を **追記のみ**、expand/contract（`OPERATIONS.md` DB_MIGRATION_FAILED）。
- Knowledge snapshot は `ArticleKnowledge.schemaVersion`（`DATA_MODEL.md`）。

## Build

`OPERATIONS.md` の Releasing コマンド。要点:

- `PUBLIC_SITE_URL=https://tomokichidiary.com PUBLIC_INDEXABLE=true` を **media:build と build の両方**に付ける。
- Admin は API が deploy された **後**に `VITE_API_URL=https://api.tomokichidiary.com` でビルドする。

## Test（出す前）

1. `main` が clean、`pnpm run ci` green。
2. コンテンツを変えたなら `pnpm export:data` が commit 済み（`export/` と D1 の一致）。
3. `pnpm knowledge:catalog` が最新（WebMCP / MCP の read model）。
4. 切替（Phase 2）の前は `pnpm verify:live https://tomokichi-diary-web.tomoki-ttttt.workers.dev` で 194/194。

## Release（順序固定）

```
media:sync → db:migrate → deploy:api → deploy:mcp → deploy:web → (admin build) → deploy:admin → verify:live
```

migration は旧 API が動いている間に当たる。だから expand/contract。

## Cutover（Netlify → Cloudflare、1 回だけ）

`audit/diary-2.0-full-audit.md` §12 の Phase 0〜3。要約:

1. Phase 0: og:image 修正（済）、GA4（済・本番ホスト名のみで計測）、ads.txt / sw.js の引き継ぎ（済）、お問い合わせフォームの Turnstile site key、Search Console の確認（DNS 方式なら不要）、URL 移動の判断（GSC データが要る）。
2. Phase 2: DNS の apex/www を `tomokichi-diary-web` の custom domain へ。Netlify はドメインを外すだけで 30 日残す。
3. `pnpm verify:live https://tomokichidiary.com` → GSC で sitemap 再送信 → GA4 のリアルタイム。
4. Phase 3: 30 日観測。切り戻しは DNS を戻す（5 分）。

## Rollback

| 対象                     | 方法                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Web / Admin / MCP Worker | `wrangler rollback`（前の version）か、前のコミットで `deploy:*`                                     |
| API                      | 同上。ただし **migration が contract 済みなら旧 API は動かない** — contract は次のリリースで、を守る |
| D1                       | Time Travel（30 日）。expand のみの migration なら戻す必要は無い                                     |
| コンテンツ               | `export/` の前のコミットを `pnpm db:seed` で D1 に戻す（`restore.test` が seed 復元を保証）          |
| メディア                 | R2 は追記のみ（`media:sync` は既存を上書きしない）                                                   |
| ドメイン切替             | DNS を Netlify に戻す（切替後 30 日間）                                                              |

## Hotfix

`main` へ直接 PR → CI → Releasing の手順で該当 Worker だけ deploy（例: web だけなら `media:sync` → `build` → `deploy:web` → `verify:live`）。順序は守る（api を変えたなら api → web）。
