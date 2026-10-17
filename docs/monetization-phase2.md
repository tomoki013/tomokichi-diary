# 収益化 Phase 2

2026-10-17 JST。コードとローカル検証の記録。本番DBへのmigration、配信、案件登録、記事変更、実験開始は実施していません。

## 監査と設計

作業開始時のcheckoutは `feat/chagee-guide` で、広告・Analytics v2の追加前でした。最新 `origin/main` を基点に `codex/monetization-phase2` を作成しています。元checkoutの未コミット変更は保護しています。

既存の `ArticleAd.astro` は300×250の末尾1枠、`ads.ts` は本番apex/www、ページload後・200px近接時にリクエストします。filled/unfilledを公式公開属性で観測し、50%以上・可視ページ・連続1秒をproxyとします。reader-v1の35/65%候補到達、本文到達、可視時間、web-vitalsを維持しています。CMPへのGoogle側の連携とプライバシー設定リンクを変更しません。広告の自動refresh、クリック計測、iframe内部の読取はありません。

D1 → 公開版 → 一時export → Astro/MCPという既存の経路を使用します。公開WebはD1へ接続しません。`publication_metadata` 内に**AdSenseに必要な項目だけ**を固定し、記事の「変更を公開」で反映します。保存時は公開版ポインターを変えません。収益化のみの編集でも公開待ちを検知できるよう、必要時に本文が同一の下書きrevisionを作成します。本文、埋め込み、Travel Knowledgeを引き継ぎます。

### DB（0017・expandのみ）

- `monetization_settings`: サイト方針。AdSense、個別配置、実験フラグ、登録ユニット、1枠上限。
- `article_monetization`: 記事にFKを持つ下書き設定。モード、配置、参加実験、更新日時。
- `monetization_placements`: 記事・キーの複合主キーと案件FK。案件の物理削除はRESTRICT。
- `affiliate_offers`: 管理専用の案件マスター。draft / ready / paused / archived。
- `ad_experiments`: 記事へのFK、draft / running / stopped。記事ごとのrunningは一意。

記事設定・実験の保存と公開待ちrevisionの更新は同じD1 batchで原子的に行い、後半の参照制約で失敗した場合もrevisionごとrollbackします。設定JSONのshapeとURLをcontractsで検証し、applicationで記事・案件・実験の参照、状態遷移、配置のUX制限を検証します。全APIは既存 `/v1/admin/*` の認証ゲート下、private/no-storeです。公開エンドポイントは追加しません。配置のCRUDは記事設定全体のPUTで置換します。案件削除はアーカイブで、配置との紐付けは残します。アーカイブからの復帰と実施後の実験条件の変更は許可しません。

既存記事へ一括書込み・分類・migration backfillはありません。設定がない記事は従来の末尾ユニット `7152502134`、1枠です。個別配置と実験のサイト設定は初期falseです。

## 管理操作

サイドバー「収益化」に概要、広告設定、アフィリエイト案件、配置管理、配置テストがあります。グラフはAnalyticsへの導線で再利用し、同じグラフを増やしません。

概要はAnalytics v2の直近28日からAdSenseサイト合計だけを表示します。ユニット別収益は合算しません。未取得は「未取得」、報酬は「未設定」。GA4のproxyと公式表示数は別指標です。公開広告記事数は公開スナップショットに基づきますが、サイト生成完了前は直前の配信版と異なる場合があります。

### 記事への配置

