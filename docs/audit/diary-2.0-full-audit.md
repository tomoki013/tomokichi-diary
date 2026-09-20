# Tomokichi Diary 2.0 — 現行サイト完全監査と移行計画

作成日: 2026-09-20
対象:

- **現行サイト（本番）**: `https://tomokichidiary.com` — Next.js / Netlify。コードは本リポジトリ外（監査は外形観測と `migration/legacy-*.json` のベースラインで実施）
- **2.0（本リポジトリ）**: `main` @ `5af40d8`。Astro（`apps/web`）+ React Admin（`apps/admin`）+ Hono API（`apps/api`）+ MCP Worker（`apps/mcp-server`）。`tomokichi-diary-web.tomoki-ttttt.workers.dev`・`api.tomokichidiary.com`・`admin.tomokichidiary.com` に **deploy 済みだが、apex/www はまだ Netlify を向いている**

評価軸: 人間 / 検索エンジン / LLM / AI Agent の 4 者。

---

## 1. Current State

| 観点                                  | 現行（Next.js / Netlify）                          | 2.0（Astro / Cloudflare）                                                                                                 |
| ------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 記事数                                | 114 記事 + 8 固定ページ                            | 同（`export/` に全件移行済み、`import-report.json` で `missingRoutes: []`）                                               |
| 本番ドメイン                          | ✅ `tomokichidiary.com`                            | ❌ workers.dev のみ（`verify:live` は workers.dev に対して 194/194 通過）                                                 |
| Lighthouse（mobile, 2026-09-20 実測） | Home **64** / CHAGEE 記事 **59**。LCP 5.6s / 10.0s | Home **93** / 記事 **95**。LCP 3.1s / 2.8s                                                                                |
| JS                                    | 19〜21 ファイル・450〜480KB                        | 記事 0 ファイル、Home 1 ファイル 3KB                                                                                      |
| Web フォント                          | 41〜45 ファイル・500〜760KB                        | 0（システムフォント）                                                                                                     |
| 3rd party                             | GTM 173KB + GA                                     | **なし（GA4 も未設定）**                                                                                                  |
| 構造化データ                          | BlogPosting + BreadcrumbList（114 記事）           | Article + BreadcrumbList + WebSite                                                                                        |
| noindex                               | 31 URL（6 記事・25 その他）                        | 15 ルート + 6 記事（記事側の `noindex` で継承）                                                                           |
| 管理                                  | 不明（ファイルベースと推定）                       | React SPA + D1 + Cloudflare Access                                                                                        |
| AI/Agent                              | なし                                               | WebMCP（4 tool）+ 公開 MCP（4 tool + MCP App）+ `/knowledge/<slug>.json` — **ただし知識グラフに載っている記事は 3 / 114** |
| CI                                    | 不明                                               | `pnpm run ci`（format/lint/types/boundaries/knowledge/test 168/media/build/routes 194/seo 188/links 4319/perf）           |

**結論**: 「移行するかどうか」ではなく「いつ・どう切り替えるか」の段階にある。2.0 は現行を性能・構造・運用の全面で上回る一方、切替前に直すべきもの（§4 SEO-1 の og:image バグ、§11 の GA4 未設定、§12 の URL 変更判断）がある。

---

## 2. Architecture

### 2.1 構成（コードで確認）

```
export/ (committed content graph: MD + JSON)
   └─ parseExportFiles → ContentIndex (packages/application)
        ├─ apps/web  [...route].astro が routes.json を全走査 → 5 view（Article/Page/Location/Collection/Index）
        ├─ apps/web  /knowledge/<slug>.json, /search-index.json, sitemap.xml, rss.xml, robots.txt
        └─ export/knowledge/catalog.json → WebMCP（各記事 HTML に inline）・MCP Worker（bundle）

Admin (React, hash router) ─ same-origin /api ─▶ Hono API ─▶ D1 / R2
                                   ▲ Cloudflare Access (JWT 検証) or ADMIN_TOKEN
Public: POST /v1/contact (Turnstile + honeypot + IP hash rate limit), GET/POST /v1/likes/:id
```

- 依存方向 `apps → application → domain` は `scripts/check-boundaries.ts` が CI で強制。実際に `packages/` に framework import は無い（確認済み）。
- URL は `routes` テーブル（246 行: article 114 / redirect 59 / location 46 / static 14 / journey 7 / series 6）が正本。`_redirects` はそこから生成。
- 記事本文は Markdown（ADR 0001）、埋め込みは `{{embed:key}}`（ADR 0007）。
- 公開ビルドは D1 を読まない（ADR 0006）。`pnpm export:data` → commit → `astro build`。

### 2.2 設計上の評価

良い点:

- URL・SEO・リンク・性能が **CI で検査される**（`check:routes` は旧サイトの 194 URL 全てを対象、`check:seo` は canonical/h1/JSON-LD/noindex 退行/sitemap 整合）。
- 秘密情報がリポジトリに無い。deploy は手元から、CI は検査のみ（`ci.yml` のコメントに理由あり）。
- Access JWT の検証（`apps/api/src/access.ts`）は aud / iss / exp / iat / RS256 / kid を見る。`ADMIN_TOKEN` は定数時間比較。
- 移行 SQL は expand/contract を運用ルール化（`OPERATIONS.md`）。

弱い点（詳細は各章）:

- `IndexPage.astro` が 1642 行で Home / `/posts` / `/destination` / `/collections` / `/sitemap` / `/gallery` の 6 画面を 1 ファイルで持つ（`PAGES` マップで分岐）。
- 「AI 運営」のための書き戻し経路（Search Console → 修正候補 → 人間承認 → revision）は **設計上の受け皿（`ai_artifacts`、`AIProvider` port）はあるが、パイプラインは無い**。
- Admin は「記事一覧・編集・お問い合わせ」の 3 画面。ルート移動・場所/タグ管理・コレクション管理は API にはあるが UI が薄い。

---

## 3. Content Inventory

`export/articles.json` + `revisions.json` + relations から生成（本文文字数は空白除去後）。

### 3.1 分類

