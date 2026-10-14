# Test Gap Analysis — Tomokichi Diary 2.0

作成日: 2026-09-21
追記（2026-10-13）: 記事末尾広告は、本番hostname制限（別サブドメインも拒否）、page loadとviewport接近まで外部通信しないこと、二重初期化/二重リクエスト防止、固定幅が収まらない画面、script失敗時の非再試行を振る舞いテストで検証。Google CMPの地域判定・同意拒否後の配信/実在広告の表示は本番手動検証対象であり、ローカル/Lighthouseから広告リクエストを送らない。
前提: `docs/audit/diary-2.0-full-audit.md` の発見を、「壊れたときの影響が大きい順」にテストへ落とす。Coverage の数字は目標にしない。

## 1. Current Test（2026-09-21 時点）

| 層                          | ファイル                                                                                          | 件数  | 何を守っているか                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain                      | `packages/domain/src/__tests__/{publishing,routing,knowledge,listing,contact,primitives}.test.ts` | 約 60 | 公開条件、ルート解決/ループ、firsthand の人間確認、一覧/関連/場所ツリー、お問い合わせ検証/スパム/レート、slug/日付/Markdown 構造                  |
| seo                         | `packages/seo/src/__tests__/seo.test.ts`                                                          | 13    | title/description/robots/OG/hreflang/JSON-LD/sitemap/RSS/robots.txt                                                                               |
| contracts                   | `packages/contracts/src/__tests__/validation.test.ts`                                             | 5     | 入力検証の網羅報告                                                                                                                                |
| infra                       | `infrastructure/database/d1/src/__tests__/{migrations,repositories,restore}.test.ts`              | 5     | migration の冪等、content hash 重複、snapshot が published のみ、seed 復元                                                                        |
| api                         | `apps/api/src/__tests__/api.test.ts`                                                              | 12    | token 認証・閉鎖、検証、knowledge 保存、記事ライフサイクル、media                                                                                 |
| web                         | `apps/web/src/lib/__tests__/webmcp.test.ts`                                                       | 4     | WebMCP 4 tool の基本動作、登録/解除                                                                                                               |
| mcp                         | `apps/mcp-server/src/__tests__/protocol.test.ts`                                                  | 3     | tool 一覧、firsthand 限定、MCP App resource                                                                                                       |
| 組込テスト（`pnpm run ci`） | `scripts/check-{routes,seo,links,knowledge,agent-surfaces}.ts`, `perf.ts`                         | —     | 旧 URL 194 の解決、built HTML の title/description/canonical/h1/JSON-LD/noindex 退行/sitemap、内部リンク 4,319、画像 9,434、Lighthouse（desktop） |

思想: domain は純関数で網羅、統合は「生成物（dist）を検査する」。この思想は壊さない。**追加するテストも、可能な限り `scripts/check-*` の検査項目の追加か、純関数の単体テスト**にする。

## 2. Risk Map

2026-10-11 一括公開: HTTPテストで複数の保存済みページの公開、カバー不足の拒否、非選択の記事の下書き維持、個別公開APIの後方互換、認証を検証。公開要求のテストで反映待ちの永続化と起動延期を確認。管理画面の公開処理テストで部分成功時の続行と1回の反映開始、全件拒否時の起動なし、通信結果不明・起動失敗・セッション切れの結果保持を確認する。Chromeのローカル管理画面では3件中2件の公開と失敗理由・再選択の表示、公開済み2件の保存済み変更の一括公開、絞り込み後の件数・選択解除を実操作で確認。APIの起動記録でも各一括操作につき反映開始が1回であることを確認した。

2026-10-10 管理画面の修正: Access認証ヘッダー・Cookie・本文を保持するプロキシ、公開要求の未設定/失敗/再試行/競合、予約公開、固定ページ、公開版への下書き混入防止を自動テストで確認。Markdown画像のエスケープとD1 RESTの単体/一括クエリ契約も検証する。写真アップロード、本文のカーソル位置への挿入、関連付けを含む一括保存、未保存状態からの公開、離脱警告はローカル管理画面で実操作確認済み。サイトの反映状態は `site_publication` に記録するため、T-9の機能未実装状態は解消。

Probability（壊れる可能性）× Impact（壊れたときの影響）。

