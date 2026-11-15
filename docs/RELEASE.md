# Release

最終更新: 2026-11-15。手順の正本は [OPERATIONS.md](OPERATIONS.md#releasing)。ここは「いつ・どの順で・何を根拠に」。

## Branch strategy

- `main` 1 本。機能は `feat/*` / `fix/*` / `chore/*` / `codex/*` ブランチから PR（履歴上 26 PR、全て `main` 宛て）。
- タグは使っていない。`package.json` の `version` は `2.0.0` 固定。
- `main` に入ったもの = deploy してよいもの。CI（`pnpm run ci`）が緑でなければ merge しない。
- 環境ブランチ（staging 等）は無い。プレビューは `PUBLIC_INDEXABLE=false` でビルドして workers.dev に出す（noindex + robots 全拒否）。

## Versioning

- サイトにバージョンは無い。「いつのコンテンツか」は公開マーカー `/__publication/<build-id>.json` と管理画面の「サイト反映」の履歴。
- API は URL に `/v1`。互換を壊す変更は `/v2` を足し、`/v1` は静的 HTML（フォーム）とキャッシュが参照し続けるので残す。
- D1 migration は `migrations/000N_*.sql` を **追記のみ**、expand/contract（`OPERATIONS.md` DB_MIGRATION_FAILED）。
- Knowledge snapshot は `ArticleKnowledge.schemaVersion`（`DATA_MODEL.md`）。

## Build

`OPERATIONS.md` の Releasing コマンド。要点:

- `PUBLIC_SITE_URL=https://tomokichidiary.com PUBLIC_INDEXABLE=true` を **media:build と build の両方**に付ける。
- Admin は API が deploy された **後**に `VITE_API_URL=https://api.tomokichidiary.com` でビルドする。

## Test と Release

- `main` への push で `ci.yml` の `Check` → `Deploy` が順に走る。`Check` が緑でなければ deploy されない。
- Deploy は本番 D1 の公開版を取得してビルドし、`db:migrate → deploy:api → deploy:mcp / web / admin → verify:live → 公開マーカー確認` の順。
- 記事の公開・取り下げ・サイト反映はコードのリリースと別に `publish.yml`（管理画面か operator MCP から依頼、5 分ごとに確認）が行う。
- migration は旧 API が動いている間に当たる。だから expand/contract（`OPERATIONS.md` の `DB_MIGRATION_FAILED`）。

## Rollback

| 対象                     | 方法                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Web / Admin / MCP Worker | `wrangler rollback --name <Worker 名>`（前の version）か、前のコミットで `deploy:*`                  |
| API                      | 同上。ただし **migration が contract 済みなら旧 API は動かない** — contract は次のリリースで、を守る |
| D1                       | Time Travel（30 日）。expand のみの migration なら戻す必要は無い                                     |
| コンテンツ               | D1 の Time Travel。最後の手段として `export/` の前のコミットを `pnpm db:seed` で戻す                 |
| メディア                 | R2 は追記のみ（`media:sync` は既存を上書きしない）                                                   |

## Hotfix

`main` へ直接 PR → CI → Releasing の手順で該当 Worker だけ deploy（例: web だけなら `media:sync` → `build` → `deploy:web` → `verify:live`）。順序は守る（api を変えたなら api → web）。