1. 記事編集の「収益化」を開きます。none / ads / affiliate / hybridを選べます。affiliate / hybridでも今回のアフィリエイト配信は無効です。
2. 「収益化スロットを挿入」を展開し、本文プレビューのブロック後を選択します。
3. スロット種別を選び「広告配置を追加」。キーを自動生成し、Markdownへ独立した段落 `{{monetization:slot-…}}` として挿入します。
4. AdSenseを追加すると他のAdSense枠は一時停止します。最大広告数は1です。本文内広告は見出しと600字以上の内容の後にし、画像・ギャラリー・関連リンクの直前直後を避けます。実行時もファーストビューと隣接UIを検査します。
5. アフィリエイト予定枠では案件を後から割り当て、管理画面内だけで予約カードをプレビューできます。未割当や停止・アーカイブの案件でも配置を保持します。
6. 移動は本文プレビューの別ブロックを選んで「選択したブロックの後へ移動」。削除は配置とマーカーをまとめて削除します。「順序を上へ」は管理リスト内の整理です。実際の本文位置を変える場合は移動操作を使います。
7. 「収益化設定を保存」も既存の全体保存に参加します。未保存警告・入力検証・公開前チェックの対象です。
8. 「変更を公開」で公開版へ固定し、既存のサイト反映完了を待ちます。

キーは見出しテキストや番号から独立しています。見出し名の変更だけでは位置は変わりません。重複・消失したマーカーは公開をブロックし、別位置に自動移動しません。未使用マーカーとアフィリエイト枠は公開HTMLのカード・リンク・空白枠を生成しません。code fence内は広告位置として扱いません。

サイト方針の保存は、以後の記事公開に適用されます。既存公開版の一括変更は行いません。適用する記事だけ個別に公開してください。

## アフィリエイトの非公開境界

`AFFILIATE_ENABLED=false`、`AFFILIATE_RELEASE_APPROVED=false`。管理画面にactiveステータスはありません。フラグだけを変更しても、公開projectionに案件の情報を通す経路も公開rendererも存在しません。

公開snapshot・exportの生成時と読込時の両方でallowlistを適用します。許可するのは記事ID、AdSense有効状態、位置キー・ユニット、承認済み実験の匿名な配信設定だけです。案件の名称・URL・画像・メモ・offerId・affiliate placementsは渡しません。公開MCP、WebMCP、knowledge catalogにも管理案件を渡しません。アフィリエイト用のダミーリンク、外部イベント、報酬推定もありません。

将来の有効化には別リリースが必要です。正式な提携リンク・案件承認・広告表記・HTTPS安全性・`rel="sponsored"` 等・規約／プライバシー／ASP条件の確認を必須とする公開用の承認モデルとprojectionを実装し、公開rendererとテストを追加してからリリース条件を解放してください。現リリースの管理設定だけでは有効化できません。

## A/Bテストの開始手順

初期allowlistは `chagee-placement-v1`、記事 `52b1cb6d-eb74-85a3-b6a1-392f83313051` (`/posts/shanghai-chagee-menu`) だけです。新規記事には適用されません。

2026-10-17 JSTに所有者専用Analytics接続で対象記事への継続した流入を確認し、実験候補として妥当と判断しました。ただし読書体験の計測期間が短く、特にデスクトップは標本不足です。本文は4つのおすすめメニューの提示後をB候補とします。実際のPV・端末別の計測数・検索語・収益はGitや公開exportに保存しません。

1. コードのレビュー・CI後、通常リリースで0017 → API → Web → Adminを配信します。現時点では未実行です。
2. 管理「収益化 → 広告設定」で個別配置と配置実験を有効にして保存。
3. 対象記事の本文プレビューで、主要な回答（4メニュー）の後、まとめや関連記事から離れた本文段落後を選びスロットを作成。既定の末尾枠を維持したい場合はアフィリエイト予定枠としてキーだけ準備して構いません（公開には出ません）。本文と配置を全体保存。
4. 「配置テスト」でBのキーを入力／選択。A・BのユニットとBの比率50%を選び、実験の下書きを保存。
5. 対象記事編集の「配置実験への参加」でこの実験を選び、全体保存。
6. 「配置テスト」で「開始を予約」。対象記事で「変更を公開」を押し、サイト反映を待ちます。
7. Aは末尾1枠、Bは本文1枠。非選択側は非表示でマウントされず、AdSenseリクエストも発生しません。HTML解析時、最初の描画前に割り当て、同じdocument中は切り替えません。Cookieや永続IDは追加しません。
8. 少なくとも14計測日、各パターン・mobile/desktop別200計測表示を確認目安とし、収益だけでなく本文到達、回遊、可視時間、LCP/INP/CLS、流入を併せて観察。自動採用・自動勝者判定はありません。