| 領域      | 機能                                                           | P                  | I   | Risk         | 現状のテスト                                                                         |
| --------- | -------------------------------------------------------------- | ------------------ | --- | ------------ | ------------------------------------------------------------------------------------ |
| SEO       | og:image / JSON-LD image の URL 形（**実際に壊れていた**）     | 高                 | 高  | **Critical** | 無し（`check:seo` は og を見ない）                                                   |
| Migration | 旧 URL 194 が解決する                                          | 低                 | 高  | High         | `check:routes` + `verify:live` ✅                                                    |
| SEO       | canonical / robots / sitemap 整合                              | 低                 | 高  | High         | ✅                                                                                   |
| Content   | 記事に canonical route・cover・alt がある                      | 中                 | 高  | High         | `validatePublishable` ✅（domain）、export 済み全件は `check:seo` の h1 経由で間接的 |
| Content   | slug / route の不変（`/posts/*` 凍結）                         | 低                 | 高  | High         | `routing.test` + `check:routes` ✅                                                   |
| WebMCP    | catalog に無い記事で `get_current_page_context` が **null**    | 高（111/114 記事） | 中  | High         | 無し（既存テストは catalog にある記事のみ）                                          |
| WebMCP    | 不正入力（query が非文字列、巨大文字列）                       | 中                 | 低  | Medium       | 無し                                                                                 |
| API       | `/v1/contact`: Turnstile 失敗・honeypot・未設定（500）・レート | 中                 | 高  | High         | domain は ✅、**HTTP 層は無し**                                                      |
| API       | `/v1/likes`: visitorId 検証、存在しない記事                    | 中                 | 低  | Medium       | 無し                                                                                 |
| API       | Access JWT 検証（`verifyAccessJwt`）: aud / iss / exp / 署名   | 低                 | 高  | High         | 無し（本番は Access が前段だが、defence in depth の主張が未検証）                    |
| API       | admin 未認証 / 誤 token / token 未設定                         | 低                 | 高  | High         | ✅                                                                                   |
| Migration | 切替時の URL 維持                                              | 低                 | 高  | High         | `verify:live` ✅（手動）                                                             |
| Admin     | 公開 → export → deploy の二段階                                | 中                 | 中  | Medium       | `restore.test` が seed 復元を見る。「export が最新か」の検査は無し                   |
| Perf      | mobile の LCP/CLS 予算                                         | 中                 | 中  | Medium       | desktop のみ                                                                         |
| Knowledge | firsthand の人間確認、migration backlog                        | 低                 | 高  | High         | ✅ + `check:knowledge`                                                               |

## 3. Missing Test → Recommended Test

2026-10-10: 本文写真のサイズ修正はローカル記事ページで desktop / mobile の表示寸法・縦横比・横はみ出し・未読み込み画像の寸法確保を確認。画像サイズの CSS はブラウザで検証し、CSS の値を写すだけのユニットテストは追加しない。

| #   | Risk     | テスト                                                                                                                                                           | 種類                                           | 場所                                                                                                             | 状態                                                                 |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| T-1 | Critical | built HTML の `og:image` / `twitter:image` / JSON-LD `image[]` が **単一の絶対 URL**（`https://` で始まり `/http` を含まない）                                   | `check:seo` の検査項目 + 抽出関数の単体テスト  | `scripts/lib/page-seo.ts` + `scripts/lib/__tests__/page-seo.test.ts` + `check-seo.ts` に `SEO_IMAGE_URL_INVALID` | **追加済み**（本コミット）。`ArticlePage.astro:30` の 1 行修正を伴う |
| T-2 | High     | `verifyAccessJwt`: 正しい RS256 トークンを受理し、aud 不一致 / iss 不一致 / exp 切れ / 署名改竄 / alg=none を拒否                                                | unit（WebCrypto で鍵生成、`fetch` を差し替え） | `apps/api/src/__tests__/access.test.ts`                                                                          | **追加済み**                                                         |
| T-3 | High     | `/v1/contact`: honeypot は `?sent=1` で黙殺、Turnstile 失敗は `?error=challenge`、secret 未設定は 500、短すぎる本文は `?error=invalid`、成功は 303 + D1 に 1 件  | HTTP（`createApp({ verifyChallenge })`）       | `apps/api/src/__tests__/contact.test.ts`                                                                         | **追加済み**                                                         |
| T-4 | High     | WebMCP: catalog に無い記事の `get_current_page_context` は null ではなく最低限の文脈（title/path）を返す                                                         | unit                                           | `apps/web/src/lib/__tests__/webmcp.test.ts` に `it.fails`（現状は null。§9 の改修で反転）                        | **追加済み（`it.fails`）**                                           |
| T-5 | Medium   | WebMCP: `query` が非文字列/空/2,000 文字でも throw しない                                                                                                        | unit                                           | 同上                                                                                                             | **追加済み**                                                         |
| T-6 | Medium   | `/v1/likes`: 不正 visitorId は 400、未知記事は 404、同じ visitor の 2 回目は取り消し                                                                             | HTTP                                           | `apps/api/src/__tests__/likes.test.ts`                                                                           | **追加済み**                                                         |
| T-7 | Medium   | export の整合: 全 published article に canonical route が 1 本、`article.noindex` と sitemap の整合（`check:seo` が dist で見ているが、export 単体で早く落とす） | unit（`export/` を読む）                       | `packages/data/src/__tests__/export-invariants.test.ts`                                                          | 未着手（`check:seo` が同等を保証しているため優先度を下げた）         |
| T-8 | Medium   | Lighthouse mobile 予算                                                                                                                                           | `lighthouserc.json` に mobile 設定を追加       | —                                                                                                                | 未着手（CI 時間 +3 分。切替後に）                                    |
| T-9 | Medium   | Admin: 「未エクスポートの公開」検知                                                                                                                              | unit（D1 updatedAt vs manifest.generatedAt）   | —                                                                                                                | 未着手（機能自体が未実装）                                           |