| 分類                                                  | 件数 | 例                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Guide / How-to（観光情報 `tourism`）**              | 47   | 空港アクセス ×6、市内交通 ×5、CHAGEE ×7、寺院/名所 ×8、決済/両替 ×4、ビザ ×1                                                                                                                                                      |
| **Travel diary（シリーズ `series`、日付順の旅行記）** | 58   | thai1-6, india1-7, spain1-7, france1-3, egypt1-4, greece1-3, turkey1-3, china1-4, malaysia1-3, singapore1-3, indonesia1-3, hokkaido1-2, vietnam1, travel-history1-2, sunset1, landscape1, architecture1-2, kyoto-view1, introduce |
| **Itinerary & cost（旅程&費用 `itinerary`）**         | 2    | thai-itinerary, europe-itinerary                                                                                                                                                                                                  |
| **Essay（単発企画 `one-off`）**                       | 7    | why-travelers-dont-return, developing-country-sunset, best-city-for-student, malaysia-before-thailand, malaysia-night-vibes, google-maps-bus-…, (introduce は series)                                                             |
| **Page**                                              | 8    | about, contact, faq, privacy, terms, cookies, editorial-policy, affiliates                                                                                                                                                        |

指示書の分類に対応させると: Country/City = `locations`（50: 大陸 3・国 15・都市 31）で表現、Spot = 記事タグ + `places`（**4 件のみ**）、Hotel = 0 記事、Restaurant/Cafe = 3 記事（paris-restraunt, spain-restaurant, CHAGEE 系）、Transportation = 17 記事、How-to = 12、Review = 2（lounge, trip.com）、Guide = 15。

### 3.2 孤立・薄い・重複

| 種別                                         | 件数         | 内容                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **本文内リンクが 0 本の記事**                | **62 / 114** | 旅行記 58 本の大半。関連記事カード（3 本）と前後リンク（時系列）でしか繋がっていない                                                                                                                                                                                                                 |
| **本文内で他記事から一度も参照されない記事** | **55 / 114** | 上記とほぼ重なる。spain1-7・france1-3・egypt1-4・greece1-3・turkey1-3 の旅行記全部と、`airport-access-kansai`・`bangkok-tourism`・`city-to-changi-airport`・`europe-itinerary`・`thai-itinerary`                                                                                                     |
| 薄い記事（< 1,000 字）                       | 8            | why-travelers-dont-return 705、sunset1 781、developing-country-sunset 808、india5 921、india-street-food-tips 960、travel-history1 968（uniqueness は高い）                                                                                                                                          |
| 現行で noindex の記事                        | 6            | best-city-for-student, developing-country-sunset, kyoto-view1, malaysia-before-thailand, sunset1, why-travelers-dont-return。2.0 でも `article.noindex` で継承（sitemap に含まれない・確認済み）                                                                                                     |
| Cannibalization 候補                         | 3 組         | (a) `wat-arun` ↔ `bankok-sandaijiin`（ワット・アルン見どころ）、(b) `putra-mosque-guide` ↔ `putra-mosque-ramadan-hours`（ピンクモスク）、(c) `shanghai-chagee-menu` ↔ `chagee-menu-explained`（CHAGEE 4 メニュー。前者「どれを頼む」後者「茶葉解説」で意図は分かれているが、H2 の商品名 4 つが同一） |
| 重複タグ                                     | 2            | `ワットアルン`(tag-01f24058) と `ワット・アルン`(tag-467422ed)。タグ 88 中 85 が `tag-xxxxxxxx` のハッシュ slug（URL は無いので害は無いが、将来タグページを作る時に全部付け直しになる）                                                                                                              |
| 外部画像欠損                                 | 2            | `/images/Singapore/jewel-rain-vortex.jpg`, `seletar-airport-arrival.jpg`（現行でも 404、OPERATIONS.md 記載済み）                                                                                                                                                                                     |

### 3.3 Cluster 化可能な塊

| Cluster                | 記事                                                                                                                                                                   | 状態                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **CHAGEE**             | 7                                                                                                                                                                      | ハブあり（§6）                                                    |
| **バンコク交通・空港** | airport-access-suvarnabhumi, airport-access-donmuang, route-of-arrival-to-arl, thai-transportation, bangkok-localbus, chaophraya-express, bangkok-tourism              | ハブ = `bangkok-tourism`（4,057 字）だが本文リンクは 1 方向       |
| **シンガポール空港**   | changi-airport-overnight, changi-airport-lounge, changi-airport-liquids, city-to-changi-airport, seletar-airport-to-city                                               | ハブ無し。`/destination/singapore/changi` が事実上のハブ          |
| **サントリーニ**       | santorini-tourism, santorini-transportation, airport-access-santorini, oia-sunset-guide, greece2                                                                       | ハブ = `santorini-tourism`                                        |
| **クアラルンプール**   | batu-caves-guide, putra-mosque-guide, putra-mosque-ramadan-hours, touch-n-go-how-much, city-to-sultan-abdul-aziz-shah-airport, chagee-kuala-lumpur-stores, malaysia1-3 | ハブ無し（`malaysia-before-thailand` がエッセイとして担っている） |
| **インド**             | india-visa（11,460 字・最大）, india-street-food-tips, bathing-ganga, india1-7                                                                                         | ハブ無し                                                          |
| **スペイン**           | spain1-7, spain-restaurant, omio-reservation, howtoget-mirador-del-valle, ashumina-pilgrimage                                                                          | ハブ = `europe-itinerary`（6,466 字）だが本文リンク 0             |

---

## 4. SEO

### 4.1 2.0 で修正が必要なもの（切替前）

