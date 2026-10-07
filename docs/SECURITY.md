# Security

最終更新: 2026-09-21。秘密の値は書かない。監査の詳細は `audit/diary-2.0-full-audit.md` §15、テストは `TESTING.md`。

## Threat surface

| 面                                             | 入口                                               | 守っているもの                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公開サイト（`tomokichi-diary-web`）            | 静的アセットのみ。Worker コード無し（`main` 無し） | 攻撃面が無い。`_headers` で `nosniff` / `Referrer-Policy`。CSP は未設定（inline script があるため nonce 化が要る）                                                                                                                                                                                                                                                                                                                       |
| `POST /v1/contact`                             | 誰でも                                             | Turnstile（`action=contact` + hostname）、honeypot、本文の検証、IP ハッシュのレート制限（Rate Limiting binding）、共通お問い合わせ基盤へ引き渡し。secrets / limiter 未設定なら **500 で閉じる**、基盤が受け付けなければ `?error=unavailable`                                                                                                                                                                                             |
| `GET/POST /v1/likes/:id`                       | 誰でも                                             | `visitorId` の形（20〜80 文字 ASCII）、公開記事のみ。**レート制限なし**（監査 §15）                                                                                                                                                                                                                                                                                                                                                      |
| `/v1/admin/*`                                  | Admin SPA（same-origin `/api`）/ 直接              | Cloudflare Access（hostname）+ Worker で JWT 再検証（aud / iss / exp / iat / RS256 / kid）または `ADMIN_TOKEN`（定数時間比較）。両方無ければ閉じる                                                                                                                                                                                                                                                                                       |
| `/v1/admin/inquiry/*`                          | Admin SPA                                          | 上の admin ゲートの内側。共通お問い合わせ基盤の `ProjectOperator` を Service Binding で呼ぶ（`props` で `tomokichi-diary` のみ許可。基盤側が一覧を絞り、他 Project のチケットは 404）。`admin.tmkch.io` と Access には何も置かない。送る本文はフィールド単位で組み立て直す（返信は本文と冪等キーのみ。宛先・件名は基盤が決める）。基盤のエラー詳細は返さない。操作者は Access の subject（メールアドレスではない）として基盤の監査に残る |
| `admin.tomokichidiary.com`                     | Access の裏                                        | Access のみ。Worker 自体は JWT を見ずに `/api/*` を service binding へ転送、静的アセットは配る。**セキュリティヘッダ無し**（Studio の `admin-web` と違う点）                                                                                                                                                                                                                                                                             |
| 公開 MCP（`/mcp`）                             | 誰でも                                             | read-only、stateless、catalog は bundle。認証・レート制限なし                                                                                                                                                                                                                                                                                                                                                                            |
| `/knowledge/*.json`, `/search-index.json`, RSS | 誰でも                                             | 公開記事の投影のみ                                                                                                                                                                                                                                                                                                                                                                                                                       |
| メディア（R2 custom domain）                   | 誰でも                                             | 公開バケット（意図的）。旧 `/images/*` は 301                                                                                                                                                                                                                                                                                                                                                                                            |
| CI                                             | GitHub Actions                                     | **Cloudflare の token を持たない**（deploy は手元から。`ci.yml` コメント）                                                                                                                                                                                                                                                                                                                                                               |

## Secret handling

- リポジトリに秘密は無い。`.env.example` は公開値のみ。
- API の secrets は `wrangler secret put --name tomokichi-diary-api`（`ADMIN_TOKEN`, `TURNSTILE_SECRET_KEY`, `IP_HASH_SALT`, `LIKE_HASH_SALT`）。`IP_HASH_SALT` を変えるとレート制限の履歴が切れる（害は無い）。
- `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` は vars（トークンの claim なので秘密ではない）。
- `ADMIN_TOKEN` は Access 導入後は **削除してよい**（`OPERATIONS.md` API_UNAUTHORIZED）。残っている間は 2 つの入口がある。
- Admin SPA は token を `localStorage`（remember）か `sessionStorage` に置く。同一 origin に第三者スクリプトが無いことが前提（`api.ts` コメント）。

## Authentication / Authorization

- 運営は 1 人。Role は無い（Access のメンバー = 全権）。
- 公開側に認証は無い。likes の `visitorId` はブラウザ生成の匿名 ID をハッシュして保存。
- Access JWT の検証は `apps/api/src/access.ts`。証明書は 1 時間キャッシュ、取得失敗時はキャッシュを使い、無ければ拒否。

## Data protection

| データ                 | 場所                   | 扱い                                                                                   |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| 記事・revision・関係   | D1 + `export/`（git）  | 公開情報。`export/` は vendor-neutral backup を兼ねる（ADR 0006）                      |
| お問い合わせ           | 共通お問い合わせ基盤   | 名前・メール・本文を `Intake` binding で基盤へ渡す。本 API は保存しない。IP は渡さない |
| 旧お問い合わせ         | D1 `contact_messages`  | 切替前の分のみ。送信者 IP は **salted hash のみ**。Admin でのみ閲覧                    |
| likes                  | D1                     | `visitorId` の salted hash のみ                                                        |
| AI 生成物              | D1 `ai_artifacts`      | 人が採用するまで表示に使わない（ADR 0004）                                             |
| メディア原本           | `media/`（git 外）+ R2 | 公開                                                                                   |
| 旧サイトのベースライン | `migration/*.json`     | URL・SEO・リンク。個人情報なし                                                         |

本 API が持つ個人情報は切替前の `contact_messages` だけ。保持期限のルールは無い（未決定。`DECISIONS.md`）。新しいお問い合わせの保持は基盤側の規則に従う。

## Encryption

- 通信: HTTPS（Cloudflare）。HSTS はゾーン設定（Worker では出していない）。
- 保存: D1 / R2 の暗号化は Cloudflare 既定。アプリ側の暗号化は無い。
- ハッシュ: SHA-256 + salt（IP、visitorId）。

## Logging policy

- API は `ctx.logger`（構造化）。`admin.authenticated` に email、`request.failed` にエラー message。**本文・メールアドレス・IP は出さない**。
- `x-request-id` を全応答に付け、エラー応答に含める。
- Workers Logs（`observability.enabled`）の保持は Cloudflare 既定。

## User content

- 記事は運営が書く。読者からの入力はお問い合わせと likes のみ。
- お問い合わせ本文は Admin に表示する際、HTML として描画しない（React の既定エスケープ）。
- Markdown 本文は `ArticleBody.astro` で HTML 化。埋め込みは型付き（ADR 0007）。生 HTML を本文に入れる経路は無い。

## Reporting process

- 読者: `/contact` フォーム（Turnstile）。
- 脆弱性: 同フォームか `about` に記載の連絡先。bug bounty は無い。
- 受け取った側: Admin の「お問い合わせ」（基盤の Operator API 経由）。切替前の分は「切替前の受信箱」。

## 既知の課題（監査より）

- `POST /v1/likes` のレート制限なし → Cloudflare rate rule か D1 の日次上限。
- Admin worker にセキュリティヘッダ（CSP / X-Frame-Options / Referrer-Policy）が無い。
- 公開サイトに CSP が無い（inline script: WebMCP、LikeButton）。
- 本番 `ALLOWED_ORIGINS` に `localhost` が含まれる（実害は小）。
- Dependabot 未設定。