## 4. Edge cases の扱い

- **empty / null / unexpected**: T-3（空 form、body 無し）、T-5（query 非文字列）、T-6（visitorId 空）。
- **duplicate**: 既存 `refuses a duplicate slug`、`deduplicates identical uploads`。
- **timeout / network**: Turnstile の verify を注入して失敗させる（T-3）。Access の証明書取得失敗（T-2: `fetch` が非 200 → null）。
- **unauthorized / partial failure**: T-2、既存 authentication。
- **concurrency**: D1 の likes toggle は単一行更新。並行は D1 が直列化するので対象外。

## 5. Definition of Done

- [x] Critical path（T-1）に自動テストがあり、`pnpm run ci` で走る
- [x] High（T-2, T-3, T-4）が `pnpm test` で走る
- [x] flaky なし（ネットワーク・時刻に依存しない。JWT の exp は固定時刻で生成）
- [x] 各テストの意図は本ファイルとテスト内コメントに記載
- [ ] T-7 〜 T-9 は切替後

2026-10-10: 0013の回帰テストは `/collections/*` 正本復元、旧trips/journeyの直接301、ループ防止、言語分離、連載・未対応URL維持、冪等性を検証。予約公開の既存テストは共通application use caseを通り、GitHub Actionsからも同じ公開判定を使う。

追加監査: 強制配信の初回・既配信内容・開始中に届いた新規編集を公開状態の回帰テストで検証する。キーボード保存は処理中の重複呼び出しを防ぎ、一覧件数はフィルター結果を表示する。

2026-10-11: 配信jobはCheckと別の空のcheckoutで実行される。root buildに依存パッケージの型生成を含め、既存CIのtypecheckに頼らず、クリーンビルドでもMCPの型検査を成功させる。

## Analytics v2（2026-10-13）

High risk: 日付/前期間/閏年、URL host・redirect・canonical、GSC加重順位/CTR/粒度、distinct非加算、欠損と0、日別payload validation、D1置換の冪等/遅延再取得/backfill/rollback、水位非後退、HTTP retry/401/403、SQL入力検証、Access認証/private cacheを自動テスト追加。AdSense disabled/空実績/通貨/truncation、Affiliate共通adapterの重複も検証。ライブBQは7日bounded queryとdry runを読取検証済み。本番WIF/Actions→D1、全履歴照合、本番Admin、AdSense OAuth/ページ別収益は手動移行ゲートとして未完了。期間unique人数の別集計cache・日次非加算・古いcache非表示・windowの日付制限もテスト追加。

## Analytics v2 広告・読書体験の追加検証（2026-10-13）

| Risk                                                   | 検証                                                                                      | 残る制約                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| High: preview/CHAGEEサブドメインへの計測、背景時間混入 | readerMeasurement.test.tsのhost除外、候補座標、重複防止、可視時間差分、送信フィールド限定 | GA4同意・block・ブラウザ送信失敗による欠測は復元しない            |
| High: 広告視認の過大評価・広告追加                     | ads.test.tsのfilled前、可視中断、連続1秒、単発request/error、狭幅・host除外               | proxyを公式Active Viewとして扱わない。クリック/iframeは観測しない |
| High: 日次率/p75の誤加算、端末/記事の混同              | experience.test.tsの期間累積、端末/記事/layout分離、欠測、50件未満の速度判定              | 前後比較だけでは因果効果を示さない                                |
| High: BQ SQLの個人情報/任意文字列/別サイト混入         | check-sql.tsの合成fixture実BQ方言検証と本番bounded dry run                                | 実イベントは導入後の日次export待ち。過去を0で埋めない             |
| Medium: AdSenseユニットの二重加算・重複・未完レポート  | analytics.test.tsのsite/unit grain分離・重複拒否・domain filter                           | OAuth完了後の実API互換性・実績は別途確認する                      |

## 2026-10-14: ChatGPT private analytics

Owner identity + read scope fail-closed、匿名/偽token、公開hostのconsent拒否、Access専用identity（共有admin token拒否）、跨origin POST、client表示文字列escape、OAuth metadata・PKCE code exchange・code replay拒否・refresh・resource違い拒否、認証済みMCP tools/listと未生成report読み取り、Admin binding経路を検証。公開MCPの既存ツール集合も継続確認。実ChatGPTのOAuth認証・ツール呼び出しと定期実行はproduction接続後の確認対象で、mock成功から稼働済みと判断しない。AdSenseは実Google APIでapex/www・広告client・unit grainの条件を検証、他hostの指定をテストで拒否。