| #         | 問題                                                                                                                                  | 対象                                                                                                                                        | 影響                                                                   | 推奨                                                                                                                                             | 優先度                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| **SEO-1** | **`og:image` / `twitter:image` / JSON-LD `image` が二重 URL**: `https://tomokichidiary.com/https://media.tomokichidiary.com/images/…` | `apps/web/src/views/ArticlePage.astro:30` — `absoluteUrl(mediaUrl(...))`。`mediaUrl` は既に絶対 URL。114 記事全部（ビルド済み dist で確認） | SNS シェアの画像が出ない、Google Discover / リッチリザルトの画像が無効 | `coverUrl = cover ? mediaUrl(cover.asset.storageKey) : null`。`check:seo` に「og:image が `https://` で始まり `/https://` を含まない」検査を追加 | **Critical**                                     |
| SEO-2     | JSON-LD `about` の Location が **slug**（`"name":"shanghai"`）                                                                        | `packages/seo/src/structured-data.ts:62` — `Location` に name が無く `entity.slug` を出している                                             | 機械可読性が落ちる（LLM も "shanghai" より "上海" を期待）             | `ArticleJsonLdInput.about` に `{ name, sameAs? }` を渡す。`content.locations.nameOf(id, "ja")` を ArticlePage で解決                             | High                                             |
| SEO-3     | `dateModified` が全記事 `2026-08-24`（import 日）                                                                                     | `articles.json` の `updatedAt`                                                                                                              | 「全記事が同日に更新」というシグナル。将来の本当の更新が埋もれる       | import 時の `updatedAt` を legacy の値に戻す（`legacy-seo.json` には無いので `publishedAt` を採用）か、公開時に `updatedAt` を触らない           | Medium                                           |
| SEO-4     | `publisher.logo` と `Person.url`                                                                                                      | `site.ts` の `publisherLogoUrl` は `/images/Introduce/introduce.jpg`（サイトドメイン、redirect 経由）。author `url: null`                   | E-E-A-T の識別が弱い。現行は `author.url = https://tomokichidiary.com` | `authors.json` に `url`（`/about`）と `sameAs`（SNS）を入れ、JSON-LD に `Person.url` / `sameAs` を出す。logo は media ドメインを直接             | Medium                                           |
| SEO-5     | タイトル区切りが `｜`（全角）に変わる。現行は `                                                                                       | `                                                                                                                                           | `site.ts` `titleSeparator`                                             | 全 188 ページの `<title>` が一斉に変わる。順位影響は小さいが CTR 計測が切れる                                                                    | 意図的なら OK。切替後 2 週間は GSC の CTR を見る | Low |
| SEO-6     | `check:seo` は `og:image` の妥当性・`twitter:image`・`article:published_time` の存在を見ない                                          | `scripts/check-seo.ts`                                                                                                                      | SEO-1 が CI をすり抜けた                                               | 検査項目を追加（§14 テスト）                                                                                                                     | High                                             |
| SEO-7     | Home の LCP 3.1s（mobile）: 17 画像 857KB                                                                                             | `IndexPage.astro`（hero + gallery + カード）                                                                                                | Lighthouse 93 止まり                                                   | hero 以外を `loading="lazy"`、gallery の初期表示枚数を減らす、hero に `fetchpriority="high"` + 640px 版                                          | Medium                                           |

### 4.2 URL 変更の判断（§12 と対）

2.0 は記事 URL（`/posts/*`）を凍結する一方、**現行 sitemap にある 37 URL を 301 で移動**する（`/destination/<city>` → `/destination/<country>/<city>` ×24、`/journey/*` → `/collections/*` ×8、`/series/*` → `/collections/*` ×7（現行は noindex）、`/privacy` `/terms` `/cookie-policy` `/editorial-policy` → `/legal/*`）。

- 301 なので評価は概ね引き継がれるが、**検索インデックスの入れ替えに数週間かかる**。`/destination/bangkok` のような都市ページが実際に検索流入を持つなら、その期間は流入が揺れる。
- **判断に必要なデータ**: Search Console の「ページ」レポートで `/destination/*` `/journey/*` の直近 3 か月クリック数。合計が全体の 5% 未満なら移動を受け入れ、それ以上なら `/destination/<city>` を canonical のまま 2.0 でも出す（routes テーブルに `isCanonical` を立てるだけで可能。ADR 0002 の設計がこれを許す）。
- 現行は `Host:` 行と `Disallow: /posts?` `/affiliates?` を robots.txt に持つ。2.0 の `robots.txt.ts` は `renderRobotsTxt(seoConfig, { disallow: ["/admin"] })` のみ（確認済み）。クエリ付き URL の Disallow は消える。2.0 はクエリで別コンテンツを出さないので実害は無いが、`/admin` は別ホストなので Disallow の意味も無い。現行と同じ行を出すか、消すかを決めて `renderRobotsTxt` の入力に書く。

### 4.3 現行サイト（外形観測）

- 全記事に canonical・description・BlogPosting・BreadcrumbList あり。h1 は 186/194 で 1 つ。
- title 長は 40〜49 字が 79 ページで最頻。日本語では 30 字前後で切れるので、SERP では大半が省略される。2.0 は同じタイトルを引き継ぐ（変えるなら記事単位で `seoTitleOverride`）。
- hreflang なし（単一言語なので正しい）。2.0 は `buildHreflang` を持つが翻訳が無いので出ない（正しい）。

---

## 5. Content Clusters

推奨する **7 つの Hub**（既存記事を使い、新規は書かない）:

| Hub（既存 or 昇格）                                                                     | 配下                               | やること                                                                                            |
| --------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `shanghai-chagee`                                                                       | CHAGEE 6 本                        | §6                                                                                                  |
| `bangkok-tourism`                                                                       | バンコク 6 本 + 旅行記 thai1-6     | 本文に「交通・空港」セクションを作り 6 本へリンク。旅行記からハブへ 1 リンク                        |
| `santorini-tourism`                                                                     | 4 本 + greece2                     | 相互リンクは既にある。ハブから `oia-sunset-guide` への導線を上に                                    |
| **新設不要**: `/destination/singapore/changi`                                           | チャンギ 5 本                      | Location ページのテンプレートを「ハブ」として強化（§7）。記事側に「チャンギ空港の他の記事」ブロック |
| `europe-itinerary`                                                                      | spain1-7, france1-3, 交通・食 4 本 | 旅程記事の各日に該当旅行記へリンク（現在 0 本）                                                     |
| `india-visa`                                                                            | インド 3 本 + india1-7             | 最大記事（11,460 字）。冒頭に「インドの他の記事」を置く                                             |
| `malaysia-before-thailand`（エッセイ）→ 実務ハブは `/destination/malaysia/kuala-lumpur` | KL 7 本                            | Location ページ強化で対応                                                                           |

