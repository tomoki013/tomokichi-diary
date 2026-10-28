# CHAGEE日本語ガイド（非公式）

`chagee.tomokichidiary.com` — 上海でCHAGEEにハマった「ともきちの旅行日記」がお送りする非公式CHAGEE日本語サイト。

旅行ブログとは別のサイト（[ADR 0010](../../docs/adr/0010-chagee-guide-separate-site.md)）。同じリポジトリにあるが、Worker・D1・R2 はすべて専用で、`@tomokichi/*` パッケージは import しない。

| 置き場所                         | 中身                                                                     |
| -------------------------------- | ------------------------------------------------------------------------ |
| D1 `chagee-guide`                | メニュー・店舗・最新情報・体験レポートへのリンク（`migrations/`）        |
| R2 `chagee-guide-media`          | 写真（`/media/*` で配信）                                                |
| `content/*.json`                 | D1 に入れる内容の正本。`db:seed` で slug（リンクは URL）単位に upsert    |
| `src/lib/order-guide.ts`         | 国別の注文ガイド（運営者が実際に注文した国だけ `ready: true`）           |
| 旅行ブログ（tomokichidiary.com） | 体験レポート・コラムの本文。このサイトは `column_links` でリンクするだけ |

## 開発

```bash
pnpm install
pnpm --filter @tomokichi/chagee db:migrate:local
pnpm --filter @tomokichi/chagee db:seed:local
pnpm --filter @tomokichi/chagee media:sync:local
pnpm --filter @tomokichi/chagee dev            # http://localhost:4321
```

ローカルの D1/R2 は `apps/chagee/.wrangler/` に入る。CSS を変えても反映されないときは dev サーバーを再起動する。

## 内容を更新する

1. `content/*.json` を編集する（メニューの評価・感想は `tasted: true` のときだけ書ける）
2. `pnpm --filter @tomokichi/chagee db:seed` — 本番 D1 に upsert（再ビルド不要、数分以内に反映）

写真は `media/` に置いて `media:sync`。`<name>-480.webp` と `<name>-735.webp` が R2 の `photos/` に入る。

### 情報の書き方のルール

- 体験していないことは書かない。未確認の項目は `null` にすると画面に「未確認」と出る
- `checkedAt` は公式情報か現地で確かめた日。不明なら `null`
- 最新情報は `verificationStatus`：`official`（公式発表）/ `reported`（報道、出典必須）/ `unverified`（噂・未確認、警告付きで表示）

## 初回デプロイ（Owner が行う）

本番リソースの作成と公開は Owner 承認が必要な操作。

```bash
cd apps/chagee
pnpm exec wrangler d1 create chagee-guide        # 出力された database_id を wrangler.jsonc に書く
pnpm exec wrangler r2 bucket create chagee-guide-media
pnpm db:migrate && pnpm db:seed && pnpm media:sync
pnpm run deploy                                  # chagee.tomokichidiary.com のカスタムドメインも作られる
```

### お問い合わせフォームを開く

設定が揃うまでフォームは「準備中」と表示し、POST は 503 を返す（fail closed）。

1. 共通お問い合わせ基盤に project `chagee-guide` を登録する
2. `wrangler.jsonc` に `INQUIRY`（`tomokichi-admin-core` の `Intake`、`props.projects: ["chagee-guide"]`）と `CONTACT_RATE_LIMITER` を追加し、`TURNSTILE_SITE_KEY` を入れる
3. `wrangler secret put TURNSTILE_SECRET_KEY --name chagee-guide` と `IP_HASH_SALT` を設定する
