# 画像重複検出・再利用・公開Slug

実装日: 2026-10-11。新しい依存ライブラリ・本番サービスは追加していない。
本番API・管理画面・D1への反映を実施。適用結果は下記「本番適用記録」に記載する。

## 事前調査

| 項目         | 既存構成と対応                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| アップロード | 管理API `POST /v1/admin/media`。Hono → application use case → D1 / R2                                             |
| 保存先       | R2 `tomokichi-diary-media`。公開元画像は `media.tomokichidiary.com`                                               |
| メタデータ   | D1 `media_assets`。既に `sha256 UNIQUE`、`storage_key UNIQUE`、`size`、`mime_type` がある                         |
| 変換         | 管理APIは元画像のバイト列を保存。既存 `media:build` がSharpでAVIF / WebP・複数幅の派生画像を生成                  |
| 記事との関連 | `article_media`。用途、alt、captionは利用関係に保存。複数記事から同じ画像を参照可能                               |
| 本文・OGP    | 本文はMarkdown内URL。cover / ogも画像IDを参照。公開版の利用関係はpublication metadataでも保持                     |
| 削除         | 画像実体の削除APIは存在しない。記事編集の「外す」は利用関係のみ更新。元画像・本文URL・OGP・サムネイルを削除しない |
| 既存UI       | `MediaLibrary` と記事編集 `MediaSection` のライブラリ選択を拡張                                                   |
| 認証         | 管理API全体のCloudflare Access JWT / ADMIN_TOKENを維持。照会、一覧、Slug編集、元ファイル取得はすべて同じ認証配下  |

旧実装は事前検索後にR2へ書き込み、D1の一意制約に競合すると失敗していた。
新実装では同じハッシュの保存予約を一件だけ取得し、所有者だけがR2へ書き込む。

## DB変更

`migrations/0014_media_identity.sql` は追加変更のみ。

- `media_assets.original_name`: 元ファイル名。旧画像はAPIでstorage keyの末尾を表示名として補う。
- `media_assets.slug`: 任意の現在の公開Slug。NULL以外は一意。
- `media_assets.content_sha256`: ストレージ実体で検証した元バイト列のSHA-256。未検証はNULL。
- `media_hashes`: SHA-256を主キーに、安全な代表画像IDへ対応させる。旧重複レコードの保持が可能。
- `media_slug_aliases`: 公開Slugを主キーに画像IDへ対応させる。改名後も旧Slugを保持し、他の画像に再割り当てしない。
- `media_uploads`: SHA-256を主キーに保存処理を予約。候補メタデータと開始時刻を記録し、Worker中断後も復旧対象を追跡する。

元の `sha256` / ID / storage key / 記事参照は変更しない。
特に元の `sha256` は既存派生画像のファイル名にも使われるため、バックフィルで書き換えない。
公開ビルドの元画像チェックサム照合には検証済み `content_sha256` を優先する。

## 処理フロー

1. 画像を複数選択し、必要な画像に公開Slugを入力する。
2. ブラウザでサイズ・形式を確認し、元ファイルのSHA-256を計算する。Web Cryptoがない環境ではサーバー判定へ進む。
3. 認証済み `POST /v1/admin/media/lookup` で照会する。重複があれば元ファイルを送らず、既存画像の選択またはキャンセルを表示する。
4. 未登録なら元ファイルを送信する。APIは20MB上限、コンテナ構造・署名、MIME整合性を確認し、元バイト列からSHA-256を再計算する。送信されたハッシュや寸法は信頼しない。
5. D1でハッシュの保存予約を取得する。競合したリクエストは最大約2秒、既存保存の完了を待つ。完了すれば既存画像を返し、長い保存・中断中なら画像単位で再試行を案内する。
6. 予約取得後にも重複を確認し、所有者だけがハッシュと予約画像IDを含むR2 keyへ保存する。過去の未登録オブジェクトにも衝突させず、後片付けは今回の候補keyだけに限定する。
7. D1 batchでメタデータ・代表ハッシュ・Slug aliasを登録し、予約を解除する。新規は201、重複は200。従来のレスポンス項目に `duplicate` 等を追加する。
8. 障害時はD1のコミット状態を再確認する。未登録を確認できた場合だけ候補オブジェクトを片付ける。DB確認や片付けができない場合は予約を保持し、管理画面の「保存処理待ち」件数と復旧処理で追跡する。

画像本体を増やさず、画像IDを別の記事の `article_media` に登録して再利用する。
alt / captionは記事ごとに設定する。保存前に記事・画像IDの存在も検証する。