原則: **旅行記（58 本）は各記事から「その旅のガイド記事」へ 1〜2 本、ガイド記事から「その日の旅行記」へ 1 本**。全体で本文内リンク 0 の記事を 62 → 20 以下にする。これは記事の Markdown 編集（Admin から可能）で済み、コード変更は要らない。

---

## 6. CHAGEE Cluster

### 6.1 現状

| 記事                                       | 文字数 | 本文内 out | 本文内 in | ハブへの戻りリンク       |
| ------------------------------------------ | ------ | ---------- | --------- | ------------------------ |
| `shanghai-chagee`（ハブ）                  | 2,544  | 7          | 5         | —                        |
| `chagee-ordering-china-malaysia-singapore` | 2,939  | 6          | 6         | ✅（記事末のカード経由） |
| `chagee-menu-explained`                    | 2,693  | 2          | 6         | ❌                       |
| `shanghai-chagee-menu`                     | 1,665  | 3          | 6         | ✅                       |
| `shanghai-chagee-stores`                   | 3,046  | 4          | 2         | ❌                       |
| `chagee-kuala-lumpur-stores`               | 2,749  | 3          | 2         | ❌                       |
| `chagee-singapore-stores`                  | 3,047  | 3          | 2         | ❌                       |

- ハブは「知りたいことから探す」で 6 本すべてに目的別リンクを張っており、構造は正しい。
- **店舗 3 記事が相互に繋がっていない**（上海 ↔ KL ↔ シンガポール）。「別の国の店舗」への横リンクが無い。
- **店舗 3 記事と menu-explained からハブへ戻る本文リンクが無い**（関連カードに頼っている）。
- 検索意図の分担: ブランド認知（ハブ）/ 何を頼む（menu）/ 商品名の意味（explained）/ 注文手順（ordering）/ 店舗（3 都市）。**「価格」「日本上陸・日本の店舗」「アプリの登録手順（スクショ付き）」「初回特典・クーポン」が未カバー**。
- Geographic: 上海・KL・シンガポールの 3 都市。`locations` にも 3 都市が付いている。
- 知識グラフ: `chagee-menu-explained` のみ移行済み（facts あり）。他 6 本は backlog。

### 6.2 派生の判断

| 候補                                        | 判断                                 | 理由                                                                       |
| ------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| 価格（3 か国比較）                          | **書く価値あり（1 本）**             | 既存 3 店舗記事にレシート情報がある。「CHAGEE 値段」は一次情報で答えられる |
| アプリ登録・注文手順のスクショ版            | 既存 `ordering` に **追記**          | 新記事にすると ordering と食い合う                                         |
| 初回特典・クーポン                          | ordering の「会員特典」節を **拡充** | 変動情報なので `TravelFact(volatility)` 向き。単独記事は陳腐化する         |
| 日本の店舗                                  | **書かない**（体験が無い）           | 編集ポリシー（一次体験）に反する                                           |
| 上海 / マレーシア / シンガポール の追加店舗 | 訪問時に **既存店舗記事へ追記**      | 「実際に行った N 店舗」の N を増やす方が強い                               |
| 「CHAGEE とは」英語版                       | 保留                                 | hreflang 基盤はあるが、全体の多言語方針が先                                |

### 6.3 コード側の対応

- `content.relatedTo()`（`packages/domain/src/rules/related.ts`）はタグ・場所・カテゴリの重みで 3 本を選ぶ。CHAGEE 記事では同 cluster が出るので問題ない。
- 店舗 3 記事の末尾に「他の都市の CHAGEE」ブロックを **embed** で表現する案（`{{embed:chagee-cities}}`、ADR 0007 の型追加）か、単に Markdown で 3 リンクを書くか。**Markdown で書く**方が早く、embed は cluster が 3 つ以上になってから。

---

## 7. Internal Linking

### 7.1 仕組み（コードで確認）

| 経路                     | 実装                                                         | 状態                                               |
| ------------------------ | ------------------------------------------------------------ | -------------------------------------------------- |
| 本文内リンク             | Markdown `](./slug)` を `f6fd51e` で記事基準に解決しカード化 | 62 記事で 0 本                                     |
| 関連記事 3 本            | `content.relatedTo(id, 3)`                                   | 全記事                                             |
| 前後の記事               | `ArticlePage.astro:79-81` — **全記事の時系列**で前後         | 旅行記なら同じ旅、ガイド記事なら無関係な記事に飛ぶ |
| Location ページ          | `LocationPage.astro` — その場所の記事一覧                    | 46 ページ                                          |
| Collection ページ        | series 6 / journey 7                                         | 13 ページ                                          |
| パンくず                 | Home › 記事 › 国 › 都市 › 記事                               | JSON-LD と一致                                     |
| 記事ページの出リンク平均 | 4.85 本（`/posts/` 宛）                                      | 現行の中央値 24（nav 込み）より少ない              |

### 7.2 推奨

1. **前後リンクを「同じ collection 内」に限定**し、collection に属さない記事は「同じ primary location」内で前後を取る。`ArticlePage.astro:73-81` の 10 行の変更。
2. Location ページを Hub として整備: 「ガイド」「旅行記」「交通」をカテゴリ別に分け、都市ページから国ページへ、国ページから大陸へ。テンプレートは `LocationPage.astro` 1 か所。
3. 記事末の関連 3 本に加え、**同じ collection の全記事**（旅行記の目次）を出す。`content.collectionsOf(id)` + `membersOf` で取れる。
4. §5 の Markdown 編集（人手）。

---

## 8. LLMO

「LLM が理解しやすいか」を、機械が区別できるかで評価。

