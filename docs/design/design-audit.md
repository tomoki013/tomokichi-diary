# デザイン監査と第1段の実装記録

- 日付: 2026-10-12
- ブランチ: `feat/design-system-tokens`
- 基準: [design-system.md](./design-system.md)（設計書 v1.0）
- 範囲: 公開サイト `apps/web` のみ（admin は対象外）。**フォントの変更は保留**（本人の指示）
- 本番反映: していない

## 1. 現状（変更前）

| 項目         | 状態                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| スタイル管理 | `apps/web/src/styles/` の素の CSS。`@layer tokens, base, layout, components, prose, pages, utilities` で順序を固定。Tailwind なし                                                     |
| トークン     | `tokens.css` に色・文字・余白・角丸・影を集約済み。ただし役割（semantic）ではなく見た目の名前（`--ink`, `--accent`, `--forest` …）                                                    |
| 色           | アイボリー `#fbfaf7`・ほぼ黒 `#171a16`・オレンジ `#b64b1c`・オリーブ `#46512e`。ほかにページ CSS の直書きがあった（地図のオリーブ `#87936a`、送信完了メッセージの緑、`#1d1c1a` など） |
| フォント     | Web フォントなし。本文はヒラギノ角ゴ→Noto Sans JP、見出しは游明朝→ヒラギノ明朝→Noto Serif JP、英字ラベルは Georgia、メモはヒラギノ丸ゴ                                                |
| 気分別 UI    | 体験ごとの色相（`--exp-hue`）とムード別の配色。意図的な個性として**今回は対象外**（本人の指示）                                                                                       |

## 2. 課題（変更前に見つかったもの）

| #   | 課題                                                                                                | 根拠                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | ブランドの主役となる色相が 4 つ（アイボリー/黒/オレンジ/オリーブ）＋直書きの緑                      | 設計書 §4.1 は 3 系統                                                                                  |
| 2   | フォーカスリングが薄いオレンジの帯で見えない（入力欄 5 か所）                                       | `--accent-tint` と白の比は **1.11:1**（必要 3:1）                                                      |
| 3   | 件数などの小さい文字に境界線の色を使っていた                                                        | `#bfc8bd` と背景の比は **1.65:1**（必要 4.5:1）                                                        |
| 4   | チップの枠が装飾用の線の色                                                                          | `#d9ded7` と背景の比は **1.31:1**（必要 3:1）。§4 の「入力欄などに装飾用ボーダーを流用しない」に反する |
| 5   | ホバー/選択中の件数がアクセント線の色                                                               | **1.54:1**                                                                                             |
| 6   | 送信ボタンの disabled 時に白文字が淡いグレーに乗る                                                  | **1.72:1**                                                                                             |
| 7   | タップ領域が 44px 未満のフィルタ・チップ（32〜37px）                                                | §6                                                                                                     |
| 8   | 選択状態を色だけで伝える箇所がある。カテゴリ・旅先・ギャラリーのフィルタに `aria-pressed` がない    | §3.2・§9                                                                                               |
| 9   | 余白トークンが 4/8px グリッドに乗っていない（5.6/9.6/14.4/22.4px …）                                | §6                                                                                                     |
| 10  | 文字サイズの下限が 12px（`--step-tiny`）。H3 が 17.6〜21px                                          | §5                                                                                                     |
| 11  | ボタンの役割が primary と「写真の上の白」しかなく、secondary はページごとに書いていた（404 ページ） | §6                                                                                                     |

## 3. 維持したもの

- ブランドコピー「一生モノの体験を、もっと身近に。」と全文言
- URL・canonical・title/description・robots・sitemap・構造化データ（ビルド後の検査で確認。§8）
- 気分別探索の配色とレイアウト（`pages-home-discovery.css` のシーン、`--exp-hue` のチップ）
- レイヤー構成とファイル分割
- システムフォント（保留中）

## 4. トークン（追加・変更）

`apps/web/src/styles/tokens.css`。既存の名前は残し、新しい semantic トークンへの**エイリアス**にした。一斉置換はしていない。

