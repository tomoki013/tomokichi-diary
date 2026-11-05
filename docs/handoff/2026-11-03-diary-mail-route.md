> 2026-11-05 更新：この引き継ぎのメール設定作業は完了。以下は当初の依頼の記録です。
>
> 現在は Diary API のフォーム通知が noreply@tomokichidiary.com、一次受付と管理画面からの返信が contact@tomokichidiary.com。一次受付には受付番号と問い合わせ本文だけの引用を付け、問い合わせ者だけへ送信します。Gmail 宛ての CC・受信原本の転送は行わず、Gmail にはフォーム新着通知だけを送ります。
>
> 相手から contact 宛てに届いた返信は Cloudflare Email Routing → tomokichi-mail-ingress → 同じチケットへ追記。運営は管理画面から返信します。Core は inquiry-platform v0.11.3、Diary SDK は v0.10.0。専用 Resend キーは Core と Diary API の Secret に登録済みです。
>
> 反映済み PR：Diary #175、Studio #135・#136・#137、inquiry-platform #26。現在の運用設定は [Studio の運用文書](https://github.com/tomoki013/tomokichi-studio/blob/main/docs/inquiry-platform/README.md) を参照。

# 引き継ぎ：ともきちの旅行日記の返信メールから Studio のロゴと「以上」を外す

作成 2026-11-03。作業するリポジトリは **tomokichi-studio**（`~/dev/projects/tomokichi-studio`）です。tomokichi-diary 側の作業は終わっています。

## 目的

旅行日記の管理画面から送る返信メール（inquiry-platform 経由）を、旅行日記だけ次のようにします。

1. **Tomokichi Studio のロゴ画像を付けない。** いまは、デプロイ全体の `BRANDING.mailLogo`（`https://tmkch.io/assets/mail-logo.png`）が署名の横に付いています。
2. **基盤が「以上、よろしくお願いいたします。」を自動で付けないようにする。** 旅行日記は、返信ごとに付けるかどうかを管理画面のチェックで選び、付けるときは diary の API が本文の最後に足して送ります（tomokichi-diary#170 で反映済み）。基盤の閉じの一文を空にしないと、チェックを外しても基盤が付けてしまいます。
3. 署名は旅行日記のもの：`ともきちの旅行日記\nともきち\nhttps://tomokichidiary.com`

## やり方：Zakkary と同じ project ごとの配信設定を足す

`deploy/inquiry-platform/api.jsonc` の `vars.PROJECT_MAIL_PROVIDERS` に、旅行日記の project ID をキーにした項目を1つ足します。形は Zakkary の項目（`d33ca505-…`）と同じです。

```jsonc
"<旅行日記の project ID>": {
  // ともきちの旅行日記。ロゴなし、閉じの一文なし（返信ごとに diary の管理画面で付けるか選ぶ）。
  "apiKeyBinding": "MAIL_API_KEY_TOMOKICHI_DIARY",
  "defaultSignature": "ともきちの旅行日記\nともきち\nhttps://tomokichidiary.com",
  "supportUrl": "https://tomokichidiary.com/contact",
  "replyClosing": ""
}
```

- `logo` は書きません。project ごとの設定があるときは、デプロイ全体のロゴは使われません（基盤 `apps/api/src/project-mail.ts`：「An explicit route never falls back to another project's credential or logo」）。
- `replyClosing: ""` で、この project だけ閉じの一文がなくなります（v0.10.0 から対応、いまのリリース v0.11.2 でも同じです）。
- `inquiryReceipt` は書きません（既定は true で、いまの動きと同じ。`app_mail_settings` に値があればそちらが優先されます）。
- 差出人は今までどおりです：`seed.ts` の `mailSettings` にある fromName「ともきちの旅行日記」と、デプロイ全体のアドレス support@tmkch.io。

### 旅行日記の project ID

platform の D1（`tomokichi-admin`）の `apps` テーブルで slug が `tomokichi-diary` の行の `id` です。

```bash
pnpm cf d1 execute tomokichi-admin --remote --command "SELECT id FROM apps WHERE slug='tomokichi-diary'"
```

（tomokichi-studio のフォルダで実行します。`pnpm cf` は wrangler の短縮コマンドです。Claude の環境では Cloudflare の認証エラーで取れませんでした。Owner の手元なら取れるはずです。）

## 順番を必ず守る（逆にすると旅行日記の返信が送れなくなる）

project ごとの設定で `apiKeyBinding` の Secret が無いと、その project は `UnconfiguredMailProvider` になり、**返信の送信が失敗します**（デプロイ全体のキーには戻りません）。なので、次の順にします。

1. **Owner が Resend で API キーを作る。** 名前 `tomokichi-diary`、権限 Sending access、ドメイン `tmkch.io`。キーの作成と入力は Owner 本人がやります（AI には入力させない）。
2. **Owner が Core Worker（`tomokichi-admin-core`）に Secret を登録する。**
   ```bash
   pnpm cf secret put MAIL_API_KEY_TOMOKICHI_DIARY --name tomokichi-admin-core
   ```
   登録できたかどうかは `pnpm cf secret list --name tomokichi-admin-core` で確かめます。値は表示されず、名前だけ出ます。
3. `api.jsonc` に上の項目を足して PR → マージ。
4. デプロイ：`pnpm deploy:inquiry check` で dry-run → `pnpm deploy:inquiry deploy api`（本番に触るコマンドは Owner が手元で実行。`docs/inquiry-platform/README.md` 参照）。
5. `docs/inquiry-platform/README.md` に、旅行日記の配信設定（ロゴなし・閉じの一文なし・Secret 名）を1行足します。

## 終わったかの確認

旅行日記の管理画面（https://admin.tomokichidiary.com/#/inquiries）で、テスト用の問い合わせに返信して確かめます。

- 署名の横に Tomokichi Studio のロゴが出ない。
- 「以上、よろしくお願いいたします。」のチェックを外すと、メールに入らない。入れると最後に1回だけ入る。
- 署名が旅行日記のもので、電話番号が入っていない。
- 送信が失敗しない。失敗したら Secret 名の綴りを確認する（`INQUIRY_MAIL_FAILED` が出る）。

## 参考

- diary 側の実装：tomokichi-diary の `apps/api/src/inquiry-templates.ts`（`REPLY_CLOSING`、`withClosing`）と `apps/api/src/routes/inquiry.ts`（reply の `closing`）。
- 基盤の仕組み：inquiry-platform の `apps/api/src/project-mail.ts`（project ごとの設定の形）と `apps/api/src/domain/reply-service.ts`（閉じの一文と署名の付け方）。
- tomokichi-diary の SDK は v0.10.0 に固定されていますが、platform は v0.11.2 で動いています。今回の設定には関係ありません。上げるなら別の作業にしてください。

## 今回はやらないこと（あとで検討）

- 差出人を support@tmkch.io から tomokichidiary.com のアドレスに変える。これには Resend で tomokichidiary.com を認証することと、Cloudflare Email Routing で返信が mail-ingress に届くよう受け口を作ることが要ります。そのあと `seed.ts` の `mailSettings` に `supportEmail` を足します。Gmail アドレスからは送れません（gmail.com は認証できないため）。