| 観点                         | 現状                                                                                                                                                                                | 評価                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 記事構造                     | `<article>` に h2/h3、TOC（`ArticleToc`）、`prose` クラス。`ArticleBody` は Markdown → HTML                                                                                         | ✅                                                                                        |
| Entity（場所）               | JSON-LD `about` に Place（**slug 名**）、パンくずに国・都市の日本語名                                                                                                               | △ SEO-2                                                                                   |
| Author                       | `Person` name のみ。`/about` に人物情報                                                                                                                                             | △ SEO-4                                                                                   |
| 日付                         | `datePublished`・`dateModified`（SEO-3）・**travel date**（`travelStartDate/EndDate`）は本文冒頭に表示されるが JSON-LD に無い                                                       | △ `Article` には `temporalCoverage` が使える。旅行日が「体験日」の最重要シグナル          |
| First-hand experience の区別 | `TravelFact.provenance = firsthand / official / researched / derived`、`ArticleKnowledge` の quick answer / decision / experience / current-fact / caution ブロック。**3 記事のみ** | ✅ 設計、❌ 適用率 2.6%                                                                   |
| Fact と Opinion              | 上記ブロックで分離。未移行記事は本文プローズのみ                                                                                                                                    | 同上                                                                                      |
| 機械可読投影                 | `/knowledge/<slug>.json`（3 件）、`/search-index.json`、RSS                                                                                                                         | △ 全記事分の JSON が無い                                                                  |
| `llms.txt`                   | 無し                                                                                                                                                                                | ❌ 低コストで追加可能（`/llms.txt` にサイト説明 + 記事一覧 + `/knowledge/*.json` の案内） |
| robots の AI クローラ方針    | `robots.txt.ts` は全 UA 許可（`PUBLIC_INDEXABLE` のみ）                                                                                                                             | 方針を明示するなら `GPTBot` 等を allow で明記                                             |
| 言語                         | `lang="ja"`、`inLanguage: ja`                                                                                                                                                       | ✅                                                                                        |

**最大の課題は知識グラフの適用率**。`migration-backlog.json` に 111 記事が `needs-human-review` で並び、各記事に `requiredChecks` 4 項目（一次体験と一般情報の分離、体験日の照合、現在情報の出典、重複表現の編集）が付いている。これは **人間の作業** であり、1 記事 30〜60 分。全件で 60〜100 時間。§14 で AI 支援を提案する。

---

## 9. WebMCP

### 9.1 実装（`apps/web/src/lib/webmcp.ts`, `WebMcpTools.astro`）

| Tool                        | 入力      | 出力                                                | 評価                                               |
| --------------------------- | --------- | --------------------------------------------------- | -------------------------------------------------- |
| `get_current_page_context`  | なし      | catalog 内の当該記事（facts, quickAnswer, sources） | **111 / 114 記事で `null` 相当**（catalog に無い） |
| `search_travel_content`     | `query`   | catalog 検索                                        | 検索対象が 3 記事                                  |
| `get_firsthand_experiences` | `query?`  | `provenance: firsthand` のみ                        | 同上（9 facts）                                    |
| `show_article_section`      | `heading` | h2/h3 に scroll                                     | ✅ 全記事で動く                                    |

- annotations は `readOnlyHint: true, consequentialHint: false` で正しい。
- **catalog 全体を全記事ページに inline**（`WebMcpTools.astro` の `payload`）。現在 10KB だが、114 記事分になると **記事 1 ページあたり 300〜400KB の inline JSON** になる。設計として破綻する。
- `search_travel_content` が catalog にしか当たらず、`/search-index.json`（全記事のタイトル・要約）を見ていない。

### 9.2 推奨 tool 設計

```
get_current_page_context   → catalog に無い記事は search-index の {title, summary, path, locations, travelDates} を返す（null にしない）
search_travel_content      → search-index.json（全 114）を fetch して検索し、catalog にある記事は facts を添える
get_firsthand_experiences  → 変更なし（catalog のみ。「検証済み」の意味を守る）
show_article_section       → 変更なし
list_related_articles      → 新規: relatedTo + 同 collection（サーバで計算済みの静的 JSON を fetch）
```

実装: `WebMcpTools.astro` の inline を **`articleId` と `catalogUrl` だけ**にし、catalog と search-index は `fetch()` で遅延取得。`check:agents` の `mcpAppBytes`（430KB）も同様に監視対象にする。

---

## 10. AI Agent Readiness

### 10.1 公開 MCP（`apps/mcp-server`）

- Streamable HTTP、stateless、read-only、認証なし。tool 4 つ（`search_travel_content` / `lookup_destination` / `get_firsthand_experiences` / `show_travel_evidence`）+ MCP App resource。
- `lookup_destination` は `search_travel_content` と同じ `queryCatalog({query})`。**差が無い**ので、`locations` を引数に取り Location ページの記事一覧を返す形にすると意味が出る。
- catalog は Worker に bundle。**deploy しないと更新されない**（`deploy:mcp` が release 手順に入っているので運用上は OK）。
- レート制限なし。読み取り専用・小さい catalog なので現時点は許容。Cloudflare の WAF rate rule を 1 つ置くのが安い。
- `verify:mcp` が本番に対する protocol/tool/filter/UI の疎通を検査する。良い。

### 10.2 Agent が安全にできること・できないこと

| 操作                 | 可否                                          | 経路                                     |
| -------------------- | --------------------------------------------- | ---------------------------------------- |
| ページ情報取得       | ✅（3 記事は facts 付き、他は title/summary） | WebMCP / MCP / `/knowledge/*.json` / RSS |
| firsthand 体験の取得 | ✅ 9 facts                                    | 同上                                     |
| 旅程・移動情報       | △ `TravelRoute` 2 件                          | 同上                                     |
| Spot 情報            | △ `places` 4 件                               | JSON-LD Place / MCP                      |
| 書き込み             | ❌ 全て read-only（正しい）                   | —                                        |

### 10.3 Agent 向けに足すもの