## UI・公開URL・形式変換

- 画像一覧と記事編集で共通のアップロードUIを使用する。画像ごとに保存・重複・失敗・キャンセルを表示し、失敗だけ再試行できる。
- 重複時は「この画像はすでにアップロードされています」、サムネイル、保存済みファイル名、「既存画像を使用」「キャンセル」を表示する。
- 画像一覧・記事のライブラリをSlug、ファイル名、URLで検索できる。
- 画像一覧の「詳細・形式変換」で新旧画像のSlugを設定・変更できる。
- 公開Slug URLは `https://api.tomokichidiary.com/v1/images/tokyo-trip.jpg` の形。既存API Workerから元画像を配信するため、追加のWorker・R2コピーは不要。
- 設定 `PUBLIC_IMAGE_URL` がURLのベース。拡張子は実際のMIMEから決定する。別の拡張子を付けても形式が一致しなければ404。
- 元R2 URLは継続して有効。Slug変更・解除後も過去のaliasは有効。既存記事のMarkdownを自動変更しない。新しい本文挿入ではSlug URLを利用できる。
- 公開aliasは既に公開R2に保存されているJPEG / PNG / WebP / AVIF / GIFのみ。公開ハッシュ照会・画像一覧は提供しない。将来非公開ストレージを導入する際はaliasの公開条件も追加する。
- WebP / JPEG / PNGを実際にエンコードしてダウンロードする。品質・最大幅を指定でき、拡張子だけを変更する処理ではない。
- 元ファイル・DB・R2を変換で変更しない。JPEGの透明部分は白にし、アニメーションは先頭フレームとして出力する。非対応ブラウザやデコード不能画像は画面にエラーを表示する。
- 自動圧縮は今回有効化していない。明示的な変換処理 `convertImage` と独立したoptionsを、将来の自動圧縮にも利用できる。既存のサイトビルド時の派生画像生成は維持する。

Workerの検証は署名・コンテナ構造・PNG CRC等の確認であり、すべてのコーデックの完全なデコード検証ではない。SVGの新規アップロード・公開Slug配信は許可しない。

## 既存画像のバックフィル

`pnpm media:backfill` は既定でdry run。ローカルは `.data/tomokichi.db` と `media/`、`--remote` はD1 RESTとR2の元オブジェクトを読む。
DBには先に0014までのマイグレーションを適用する必要がある。スクリプト自体はマイグレーションを実行しない。

```sh
# 調査のみ。実体の保存・削除なし。
pnpm media:backfill --remote

# アップロードを停止したメンテナンス中に適用する。
pnpm media:backfill --remote --apply --uploads-paused

# 全件を再検証する場合。
pnpm media:backfill --remote --verify-all
```

