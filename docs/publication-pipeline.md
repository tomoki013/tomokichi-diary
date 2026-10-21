# 記事公開パイプライン

対象: `tomoki013/tomokichi-diary`。Astro静的生成、D1正本、R2写真配信、Workers、共有`deploy` concurrencyを維持する。広告・アフィリエイト・読者向けUI・計測設定は変更しない。

## 省略される処理

| 対象                  | 記事公開時の動作                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| API・管理画面・CHAGEE | ビルドもデプロイも行わない。コードCIで維持                                                                               |
| Web                   | 毎回サイト全体を静的生成。ページ差分配信には変更しない                                                                   |
| MCP                   | 実際の埋め込みカタログと全ワークスペース依存・ソース・設定・lockfile・Node版の指紋を比較。同一ならビルド・デプロイを省略 |
| MCP UI                | ビルド済みUIをデプロイで再利用し、二重生成を省略                                                                         |
| 写真                  | 同じコンテンツハッシュ・幅・形式の派生画像は再利用。alt・caption・本文・SEO編集だけでは再生成しない                      |
| R2同期                | 実物のサイズ・ETag・Cache-Controlと同一のオブジェクトは再送信しない                                                      |
| 検証                  | routes・SEO・links・Knowledgeをすべて維持。WebMCP検証を追加し、読み取り専用の各検証を並列実行                            |

MCP指紋はキャッシュではなく`publication_targets`の成功記録と比較する。初回・未知の指紋は必ず配信する。MCPに埋め込まれるカタログに本文由来の変更があれば、本文編集でも配信する。コードCIも実際のMCP配信後に同じ指紋を更新する。R2一覧取得を失敗・不完全・不正なカーソルで終了した場合、ローカルマニフェストへのフォールバックで配信を継続しない。

## 計測

`publication-step.mjs`が依存インストール・pull・画像処理・Web/MCPビルド・検証・R2同期・各デプロイ・配信確認・完了記録の開始/終了/経過時間をJSONLとActionsログへ残す。D1取得と原本取得、個々の検証も分離計測する。最後の`publication-report.mjs`はActions APIからジョブ待機・Runner開始・checkout・mise等の工程時刻を収集する。稼働中の最終ステップ時刻は未確定になり得る。Actions時刻の取得失敗は公開の成否を変えない。

成果物:

- `.artifacts/publication-timings.jsonl`: 工程ごとの開始/終了/経過時間
- `.artifacts/publication-report.json`: Actions待機・準備、工程、画像件数、実行ID
- `.artifacts/media-build.json`: キャッシュ・R2復元・新規生成件数
- `.artifacts/media-sync.json`: 実物確認済み件数・アップロード件数
- `publication_builds`: 要求・実行・工程・要求からの所要時間・失敗理由

Actions成果物は14日保持する。長期比較に使う実行はダウンロードして保管する。開始前に失敗してD1へ登録できなかった実行もActionsログから確認でき、要求は未処理のまま回収される。中断等で最終記録が走らなかった場合も同じ要求を別の実行IDで回収する。

## 整合性と失敗復旧

`site_publication.requested_id`は最新要求、`building_id`は取得した要求、`active_build_id`は実行固有ID。すべての工程更新・成功・失敗・MCP配信記録を要求IDと実行IDの両方で照合する。Actionsの同一run再試行にも新しい実行IDを割り当てる。古い実行は、新しい実行の進捗・成功時刻・エラーを上書きできない。

実行中に新しい要求が来た場合、旧要求の配信成功は旧要求についてだけ記録し、新しい要求を待機中に保つ。後続のdispatchまたは5分間隔のscheduleが最新公開版を取得する。予約公開・ブラウザを閉じた一括公開も既存の未処理要求回収を利用する。GitHub concurrencyはFIFOを保証する仕組みとして使わず、D1の要求比較とschedule回収で最終反映を保証する。

派生画像キャッシュと原本キャッシュは、各実行後に新しいキーへ保存する。原本キャッシュはSHA-256、R2復元はETagと画像形式・寸法で確認する。R2同期は毎回現在のoriginをページングして読み、同期後も再確認する。キャッシュ消失でもR2から復元し、R2にもない場合は原本から生成する。壊れた原本・派生画像でリンク検証を通過させない。サイズ/品質は従来と同じAVIF 58、WebP 74、340/704/1408px・拡大なし。

通常は失敗理由を修正して管理画面から再試行する。手動の完全復旧は`Publish content`の`full_media`。新しい要求を作らず未処理要求を回収したい場合はrequest_id空欄でdispatchできる。コード配信は従来のCIを利用する。成功したMCPだけ先行してWebが失敗した場合もサイト全体は失敗表示となり、次回は実際に成功しているMCPを省略しWebを再配信する。