| Semantic token                  | 値        | 既存名（エイリアス）                            |
| ------------------------------- | --------- | ----------------------------------------------- |
| `--color-background-base`       | `#faf8f4` | `--bg`                                          |
| `--color-surface-base`          | `#ffffff` | `--surface`                                     |
| `--color-surface-warm`          | `#ebd5ca` | `--surface-warm`（新規）                        |
| `--color-text-primary`          | `#4c565b` | `--ink`                                         |
| `--color-text-secondary`        | `#606569` | `--ink-soft`, `--ink-faint`                     |
| `--color-brand-soft`            | `#c9927d` | `--accent-soft`, `--accent-line`                |
| `--color-brand-strong`          | `#97594e` | `--accent`                                      |
| `--color-brand-strong-hover`    | `#854b43` | `--accent-strong`                               |
| `--color-border-decorative`     | `#e8e5e0` | `--line`                                        |
| `--color-border-interactive`    | `#8d7f79` | `--line-strong`（入力・選択・チップ専用に限定） |
| `--color-focus-ring`            | `#4c565b` | `--focus-ring`                                  |
| `--color-state-error`（追加）   | `#a3362b` | —                                               |
| `--color-state-success`（追加） | `#3f6b4f` | —                                               |

派生値（3 系統の濃淡）: `--bg-sunk #f2eee8`, `--surface-alt #f3f0eb`, `--surface-dark #2f3639`（Warm Slate の暗色）, `--on-dark #faf8f4`, `--on-dark-soft #d5d9db`, `--accent-tint #f5ebe5`, `--accent-on-dark #e4b6a4`, `--line-mid #d6cfc9`（少し強い装飾線）, `--map-land #ece8e2`, `--map-visited #e0bfb0`。

その他:

- 文字: hero 32–48px、H1 30–40、H2 24–30、H3 20–24、small 14px、tiny 13px
- 余白: 4 / 8 / 16 / 24 / 32 / 48px
- 角丸: 8 / 12 / 16px
- 影: Warm Slate 系に統一
- `--tap: 2.75rem`（44px）

`--forest`（オリーブ）は削除した。

## 5. 変更内容

| 対象                   | 内容                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全体                   | フォーカスリングを `--focus-ring`（Warm Slate）に統一。ダーク面（フッター、写真ヒーロー、ライトボックスなど）では明色に切り替える（`base.css`）                                                               |
| 入力欄・検索（6 か所） | フォーカス時の薄いオレンジの帯を、境界色の変化＋1px のリングに変更                                                                                                                                            |
| Button                 | Primary / Secondary / Text の 3 役割と、hover / active / focus / disabled の状態を定義（`components.css`）。404 の副ボタンを共通の `.button--secondary` に置き換え、ページ固有の CSS を削除                   |
| Chip / Filter          | 高さ 44px。枠を interactive 色に変更。選択中は太字＋（下線 or 塗り）で示し、色だけに頼らない。カテゴリ・旅先・ギャラリーのフィルタに `aria-pressed` を付与（`IndexPage.astro`）。件数の文字色を可読な色に修正 |
| Article Card           | タイトルを 17px にして要約より一段上げた（主役の明確化）                                                                                                                                                      |
| Form                   | 送信完了/エラーを状態トークン＋左バーで表示（色だけに頼らない）。disabled のボタン文字を可読色に                                                                                                              |
| 地図                   | 行った国＝淡い Soft Clay、ピン＝Strong Clay（押せるもの）。オリーブは廃止                                                                                                                                     |
| 色の直書き             | オリーブ・緑・`#1d1c1a` などをトークンに置き換え。`theme-color` と `site.webmanifest` を `#faf8f4` に                                                                                                         |

変更ファイル: `tokens.css`, `base.css`, `components.css`, `layout.css`, `pages-article.css`, `pages-home.css`, `pages-home-discovery.css`（フォーカス色 2 か所のみ）, `pages-index.css`, `pages-static.css`, `views/IndexPage.astro`, `pages/404.astro`, `layouts/BaseLayout.astro`, `public/site.webmanifest`。

追加ファイル:

- `apps/web/src/__tests__/design-tokens.test.ts`
- `scripts/design/screenshots.mjs`
- 本書と `design-system.md`

## 6. コントラスト検証

`pnpm vitest run apps/web/src/__tests__/design-tokens.test.ts`（26 件すべて通過）。`tokens.css` を読み、エイリアスを解決してから計算するので、パレットを変えると自動で落ちる。

| 組み合わせ                                  |                 比 | 基準                             |
| ------------------------------------------- | -----------------: | -------------------------------- |
| 本文 `--ink` / 背景                         |               7.10 | AAA                              |
| 補助文字 `--ink-soft`・`--ink-faint` / 背景 |               5.56 | AA                               |
| リンク `--accent` / 背景                    |               5.14 | AA                               |
| 白 / Primary CTA                            | 5.45（hover 6.81） | AA                               |
| 本文 / `--surface-warm`                     |               5.34 | AA                               |
| 入力の境界 `--line-strong` / 背景           |               3.64 | 非テキスト 3:1                   |
| フォーカスリング / 背景                     |               7.10 | 非テキスト 3:1                   |
| `--on-dark` / `--surface-dark`              |              11.59 | AA                               |
| `--accent-on-dark` / `--surface-dark`       |               6.75 | AA                               |
| エラー文字 / 白                             |               6.73 | AA                               |
| 成功文字 / 白                               |               6.13 | AA                               |
| Soft Clay / 背景                            |               2.51 | 文字に使わないことをテストで固定 |