同じユニットでは公式収益をA/Bへ分離できません。別ユニットを使う場合はAdSense管理画面で手動作成し、広告設定へ登録してください。Aが他記事でも使われる場合、そのユニット収益をAだけの収益と扱えません。公式収益の分離が確認できるまでA/B収益・差分は未取得です。記事へのPV按分もしません。

## Analytics v2

reader-v1を維持し、新配置は `article-placement-v2` に分離します。`experiment_id` は初期実験のallowlist、`variant_id` はA/B/none、`placement_key` は文字種と長さを検証します。旧 `article-end-v1` と新配置を混ぜません。割当は広告ブロック環境でも計測を試みますが、GA4や同意設定で計測そのものが利用できない訪問は捕捉できません。

既存の `ga4_experience.sql` 内で追加パラメータを読み、同じ日次取得、D1 experience grain、93日表示上限、31日query上限・1GB既定課金上限を使用します。新しい定期Actions・有料サービスはありません。生の識別子、URL、クリック、広告iframe情報を測定イベントに追加しません。SQLは既存page_locationからquery/fragmentを除去して記事へ対応づけます。

管理の配置テスト表は端末別A/B、差分、期間、欠損・暫定・サンプル不足、割当・到達・広告・可視時間・vitalsを表示します。p75は既存の区分集計であり、正確な時間のp75推定ではありません。各50サンプル未満はinsufficient。既存の非公開Analytics dashboardと週次/月次レポートへ実験cohortを追加し、私的ChatGPT接続からも読める形を維持しています。

## 切り戻し

- 通常: 配置テストで「停止を予約」→対象記事の「変更を公開」→サイト反映完了。Aの末尾1枠へ戻ります。実施済みIDの再利用・再開は条件混在を避けるため禁止です。
- 配信時の緊急停止: Webビルドに `AD_EXPERIMENTS_ENABLED=false` を渡し、通常フローで再ビルド・配信。実験を含む公開版は既定の末尾配置を選びます。
- すべての新配置を停止: `MONETIZATION_PLACEMENTS_ENABLED=false` でWeb再ビルド。広告無効の記事は無効を維持し、有効な記事は旧末尾1枠へ戻ります。
- アフィリエイトは全経路で非表示のままです。DBをdrop・巻戻し・seedで上書きしません。0017は旧APIと共存できるexpand migrationです。

静的サイトなので管理操作だけで配信済みHTMLを瞬時に変更することはできません。公開処理かWeb再配信が完了するまでは旧公開版が続きます。生成中の失敗は既存の公開状態画面で確認し、再試行してください。

## 検証と制約

必須のdomain/contracts、実D1互換SQLiteを使うHTTPと公開snapshot、公開allowlist、割当、重複リクエスト・重複イベント、proxyのテストを追加しています。CIは既存の `pnpm run ci` に含まれます。

隔離したブラウザ用exportは `pnpm exec tsx scripts/monetization/fixture.ts` で `.artifacts/monetization/export` に生成します。`CONTENT_EXPORT_DIR` を絶対パスで設定すればWebをこのsnapshotからビルドできます。通常ビルドでは未設定にしてください。実際の記事・本番D1・Gitのexportは変更しません。

検証結果、実行コマンド、ブラウザ測定値は本書の検証記録へ記載します。実Google広告の表示・クリックテストは行いません。CMPのGoogle側の同意別配信や本番広告収益は、配信後に所有者が実設定で確認する必要があります。

未実装範囲: アフィリエイト本番renderer・提携申込・リンク取得・成果連携、複数同時実験・実施済み実験の再開、A/B公式収益の自動帰属、統計的勝者判定、AI自動最適化。いずれも今回の配信対象には含めません。

## 検証記録（2026-10-17 JST）