1. `/llms.txt` と `/llms-full.txt`（全記事の Markdown 連結は 40 万字程度。`export/articles/*.md` から生成できる）。
2. `/knowledge/index.json`（catalog + search-index の統合、全記事）。
3. `Article` JSON-LD に `temporalCoverage`（旅行日）と `isBasedOn`（出典 URL）。
4. MCP の `lookup_destination` を location 引数に。

---

## 11. Performance

### 11.1 実測（Lighthouse 12.6 mobile、2026-09-20、各 1 回）

| ページ           | Perf | FCP  | LCP   | TBT   | SI   | 総転送  | JS             | フォント       | 画像           |
| ---------------- | ---- | ---- | ----- | ----- | ---- | ------- | -------------- | -------------- | -------------- |
| 現行 Home        | 64   | 3.3s | 5.6s  | 190ms | 6.8s | 1,872KB | 19 files 453KB | 41 files 503KB | 11 files 524KB |
| 2.0 Home         | 93   | 1.4s | 3.1s  | 0     | 1.4s | 949KB   | 1 file 3KB     | 0              | 17 files 857KB |
| 現行 CHAGEE 記事 | 59   | 6.0s | 10.0s | 30ms  | 6.6s | 1,587KB | 21 files 484KB | 45 files 761KB | 1 file 39KB    |
| 2.0 CHAGEE 記事  | 95   | 1.1s | 2.8s  | 0     | 3.0s | 194KB   | 0              | 0              | 2 files 151KB  |

CI の Lighthouse は **desktop preset のみ**（`lighthouserc.json`）で Perf 100 を出しているが、mobile では Home 93 / 記事 95。CI に mobile を足すか、budget を mobile で切る。

### 11.2 Astro 移行で削減されるもの（現行 → 2.0）

| 項目         | 削減                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| JavaScript   | 453〜484KB → 0〜3KB（hydration なし。React は `WorldMap` の build 時描画にだけ使われ、クライアントには出ない） |
| Web フォント | 41〜45 ファイル → 0（システムフォント。デザイン上の判断としては要確認）                                        |
| 3rd party    | GTM 173KB → 0（**ただし GA4 を入れ直す必要がある**。§12）                                                      |
| 画像最適化   | Netlify Image CDN → R2 上の AVIF/WebP ラダー（`media:build`、`Picture.astro`）                                 |
| HTML         | 記事 60KB（inline WebMCP catalog 10KB 含む）。Home 190KB（**inline SVG 128KB** = WorldMap）                    |

### 11.3 2.0 で残る改善点

| #   | 対象                         | 内容                                                                                                                                                                                           | 優先度         |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| P-1 | Home の画像 857KB / LCP 3.1s | hero の `sizes` と初期表示枚数。gallery を below-the-fold で lazy                                                                                                                              | Medium         |
| P-2 | Home の inline SVG 128KB     | `WorldMap.astro` が d3-geo で全陸地パスを inline。外部 SVG（`/_astro/world.svg`、immutable cache）にして `<img>` か `<use>` で参照                                                             | Medium         |
| P-3 | WebMCP catalog inline        | §9。記事数に比例して膨らむ                                                                                                                                                                     | High（成長時） |
| P-4 | `_headers`                   | `Cache-Control` は `_astro/*` のみ immutable。HTML は Cloudflare 既定。`Content-Security-Policy` / `Permissions-Policy` / `Strict-Transport-Security`（ゾーン設定で可） 無し                   | Low            |
| P-5 | フォント                     | 0 ファイルは速いが、現行の 41 ファイル読み込みは Next.js の `next/font` が全 weight を preload していたため。2.0 でブランドフォントを 1〜2 weight だけ `font-display: swap` で入れる余地はある | 任意           |

---

## 12. Astro Migration（= 切替計画）

前提: 2.0 のコードは完成し deploy 済み。「Big Bang Rewrite」はすでに終わっており、残りは **ドメインの切替** である。ただし切替そのものは段階化できる。

### Phase 0 — 切替前の修正（1〜2 日）

1. SEO-1（og:image）修正 + `check:seo` 強化。
2. **GA4 導入**: `BaseLayout.astro` に gtag（または GTM）を **1 スクリプト** で。`analytics.ts` の `dataLayer.push` が既に GTM 前提の形なので GTM が自然。Search Console の所有権確認（DNS or HTML タグ）が Netlify 側の HTML タグなら、2.0 にも同じ meta を入れる。
3. SEO-2〜4 のうち SEO-2 と SEO-4（author url）。
4. `robots.txt.ts` の Disallow 行を現行に合わせるか判断（§4.2）。
5. §4.2 の URL 移動判断（GSC データが要る。**所有者の作業**）。
6. `verify:live https://tomokichi-diary-web.tomoki-ttttt.workers.dev` を再実行して 194/194 を確認（`.artifacts/ci/verify-live.json` は 2026-09-05 のもの）。

### Phase 1 — 影の並行運用（3〜7 日）

- Netlify を本番のまま、`www` だけ Cloudflare に向ける案は **やらない**（www/apex の canonical が割れる）。
- 代わりに Cloudflare 側で `tomokichidiary.com` の DNS を **プロキシ経由で Netlify に向けたまま**（Cloudflare が DNS/CDN、オリジンは Netlify）、Cloudflare Workers Routes を使って **一部パスだけ 2.0 Worker に切る**ことが可能。ただし `tomokichi-diary-web` は静的アセット Worker（`main` なし）で routes 指定が要る。段階化するなら:
  1. `/legal/*` と `/contact`（流入が少ないページ）を 2.0 へ
  2. `/destination/*`, `/collections/*`
  3. `/posts/*`（本体）
  4. `/`
- **推奨は一括切替**（Phase 2）。理由: (1) `_redirects` と canonical が全ページで整合している必要があり、部分切替は canonical と sitemap の二重管理になる、(2) `verify:live` が 194/194 を workers.dev で既に通している、(3) 切り戻しは DNS を Netlify に戻すだけ（Netlify のデプロイは残しておく）。

### Phase 2 — 切替（1 日）