注意: `--ink-soft` は `--surface-warm` の上では 4.18:1 で基準に届かない。warm 面の上の文字は `--ink` を使う。

## 7. アクセシビリティ・レスポンシブ検証

| 項目                                  | 結果                                                       | 方法                                                                 |
| ------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| 320 / 768 / 1024px で横スクロールなし | ✅ 15 ページすべて                                         | Chrome headless で `scrollWidth > clientWidth` を確認                |
| コンソールエラー                      | ✅ なし（意図した 404 のリソースエラーのみ）               | 同上                                                                 |
| キーボードフォーカスが見える          | ✅                                                         | 375px で Tab 操作し、フィルタに 2px の slate リングが出ることを目視  |
| 選択状態が色以外でも分かる            | ✅                                                         | 太字＋下線/塗り。`aria-pressed` が true/false で切り替わることを確認 |
| タップ領域 44px                       | ✅ チップ・フィルタ・ボタン（computed `min-height: 44px`） |                                                                      |
| reduced-motion                        | ✅ 既存の `base.css` の対応を維持                          |                                                                      |
| フォーカスが固定ヘッダーに隠れない    | ✅ 既存の `scroll-padding-top` を維持                      |                                                                      |
| 200% 拡大                             | ⚠️ 未検証                                                  | 次段                                                                 |
| 画像の alt                            | 変更なし（既存の `usage.alt` を維持）                      |                                                                      |

## 8. 回帰テスト

| 検査                | 結果                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`         | ✅ 320 passed / 1 expected fail（既存の `it.fails`）                                                                               |
| `pnpm lint`         | ✅                                                                                                                                 |
| `astro check`       | ✅ 0 errors                                                                                                                        |
| `pnpm build`        | ✅                                                                                                                                 |
| `pnpm check:links`  | ✅ links 5841 / images 13914                                                                                                       |
| `pnpm check:routes` | ✅ 194/194                                                                                                                         |
| `pnpm check:seo`    | ⚠️ `SEO_NOINDEX_REGRESSION` が 40 件以上出る。**変更前のコードでも同じ件数が出る**ことを確認済み。今回の変更とは無関係の既存の問題 |
| GA4 などのイベント  | 変更なし（JS は `aria-pressed` の付け外しのみ追加）                                                                                |
| Web フォント        | 追加なし（パフォーマンスへの影響なし）                                                                                             |

## 9. 変更前後のスクリーンショット

`node scripts/design/screenshots.mjs <label>` で、主要 12 画面を 375px と 1440px で全画面キャプチャする（`content-visibility` は撮影時だけ解除）。

- `docs/design/screenshots/before/`
- `docs/design/screenshots/after/`

各 14MB 程度あるためコミットしない（`.gitignore` 済み）。必要なときにローカルで撮り直す。

## 10. 未解決・次段の候補

1. **フォント**（保留）: Noto Sans JP / Noto Serif JP の採用は表示速度とのトレードオフを決めてから。
2. **主色の変更**: 2026-09 の UI 刷新で本人が「オレンジ基調維持」を選んでいた。設計書 v1.0 に従い Soft Clay / Strong Clay（くすんだテラコッタ）に置き換えたので、見た目の印象はやや落ち着いた方向に変わる。
3. **ヒーローの可読性**: 写真の上の文字は既存のオーバーレイのまま。写真ごとの実測による検証はしていない。
4. **カード比率**: 現状 3:2（モバイルは 1:1）。設計書は 4:3 を「比較後に確定」としているため未変更。
5. **密度**: チップやフィルタを 44px にしたので、ギャラリーの国フィルタが 375px で 4 行から 5 行に増えた。横スクロール化などは次段で検討。
6. **ムード（体験ごと）の配色**: 方針により対象外。シーン内の文字コントラストは個別には未検証。
7. **文字サイズのばらつき**: ページ CSS に `font-size` の直書きが約 160 か所残っている。段階的にトークンへ移す。
8. **`IndexPage.astro` の 3 種のフィルタ**（カテゴリ / 旅先 / ギャラリー）は同じ下線タブの CSS を 3 回書いている。共通部品にまとめる余地がある。
9. 200% 拡大と、実機（iPhone Safari）での確認。