リモート実行には `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、必要に応じて `D1_DATABASE_ID` / `MEDIA_BUCKET` を使用する。
トークンにはD1照会・更新およびR2読み取り権限が必要。認証情報はログに出さない。

- 既に代表ハッシュが登録されていればそれを維持し、未登録なら作成日時・ID順に最初の取得成功レコードを代表とする。
- 実体が存在しない画像、読み取り失敗、DB登録失敗はスキップして理由を記録する。
- 旧ハッシュとの不一致、重複と代表IDを `.artifacts/media-backfill-*.json` に記録する。既存重複レコード・オブジェクト・参照を削除しない。
- 未検証のみが通常の再実行対象なので、途中から再実行できる。全件再検証には `--verify-all` を使う。
- 元画像の取得は最大4件並列、代表レコードの登録は作成日時・ID順を維持する。20件ごとに進捗を表示する。
- 最後の状態取得に失敗しても画像ごとのレポートは保存し、異常終了で再実行を案内する。
- 画像一覧の未検証件数が0になるまで、過去画像への完全な適用は未完了。旧SHAが実バイト列の正しい値なら、バックフィル前でも既存のSHA照会で重複を検出できる。

中断された保存処理は、アップロード停止を確認し15分以上経過してから復旧する。

```sh
pnpm media:backfill --remote --recover
pnpm media:backfill --remote --recover --apply --uploads-paused
```

復旧は元オブジェクトのハッシュ・構造を確認し、メタデータ登録を完了する。オブジェクトがない場合は空の予約だけを解除する。
直近の予約はスキップし、不正オブジェクト・失敗した予約は調査用に残す。バックフィル・復旧スクリプトはストレージの書き込み・削除を行わない。

## 本番適用手順とロールバック

1. D1をエクスポートしてバックアップし、既存マイグレーション適用状況を確認する。R2と最新のコンテンツexportを保持する。
2. 現在のSHAは既に一意だが、以下のSQLで既存ハッシュの形式・件数を調査する。バックフィルdry runで実体の重複・欠落も確認する。
3. 0014を先に適用する。追加列はNULL、追加テーブルは空なので既存アプリも利用できる。テーブル再作成・既存行削除は不要。
4. APIを先に、管理画面を後に反映する。`PUBLIC_IMAGE_URL` とAccess / ADMIN_TOKEN設定を確認する。
5. アップロード停止を確保してdry run結果をレビューし、バックフィルを適用する。停止中は旧画面・外部APIクライアントもアップロードさせない。
6. スキップ、不一致、代表IDを確認する。未検証件数と保存待ち件数を確認してから停止を解除する。
7. 新規・同名別内容・名前変更の重複・同時アップロード・記事共有・解除・Slug変更前後のURL・形式ダウンロードをステージング/本番で確認する。
8. 公開用コンテンツのexportを更新し、通常のサイト公開フローで派生画像・本文/OGPの表示を確認する。古いexportを本番へ再seedしない。

アップロード停止は `MEDIA_UPLOADS_PAUSED=1 pnpm deploy:api` で適用する。認証済みの新規アップロードだけ503 / Retry-Afterを返し、既存画像の一覧・参照・再利用は維持する。停止解除は `MEDIA_UPLOADS_PAUSED=0 pnpm deploy:api`。通常の設定値は0。

```sql
SELECT sha256, COUNT(*) FROM media_assets GROUP BY sha256 HAVING COUNT(*) > 1;
SELECT COUNT(*) FROM media_assets WHERE length(sha256) <> 64 OR sha256 GLOB '*[^0-9a-f]*';
SELECT COUNT(*) FROM media_assets WHERE content_sha256 IS NULL;
SELECT sha256, media_id, started_at FROM media_uploads;
```

問題があればアップロードを停止し、管理画面を前の版へ戻す。追加スキーマ・元画像・ハッシュ登録・aliasは保持し、修正版APIで対応する。
Slug URLを記事で使用済みの場合、alias配信を含まない旧APIへの丸ごとロールバックは避ける。APIを戻す場合もalias配信と必要なスキーマの読み取りは維持する。
データ参照や元画像を移動・削除していないため、バックフィルを取り消すための破壊的なDB操作は不要。

## 本番適用記録

2026-10-11 20:25 JST時点で適用完了。

- D1バックアップ: `.artifacts/production-before-media-20261011.sql`（1,746,655 bytes）。一時SQLiteへの復元、integrity check、外部キー検査が成功。バックアップはGit管理外、ファイル権限600。
- 本番の既存マイグレーションは0013まで確認済み。0014だけを追加適用した。
- API Worker: `be581976-caf1-49d1-83b4-7ac8e16f3155`。`PUBLIC_IMAGE_URL`設定済み、`MEDIA_UPLOADS_PAUSED=0`でアップロード再開済み。
- Admin Worker: `9edb2e3e-e6f1-45a4-ba1d-aaf60af50a0c`。最新mainの記事一括公開機能も維持した。
- dry run: `.artifacts/media-backfill-remote-1791717492036.json`。404件すべて取得成功、旧ハッシュ不一致・完全重複・欠落は各0件。
- 適用: `.artifacts/media-backfill-remote-1791717862045.json`。404件すべて検証済み、代表ハッシュ404件、未検証・保存待ち・スキップは各0件。
- 整合性: `.artifacts/production-media-integrity.json`。画像404件の旧カラム、記事の画像関連516件、公開用メタデータ125件、記事ID122件がバックアップと一致。外部キー違反0件。既存URL・旧SHA・保存先・記事参照は変更していない。
- 本番管理画面の画像一覧・Slug編集欄・形式変換を確認。既存写真からWebP / JPEG / PNGをダウンロードし、Sharpで実形式と654×980の寸法を検証した。Slugは必要な画像に管理画面から設定でき、既存画像への自動命名は行っていない。
- API health、既存記事、元画像は200。認証なしのハッシュ照会は401。R2の書き込み・削除や記事の編集は実施していない。
- 本番ブラウザからのアップロード操作はChrome拡張のファイルURL権限がなく自動検証できなかった。新規・重複・同時アップロード・Slug配信・共有と解除はローカルのAPI / D1 / ブラウザ検証で確認済み。本番に検証用の画像や記事は作成していない。
- 読み取り中の一時通信断は再実行で解消。以降も再実行可能で、状態取得失敗時にも画像単位のレポートを残す。

## 検証

実施結果（2026-10-11、最新mainの記事一括公開機能を含む）: 全35テストファイル成功、294件成功・既存の期待失敗1件。期待失敗は既存WebMCPテストの `it.fails`。
型チェック、lint、全4アプリの本番ビルドが成功。Chromiumで以下のブラウザ検証も成功した。

- `pnpm test`: API・application・D1・管理画面ヘルパー・既存記事編集を含む全体回帰テスト。
- `pnpm typecheck` / `pnpm lint` / `pnpm build`: 型、lint、各アプリの本番ビルド。
- 新規/名前変更の同一画像/同名別内容/リサイズ/再エンコード/同時アップロード/共有と解除/旧重複レコード移行/再実行/サイズ・MIME・内容不正/ストレージ障害/DB障害/応答喪失/復旧/Slug競合と過去alias/バイナリ応答CORSを検証。
- ブラウザ検証は1440px / 390pxで混在一括アップロード、重複使用とキャンセル、通信失敗後の再試行、Slug変更、WebP/JPEG/PNGの実エンコードと寸法、元ファイル不変、記事保存・挿入・解除を確認。JPEGの白背景化は実ピクセルで確認。
- スクリーンショットと変換ファイルは `.artifacts/media-ui/`。本番・実データは使用していない。

ブラウザ検証の再実行にはメモリ上の専用API fixtureとPlaywrightを使用する。Playwrightはプロジェクト依存に追加していないので、利用可能な既存ランタイムを `PLAYWRIGHT_MODULE` で指定できる。
必要なら `PLAYWRIGHT_EXECUTABLE` でインストール済みChromiumを指定する。

```sh
# ターミナル1。毎回再起動してfixtureをリセットする。
pnpm --filter @tomokichi/api build
pnpm media:preview