```
1. 最終 `pnpm run ci` green、`export:data` 最新、`media:sync`
2. OPERATIONS.md の release 手順を最後まで（deploy:web まで）
3. Cloudflare DNS: apex / www を tomokichi-diary-web の custom domain に（wrangler.toml に routes を追加して deploy）
4. Netlify: サイトは削除せず、カスタムドメインを外すだけ（切り戻し用に 30 日保持）
5. verify:live https://tomokichidiary.com → 194/194
6. Search Console: sitemap を再送信（URL は同じ /sitemap.xml）、「URL 検査」で / と 3 記事をライブテスト
7. GA4 リアルタイムでイベントが届くことを確認
```

### Phase 3 — 観測（切替後 30 日）

- GSC: カバレッジ（301 で移動した 37 URL が「リダイレクト」に分類されること）、CWV レポート（mobile）、主要クエリの順位。
- CrUX / CWV の実測値が更新されるのは 28 日周期。
- Netlify 削除は 30 日後。

### 切り戻し条件

- GSC のクリック数が 2 週間で 30% 以上落ちる、または 5xx / 404 の急増。DNS を戻せば 5 分で復旧する。

---

## 13. Admin Architecture

### 13.1 現状（`apps/admin`）

- Vite + React 19、hash router、画面は `ArticleList` / `ArticleEditor` / `Messages` / `Login` の 4 つ。`ArticleEditor` に `MediaPanel` / `RelationsPanel` / `KnowledgePanel` を持つ。
- 認証は Cloudflare Access（cookie、same-origin `/api`）+ 任意の Bearer token（`localStorage`）。
- API には `routes/move`、taxonomy、collections の CRUD があるが、UI から到達できないものがある（ルート移動、コレクション編集、場所の追加）。
- 「公開」は `publish-check`（title/summary/body/route/cover+alt）を通してから pointer swap。良い。
- **公開後の deploy は手動**（`export:data` → commit → `deploy:web`）。Admin から「エクスポートして deploy」は無い。これは ADR 0006 の意図した二段階だが、運用者が 1 人なので「公開したのにサイトに出ない」が起きる。

### 13.2 提案（最小限）

| 項目 | 内容                                                                                                                                                                                                                                                                    | 規模               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| A-1  | Admin に「未エクスポートの公開変更」バッジ（D1 の `updatedAt` > `export/manifest.json` の `generatedAt`）                                                                                                                                                               | 小                 |
| A-2  | GitHub Actions `workflow_dispatch` で `export:data` → commit → `deploy:web` を回す **ワークフロー**（Cloudflare token は GitHub Environment secret に。`ci.yml` の「CI は ship しない」方針の例外として明示。あるいは手元の `pnpm release:content` スクリプトに留める） | 中                 |
| A-3  | ルート移動・コレクション・場所の UI                                                                                                                                                                                                                                     | 中                 |
| A-4  | Knowledge の一括レビュー画面（backlog 111 件を 1 画面で流す。`suggest-facts` の候補を並べて approve/reject）                                                                                                                                                            | 中〜大。§14 の前提 |
| A-5  | Search Console データの表示（§14）                                                                                                                                                                                                                                      | 中                 |

---

## 14. Automation Opportunities（AI 運営サイクル）

指示書の 8 段階サイクルを、既存の port / entity に対応させる。

```
材料           → Admin の下書き（ArticleRevision draft）。写真は media/ に置く
記事作成       → AIProvider port（packages/application/src/ports/ai.ts）。生成物は ai_artifacts（ADR 0004）。人間が revision に採用
公開           → publish-check → pointer swap → export:data → deploy（A-2）
GSC 分析       → 【無い】 GSC API から query/page の clicks/impressions/CTR/position を取り込む port（`SearchConsolePort`）と、D1 の `search_metrics` テーブル（日次）
離脱・CTR 分析 → 【無い】 GA4 Data API から page の engagement を取り込む。`AnalyticsPort` は「イベント送信」側しか無い
修正候補生成   → AIProvider に「記事本文 + GSC 上位クエリ + CTR」を渡し、title/description/追記候補を ai_artifacts に
人間承認       → Admin で artifact → revision に採用（既存の `adopt` 相当の use case を追加）
改善           → 公開 → export → deploy
```

### 設計の要点

1. **既存の境界を守る**: GSC / GA4 は `infrastructure/analytics/google` として port の実装にする。`packages/application` は API を知らない。
2. **書き込みは常に ai_artifacts → 人間 → revision**。AI が直接 revision を作らないのは ADR 0004・0009 の通り。
3. **最初の適用先は知識グラフの backlog（111 記事）**。`suggest-facts.ts` は既にある。AI が `candidate` を出し、人間が `verifyFirsthandCandidate` で確定する流れは実装済み。足りないのは A-4 の一括画面だけ。
4. Cron: Cloudflare Workers の Cron Trigger で日次に GSC/GA4 を取り込む Worker（`apps/insights`）。D1 に書くだけで、公開サイトには影響しない。
5. 「修正候補」の粒度は **title / description / 冒頭 1 段落 / 追記 H2** の 4 種に限定し、本文の書き換えは提案しない（一次体験の改変になる）。

---

## 15. Technical Debt

