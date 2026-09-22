# 旧ブログ（travel-diary）との暫定コンテンツ同期

最終更新: 2026-09-22。**切替（`tomokichidiary.com` → Diary 2.0）が終わったら丸ごと削除する**仕組みの設計と、初回統合の記録。

## 目的

`tomokichidiary.com` はまだ Next.js の旧サイト（`../travel-diary`）が配信している。切替までの間、
読者が旧実装を踏んでも新実装を踏んでも同じ記事内容になるようにする。恒久的な双方向同期にはしない。

```
Diary 2.0 (export/)  ──── 正本 ────┐
        │                         │
        ├─ pnpm content:parity ───┼─→ docs/migration/content-parity-report.md
        │                         │   CI: CONTENT_PARITY_MISMATCH
        └─ pnpm legacy:export ────┘→ ../travel-diary/posts/*.md（一方向）
```

## ルール

1. **正本は Diary 2.0**（`export/`）。旧側の内容で新側の文章を上書きしない。
2. **同期は NEW → OLD の一方向だけ。** OLD → NEW の自動取り込みは存在しない。旧側だけが変わった場合は
   `pnpm content:revise`（または Admin）で 2.0 に取り込み直し、`pnpm export:data && pnpm legacy:export` する。
3. **比較は `NormalizedArticle` で行う**（`scripts/legacy-sync/normalized-article.ts`）。
   `{{embed:…}}`、旧 URL → 新 URL の 301、Markdown 表の桁揃えなど、フレームワーク差は差分にしない。
4. **URL・slug・canonical・publishedAt は変えない。** 同期の join key は公開 URL（`/posts/<slug>`）。
5. **旧側だけが持つ frontmatter（`journeyId`, `travelTopics`, `costReport`, `promotionPrograms`, …）は保持する。**
   exporter が書き換えるのは `title`, `excerpt`, `description`, `updatedAt`, `noindex`, `heroImage` と本文だけ。
6. 旧側の本文が正規化後に新側と等しければ、旧ファイルの本文はバイト単位でそのまま残す（no-op の同期で diff を出さない）。

## 比較している項目

title / meta description（新: `seoDescriptionOverride ?? summary`、旧: `description ?? excerpt`）/ summary（旧 `excerpt`）/
publishedAt / updatedAt / noindex / canonical / cover（旧 `heroImage`）/ headings / body / images / internal links。

比較しない（テンプレート差として記録）:

- `robots`: 2.0 は `noindex, nofollow`、旧は `noindex, follow`。noindex の意図（6 記事）は一致している。
- meta description の切り詰め: 2.0 は 120 文字で切る。旧は切らない。新規に書く description は 120 文字以内にする。
- 旧側の `journeyId`（旅程タイムライン）。2.0 の journey collection から逆引きできないため、NEW_ONLY 記事を
  旧側に書き出すときは付かない（現時点で NEW_ONLY は 0 件）。

## 初回統合の記録（2026-09-22）

Phase 1〜2 のインベントリは `pnpm content:parity --report` の初回実行で得た。旧 114 記事 / 新 114 記事、
OLD_ONLY 0、NEW_ONLY 0、CONFLICT 12。旧リポジトリはローカルが 19 commit 遅れていたので先に `origin/main` へ
fast-forward した（2026-09-02 の改稿 3 本と 9 月の新規 5 本を含む）。

| slug | 差分 | 判断 | 結果 |
| --- | --- | --- | --- |
| egypt2 | 本文・updatedAt（旧が 2026-09-02 に「Correct Cairo sleeper train travel report」で修正） | **CONFLICT → 旧の改稿を採用。** 2.0 側は `imported from travel-diary` の revision 1 のままで独自編集がなく、「新側優先」で守るべき編集が存在しない。逆に旧側は著者による訂正で、これを 2.0 の古い本文で上書きすると訂正が消える | 2.0 に revision 2 として取り込み。`updatedAt` は著者が実際に直した 2026-09-02 |
| howtoget-abusimbel-from-asuwan | title・summary・description・本文（旧が 2026-09-02 に全面改稿） | 同上。知識グラフ（200 EGP / 3 時間半 / 金曜運休 / ハイエース）と改稿本文が矛盾しないことを確認 | 同上。TravelKnowledge は revision 2 に引き継ぎ |
| howtoget-mirador-del-valle | title・summary・description・本文（旧が 2026-09-02 に全面改稿） | 同上。L71 バス・徒歩ルートの fact と矛盾なし | 同上。TravelKnowledge は revision 2 に引き継ぎ |
| changi-airport-lounge / changi-airport-overnight / city-to-changi-airport / city-to-sultan-abdul-aziz-shah-airport / seletar-airport-to-city / thai-traditional-massage | 旧側だけ `description`（meta description）を持つ | 旧側だけの有効な情報（A: そのまま統合可能） | `seoDescriptionOverride` として取り込み。本文は変えていないので `updatedAt` は据え置き |
| city-to-changi-airport / seletar-airport-to-city | cover が違う。旧の `heroImage` は `public/` に存在せず本番でも 404 | 新側優先（旧は壊れている） | 旧側の `heroImage` を 2.0 の cover に置き換え |
| batu-caves-guide / changi-airport-liquids / putra-mosque-guide | 旧側だけ `description` | SEO リライト対象なので description を書き直した | 下記リライト |
| introduce / europe-itinerary / thai-itinerary / omio-reservation / trip_com-lounge-benefits | 初回インポート時の変換差（`{{embed:…}}`、`/journey` → `/collections`） | 内容差ではない | 正規化で吸収。旧ファイルは無変更 |