- `pnpm run ci`: 全体通過。URL 194/194、SEO 189/189、内部リンク5,841、画像13,914、Lighthouse6ページ×3回、性能スコア99。既存のlegacy parityは旧checkout不在でskipです。Lighthouseの詳細は `.artifacts/monetization/full-ci-summary.json` と `.artifacts/ci/lighthouse`。
- 最終追加分を含む `pnpm test`: 50ファイル、397成功、既存の期待失敗1件（WebMCPの未修正契約）。typecheck、lint、境界チェックと生成物チェックも通過。lintには既存AnalyticsExperienceの警告1件が残ります。
- `pnpm --filter @tomokichi/web typecheck`: Astro 82ファイル、error 0、warning 0（既存hint 17）。
- `pnpm exec tsx scripts/analytics/check-sql.ts`: Google BigQueryのsynthetic relationだけで既存集計と新layout／variant、allowlist外実験の拒否を確認。実訪問データを書き換えず、native exportを追加取得しません。
- `node scripts/monetization/browser-check.mjs`: 19シナリオ成功。管理画面で案件作成→キーボードによる本文位置選択→配置追加→案件割当→保存／再読込→実験の開始／停止。公開側は幅1,440／390／320px×A/B×filled／同意待ち相当／AdBlock相当の18条件です。
- 公開側の非選択枠はloader実行前にDOMから除去し、Googleの `push({})` による枠探索にも残しません。各表示で割当・広告対象は各1回、loader／pushは各最大1回。320pxはrequest 0。affiliate予定キーの文字、カード、リンク、空白枠は出ません。横はみ出しはありません。
- モック条件のCLS最大約0.0000771。実画像・実広告・本番CMPのフィールド結果を保証する値ではありません。INPは実訪問の操作サンプルが必要です。LCP/INP/CLSは既存web-vitalsとLighthouseを使い続け、本番反映後に端末別の標本を確認してください。
- ダークモードのカード／選択タブのコントラストと、モバイルの比較表の横スクロールを目視確認・修正。写真付き／テキスト／予約カードのpreviewは管理画面限定です。
- `git diff --check` 通過。Gitの `export/`、URL、記事本文の実データ、本番D1、AdSense設定、secretsに変更はありません。

再現する場合、先に通常buildで管理画面を生成し、別terminalで `pnpm exec tsx scripts/monetization/browser-server.mts` を起動します。このharnessはlocalhost:4178のみにbindし、インメモリDB・テスト認証・公開処理stubを使用します。公開Webのfixtureを生成してから、Web appの実行ディレクトリで `CONTENT_EXPORT_DIR=<絶対パス> pnpm exec astro build --outDir <絶対パス>/.artifacts/monetization/web` を実行し、リポジトリrootでbrowser-checkを起動してください。Chromeと、既存Lighthouse依存のpuppeteer-coreを使用します。browser結果とスクリーンショットは `.artifacts/monetization/` に保存されます。

この段階では第三者PRレビューと本番リリースは未実施です。本番反映前にレビューを行い、通常のmigration・配信フローを使用してください。新しいAdSenseユニットを作成する場合と、実Google CMP／同意別の確認は所有者の手動操作です。

## 最新main統合後の確認

2026-10-17 JST、CHAGEEサイト追加を含む `origin/main` を取り込みました。収益化の保存と公開待ちrevisionの更新を単一DB batchへ統合し、途中の参照制約違反で両方がrollbackされるテストを追加しました。本文位置を選んだ後に本文が変更された場合は選択を無効にし、古いoffsetで本文を分断しません。末尾配置もGUIから削除できます。

統合後は58テストファイル、434成功、既存の期待失敗1件です。GUIのキーボード操作・位置選択の無効化を含め、ブラウザ19シナリオも再度成功しています。配信率proxyは同じGA4観測のfilled/requestで計算し、実験cohortも含めます。AdSense公式のcoverageやActive Viewとしては扱いません。実際の非公開Analyticsの数値は公開リポジトリへ含めません。