| 種別           | 内容                                                                                                                                                    | 対応                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 巨大ファイル   | `IndexPage.astro` 1,642 行（6 画面）。`PagePage.astro` 280 行に FAQ / Contact 分岐                                                                      | `HomePage` / `ArchivePage` / `DestinationIndexPage` / `CollectionIndexPage` / `SitemapPage` / `GalleryPage` に分割。挙動不変 |
| 二重 URL バグ  | SEO-1                                                                                                                                                   | 即修正                                                                                                                       |
| dead code      | `apps/mcp-server` の `lookup_destination` は `search_travel_content` と同一（§10）                                                                      | 差別化するか削除                                                                                                             |
| テスト         | 14 ファイル 168 テスト。`apps/web` は `webmcp.test.ts` のみ。**`packages/seo` の metadata テストは og:image の形を見ていない**。`apps/admin` にテスト 0 | §14 のテスト計画（`docs/testing/test-gap-analysis.md`）                                                                      |
| Lighthouse     | desktop のみ、`numberOfRuns: 3` だが CI では PERF 100 固定になり回帰検知になっていない                                                                  | mobile を追加し budget を mobile で切る                                                                                      |
| Likes API      | `POST /v1/likes/:id` に認証・レート制限なし。`visitorId` を変えれば無限に増やせる                                                                       | Cloudflare rate rule（IP あたり 10 req/min）か D1 に IP ハッシュ + 日次上限                                                  |
| CORS           | 本番 `ALLOWED_ORIGINS` に `http://localhost:4321` 等が含まれる                                                                                          | 実害は小さい（Access JWT は header なので CORS で漏れない）。環境ごとに分ける                                                |
| `_headers`     | CSP 無し。inline script（WebMCP, LikeButton）があるので nonce か hash が要る                                                                            | 切替後                                                                                                                       |
| タグ slug      | 85/88 がハッシュ                                                                                                                                        | タグページを作る時に slug を付け直す。今は放置                                                                               |
| 画像欠損       | 2 枚                                                                                                                                                    | 新しい写真が要る（コードでは直らない）                                                                                       |
| `dateModified` | 全記事 2026-08-24                                                                                                                                       | SEO-3                                                                                                                        |
| docs           | `README`・`ARCHITECTURE.md` は正確。`OPERATIONS.md` の release 手順に **DNS 切替の手順が無い**（まだ切り替えていないので当然）                          | §12 を OPERATIONS.md に転記                                                                                                  |

---

## 16. Recommended Roadmap

| 週       | 項目                                                                                               | 成果物                    |
| -------- | -------------------------------------------------------------------------------------------------- | ------------------------- |
| **W1**   | Phase 0（SEO-1/2/4、GA4、check:seo 強化、robots 判断、GSC で URL 移動判断）                        | PR ×3、GSC レポートの数字 |
| **W1**   | `docs/testing/test-gap-analysis.md` に沿って seo/webmcp/api のテスト追加                           | PR                        |
| **W2**   | Phase 2 切替（1 日）+ Phase 3 観測開始                                                             | OPERATIONS.md 更新        |
| **W2–3** | 内部リンク（§5, §7）: 前後リンクの collection 限定、Location ページのハブ化、Markdown 編集 20 記事 | PR + 記事更新             |
| **W3**   | CHAGEE: 店舗 3 記事の横リンク・ハブ戻り、価格記事 1 本、ordering の特典節拡充                      | 記事更新                  |
| **W4**   | WebMCP の遅延取得化（§9）、`/llms.txt`、`temporalCoverage`、`lookup_destination` の差別化          | PR                        |
| **W5–8** | 知識グラフ backlog: A-4 一括レビュー画面 → AI 候補 → 人間確定。まず CHAGEE 6 本と交通系 17 本      | 23 記事の facts           |
| **W8+**  | §14 の GSC/GA4 取り込み Worker と修正候補生成。IndexPage 分割。Home の画像・SVG 軽量化             | —                         |

---

## 付録 A. 検証コマンドと数字の出所

- 記事インベントリ: `export/*.json` を Python で集計（本文文字数は `bodyMarkdown` の空白除去後）。
- 内部リンク: `export/articles/*.md` の `](./slug)` `](/posts/…)` `](https://tomokichidiary.com/posts/…)` を集計。ビルド済み `apps/web/dist/posts/*.html` の `href="/posts/…"` でも再集計（平均 4.85 本）。
- Lighthouse: `node_modules/.pnpm/lighthouse@12.6.1/.../cli/index.js <url> --only-categories=performance,seo,accessibility,best-practices`（mobile 既定、headless Chrome、各 1 回）。結果 JSON は scratchpad に保存。
- 現行サイトの観測: `curl -sI` / `curl -s` で `/`, `/robots.txt`, `/sitemap.xml`, `/sitemap-0.xml`, `/posts/shanghai-chagee`, `/posts/sunset1`。
- sitemap 差分: 現行 161 URL vs 2.0 166 URL を `comm` で比較。
- og:image バグ: `apps/web/dist/posts/shanghai-chagee.html` の meta と JSON-LD、`ArticlePage.astro:30`。

## 付録 B. 問題ではなかったこと

- `check:routes` の 194 URL は現行 sitemap + 内部リンクから取った実 URL で、`verify:live` が workers.dev で全件通過。
- 現行で noindex の 6 記事は 2.0 でも noindex かつ sitemap 外。
- `trailingSlash: never` + `html_handling = drop-trailing-slash` で現行の挙動（末尾スラッシュ無し、スラッシュ付きは 301）を再現。
- Access JWT 検証は aud/iss/exp/署名を全部見る。`ADMIN_TOKEN` 未設定時は閉じる。
- Contact は Turnstile + honeypot + IP ハッシュ + `action=contact` + hostname 検査。メール送信なし（D1 保存のみ）。
- Media は R2 カスタムドメインが有効（`media.tomokichidiary.com/images/China/chagee-in-shanghai1.jpg` → 200）。

## 付録 C. クロスレビュー（2026-09-21）

- `ARCHITECTURE.md` に「いま何が deploy され、何が Netlify のままか」が無かったので冒頭に節と図を足した。監査 §1 と一致。
- `OPERATIONS.md` の Releasing は本監査 §12 の Phase 2 と整合するが、DNS 切替の手順そのものは持っていない。`RELEASE.md` に Cutover 節を置き、詳細は本監査 §12 を正とした。
- `astro check` が CI に入っておらず 2 error（`analytics.ts` の `dataLayer`、`PagePage.astro` の `path` prop 欠落）が残っていた。両方修正し、`TESTING.md` に「CI 外」と明記した。`PagePage` の `path` 欠落は固定ページ本文の相対リンクが解決されない実バグでもあった。
- `DECISIONS.md` の「未決定」5 件（URL 移動、GA4、`ADMIN_TOKEN`、保持期限、AI クローラ）は本監査 §4.2 / §12 / §15 と対応する。
- `SECURITY.md` の既知課題は本監査 §15 の likes / CSP / CORS / Dependabot と一致。