## 本番反映手順

1. 新ワークフローをmainで実行する前に、production D1へ`0020_publication_progress.sql`までexpand migrationを適用する（既存の`pnpm db:migrate`）。既存列・記事・履歴を削除しない。旧API・旧ワークフローは引き続き動作する。
2. 通常のコードCIでAPI・管理画面・Web・MCPを配信する。API配信前にmigrationを実行する既存順序を維持する。記事公開だけのワークフローはAPI/管理画面を更新しない。
3. 既存productionトークンでR2のobject list/get/putが使えることを確認する。管理APIにはCloudflareトークンを追加しない。GitHubのActions read権限は工程計測用。
4. 最初のコード配信でMCP成功指紋を登録し、画像キャッシュを保存する。確認URLは公開ドメインを使う。CIの`VERIFY_URL`がworkers.devのままなら本番ドメインへ更新する。
5. 管理画面から意図した記事変更を1件公開し、工程・公開ページ・写真・RSS/sitemap・公開完了表示・Actions成果物を確認する。
6. A〜Eをそれぞれ3回以上、画像/ランナー/公開条件をそろえて観測する。公開要求から反映確認までの中央値を比較し、追加dispatch・schedule実行を含むActions実行回数も集計する。

手順1以降は本番への書き込み・公開を伴う。本実装のローカルテストと性能比較では実行しない。ロールバックはexpandしたテーブル/列を残し旧コードへ戻す。原本・派生画像・記事を削除しない。旧ワークフローへの切り戻しでMCP指紋が古くなるため、再導入の初回はコードCIでMCPを必ず配信してから省略判定を再開する。

## 比較結果と判定範囲

過去の本番実行は[基準値JSON](publication-performance-baseline.json)に保存した。2026-10-21の実公開はworkflow起動から完了記録まで369秒、2026-10-20は750秒。いずれも2,222派生画像のうち1,760個だけキャッシュに存在し、同じ462個を再生成した。生成時間は約285秒/500秒で、R2アップロードは両方0件。ログのprimary-key hitで追加画像が保存されず、次回も同じ旧キャッシュを復元していた。待機時間5秒/166秒など条件が違うため、これらをA〜Eの対照試験や改善後の数値と混ぜない。

ローカルの比較は`pnpm exec tsx scripts/publication-benchmark.ts`で再実行できる。ソース・export・写真を一時ディレクトリへ複製し、本番資格情報を子プロセスから除去して、A〜Eそれぞれ改善前後3回ずつビルド/画像/検証を行う。原本・本文・DBを本番へ書き込まない。基準となる旧画像スクリプトはcommit `566844b1475750b9380c90672d4e5b7e30e783ea`を使い、必要なら`PUBLICATION_BASELINE_REF`で指定できる。入力は現在のローカルexportである。

この比較はローカルの**計算処理時間**であり、GitHub待機・依存取得・D1/R2通信・デプロイ・反映確認を含む本番E2Eではない。新規画像は合成1600×1200画像、一括公開は既存の公開記事5件への本文追加である。各反復で本文・タイトル・captionに異なる変更を与え、対象slugはJSONに記録した。実写真や混雑時の時間を予測する数値には使わない。本番の中央値30%短縮の達成判定は、本番反映後の対照計測が必要。

各3回の中央値（秒、ローカル計算処理のみ）。[全サンプルと条件](publication-performance-local.json)。最終測定は全CI終了後に行い、他の検証コマンドを同時に実行していない。ホスト全体のバックグラウンド負荷は制御していない。

| ケース            | 改善前 | 改善後 |  短縮 |
| ----------------- | -----: | -----: | ----: |
| A 本文のみ        |  3.780 |  2.466 | 34.8% |
| B タイトル・SEO   |  3.777 |  2.451 | 35.1% |
| C alt・caption    |  3.772 |  2.418 | 35.9% |
| D 新規画像        |  3.906 |  2.476 | 36.6% |
| E 5記事の本文変更 |  3.822 |  2.475 | 35.2% |

A〜C/Eは1,762派生画像すべて再利用し、再生成0件。Dは初回だけ新規画像の6派生を生成し、2・3回目は1,768件すべて再利用した。画像の存在だけを見た旧処理に対し、新処理は形式・寸法も確認するため、完全キャッシュ時の画像工程自体は約0.3秒から約0.5秒へ増えている。この安全確認を含めてもビルド対象削減と検証並列化で計算時間が短縮した。R2アップロード件数の改善後実測と本番E2Eは未計測。モック同期テストでは、同一データの2回目アップロード0件、欠損1件だけの再送信、部分失敗からの復旧を確認した。