MANUAL_REVIEW に残した項目はない。

「新側優先」の適用範囲について: このルールは 2.0 側で行った編集を旧文章で巻き戻さないためのもの。2.0 側の
revision が初回インポートそのもの（`changeSummary: imported from travel-diary`, revision 1）で、旧側にその後の
著者編集がある場合は、旧側の方が新しい原稿なので採用した。以後はこの状況は起きない（旧側を直接編集しない）。

## SEO リライト（Search Console 2026-09-13〜19）

5 記事とも URL・slug・canonical・publishedAt は不変。`updatedAt` は 2026-09-22。本文にない事実は足していない。

| slug | 狙う検索語 | title | 主な変更 |
| --- | --- | --- | --- |
| batu-caves-guide | バトゥ洞窟 入場料 / 行き方 | バトゥ洞窟観光ガイド｜入場料・行き方・現地で迷いやすいポイント | 導入で入場料（無料/有料）・行き方・注意点を先出し。H2 を「入場料」「行き方」「迷いやすかったポイント」に。malaysia3 の一次体験（駅を出て直進、左に流されると別洞窟）を統合。putra-mosque-guide / malaysia3 / chagee-kuala-lumpur-stores へリンク |
| bangkok-localbus | バンコク バス 乗り方 / タイ バス 乗り方 | バンコクのローカルバス（赤バス）の乗り方｜タイのバス料金・乗車方法を実体験で解説 | 導入で乗り方 4 手順を先出し。H2「Google Mapsでバス路線を確認する方法」「乗り方4ステップ」「実際に乗って困ったこと」。google-maps-bus-developing-countries / travel-history2 / thai-transportation へリンク |
| paris-navigo-easy | パリ 電車 乗り方 / メトロ 乗り方 | パリの電車・メトロの乗り方｜チケットの選び方とNavigo Easyの使い方 | 交通全体（メトロ/RER/バス）を先に、チケット選び → Navigo Easy → 使い方（購入/チャージ/改札を H3）→ 実際に使って分かったこと。france2 / paris-restraunt / europe-itinerary へリンク |
| changi-airport-liquids | チャンギ空港 保安検査 / 手荷物検査 | チャンギ空港の保安検査と液体持ち込み｜手荷物検査・空ボトルの注意点 | H2 をターミナル別の検査場所 / 液体の扱い / 空ボトル / 実際に分かったことに。「私が利用した時点（2026 年 3 月）」と「執筆時点の公式案内」を分離。公式ルールは再確認していないので更新していない。changi-airport-overnight / -lounge / city-to-changi-airport へリンク |
| putra-mosque-guide | プトラモスク / 営業時間 | プトラモスク観光ガイド｜営業時間（見学時間）・行き方・ラマダン中の注意点 | 導入で見学時間を先出し。「営業時間（見学可能時間）」表記。H2「行き方」「実際に行って分かったこと」（T523 現金オンリー / バスの時間ズレを H3）。touch-n-go-how-much / batu-caves-guide / malaysia3 へリンク |

## 運用（切替まで）

```bash
pnpm db:restore-local                 # export/ からローカル DB を作り直す
pnpm content:revise revision.md       # または Admin で編集して export:data
pnpm export:data
pnpm legacy:export                    # ../travel-diary/posts を更新
pnpm content:parity --report          # 0 mismatch を確認
# commit: このリポジトリ（export/ + report）と travel-diary（posts/）。travel-diary を先に push する
```

MCP / WebMCP / `/knowledge/<slug>.json` / sitemap / JSON-LD はすべて `export/` から生成されるので、別途の更新はない。
`pnpm content:revise` は前 revision の TravelKnowledge を新 revision に引き継ぐ（`saveEditableKnowledge` 経由で検証付き）。

## 削除手順

`scripts/legacy-sync/README.md` のチェックリストどおり。`docs/migration/legacy-content-sync.md`（このファイル）だけ記録として残す。