# ターミナル2。
VITE_API_URL=http://127.0.0.1:8787 pnpm --filter @tomokichi/admin dev --host 127.0.0.1 --port 5173

# ターミナル3。ブラウザ/モジュール設定は利用環境に合わせる。
pnpm media:verify-ui
```

手動プレビューは `http://127.0.0.1:5173/#/media`、トークンは `media-preview`。
このAPIはlocalhostのみで待ち受け、一時SQLite・メモリストレージを利用する。再起動するとプレビューで追加した内容は消える。

## 変更ファイル

### 管理画面

- `apps/admin/src/lib/api.ts`
- `apps/admin/src/lib/media-upload.ts`
- `apps/admin/src/lib/media-upload.test.ts`
- `apps/admin/src/lib/media-convert.ts`
- `apps/admin/src/ui/MediaUpload.tsx`
- `apps/admin/src/ui/MediaDetails.tsx`
- `apps/admin/src/pages/MediaLibrary.tsx`
- `apps/admin/src/pages/editor/MediaSection.tsx`
- `apps/admin/src/styles.css`

### API

- `apps/api/cloudflare.config.ts`
- `apps/api/src/env.ts`
- `apps/api/src/app.ts`
- `apps/api/src/mappers.ts`
- `apps/api/src/routes/media.ts`
- `apps/api/src/routes/images.ts`
- `apps/api/src/routes/articles.ts`
- `apps/api/src/__tests__/api.test.ts`
- `apps/api/src/__tests__/media.test.ts`

### Domain・Application・Contracts・DB・Export

- `packages/domain/src/entities/media.ts`
- `packages/application/src/index.ts`
- `packages/application/src/ports/repositories.ts`
- `packages/application/src/use-cases/media/image-content.ts`
- `packages/application/src/use-cases/media/media-use-cases.ts`
- `packages/application/src/use-cases/media/media-maintenance.ts`
- `packages/application/src/use-cases/content/snapshot.ts`
- `packages/contracts/src/dto.ts`
- `packages/data/src/rows.ts`
- `packages/data/src/snapshot.ts`
- `packages/data/src/export-format.ts`
- `infrastructure/database/d1/src/repositories.ts`
- `infrastructure/database/d1/src/__tests__/repositories.test.ts`
- `migrations/0014_media_identity.sql`

### スクリプト・報告

- `scripts/media-backfill.ts`
- `scripts/media-ui-preview.ts`
- `scripts/verify-media-ui.ts`
- `scripts/lib/seed-sql.ts`
- `scripts/lib/__tests__/seed-sql.test.ts`
- `scripts/content-release.ts`
- `package.json`
- `docs/media-deduplication.md`