ローカル比較には本番Actions実行はなく、起動回数は各ケース0回。通常の管理画面からの単発/一括公開のdispatchは既存どおり1回。新要求との競合やscheduleによる追加runは、本番記録から別途集計する。

現在残るボトルネック候補はGitHub待機・D1の多数の取得クエリ・Web全体の静的生成・Cloudflare配信である。公開後の工程データから優先順位を決める。要求のない定期runの事前判定やD1読み取りの一括化は、整合性と計測を確認してから追加検討する。

## 変更ファイル

今回の実装で変更・追加したファイル。既存の旅先コラム・下書きの作業中変更は含めない。

- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`
- `apps/admin/src/lib/api.ts`
- `apps/admin/src/lib/bulk-publish.test.ts`
- `apps/admin/src/styles.css`
- `apps/admin/src/ui/SitePublication.test.ts`
- `apps/admin/src/ui/SitePublication.tsx`
- `apps/api/src/__tests__/publication-build.test.ts`
- `apps/api/src/publication.ts`
- `apps/mcp-server/package.json`
- `docs/ADMIN.md`
- `docs/OPERATIONS.md`
- `docs/publication-performance-baseline.json`
- `docs/publication-performance-local.json`
- `docs/publication-pipeline.md`
- `migrations/0020_publication_progress.sql`
- `package.json`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/publication.ts`
- `scripts/check-agent-surfaces.ts`
- `scripts/content-release.ts`
- `scripts/lib/__tests__/publication-mcp.test.ts`
- `scripts/lib/__tests__/publication-media.test.ts`
- `scripts/lib/__tests__/publication-originals.test.ts`
- `scripts/lib/__tests__/publication-step.test.ts`
- `scripts/lib/__tests__/publication-verify.test.ts`
- `scripts/lib/__tests__/publication-workflow.test.ts`
- `scripts/lib/media-originals.ts`
- `scripts/lib/media-remote.ts`
- `scripts/lib/publication-build.ts`
- `scripts/lib/publication-mcp.ts`
- `scripts/lib/publication-timing.ts`
- `scripts/lib/publication-verify.ts`
- `scripts/lib/remote-db.ts`
- `scripts/lib/__tests__/remote-db.test.ts`
- `scripts/media-build.ts`
- `scripts/media-sync.ts`
- `scripts/publication-benchmark.ts`
- `scripts/publication-checks.ts`
- `scripts/publication-report.mjs`
- `scripts/publication-step.mjs`

## 回帰検証

- `pnpm run ci`: 成功。552テスト、TypeScript、境界検証、記事パリティ、クリーン全体ビルド、SEO 189/189、sitemap 166、routes 194/194、内部リンク6,030件、画像参照13,914件、WebMCP、既存性能検証（99点）を通過。
- TypeScriptの成果物を削除してから`pnpm --filter @tomokichi/web build`と`pnpm --filter @tomokichi/mcp-server build:content`の成功を確認。Web単体生成に追加のAPI/admin/CHAGEEビルドは不要。
- 新しい自動テストは、要求・同一要求再試行・コード開始との競合、古い成功/失敗の拒否、予約/一括要求回収、工程と所要時間、MCP入力指紋、キャッシュ欠損/破損、同サイズの画像変更、R2部分失敗/再試行/実物不一致、配信確認の不一致、資格情報を除いたコマンド実行、管理画面表示を検証。外部サービスはモック。
- 既存のlint警告（AnalyticsExperienceの配列default prop）が1件あるが、エラーは0件。既存の編集作業・記事内容・収益化設定は変更していない。

R2実物照合には既存Cloudflare資格情報と[公式のオブジェクト一覧API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/)を利用する。取得したサイズ・ETag・HTTP metadataを使い、1000件ずつページングする。新しいインフラや追加の有料サービスは導入していない。

## 本番反映時の補強

- キャッシュ消失時の派生画像は公開配信から取得し、毎回取得したR2一覧のETag・サイズで検証する。CDNが古い・欠損・到達不能の場合だけ認証付きR2取得へ戻す。これにより、大量の画像復元でCloudflare REST APIのリクエスト上限に達することを避ける。
- D1取得で同時に発行されるSELECTを最大50件ずつまとめ、各クエリの結果を対応する呼び出しへ返す。書き込みと明示的なトランザクションは従来どおりで、結果件数が不一致・失敗のバッチは公開に使わない。

本番反映前の最新mainを基点にした分離ブランチでも全CIを通過した。画像キャッシュなしでの静的生成と公開検証を含む。上記補強後は型・形式・境界・Knowledge・全557テストを再検証して成功した。
