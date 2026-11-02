import type { OperatorReplyTemplate, ProjectOperatorClient } from "@inquiry-platform/sdk";
import type { ContactLane } from "@tomokichi/domain";

/**
 * How every reply from this site is put together:
 *
 *   冒頭（宛名・名乗り）                 ← `diary_opening`, filled per ticket
 *   本文                                 ← a template, or what was written
 *   以上、よろしくお願いいたします。     ← added by the platform on send
 *   署名                                 ← this site's, added by the platform
 *
 * Templates live on the inquiry platform, scoped to this site's project, so
 * they are edited in the admin. The defaults below are created only when
 * their key is missing: once one exists, the admin's edits win.
 */

/** The deployment's closing line, which the platform puts above the signature. */
export const REPLY_CLOSING = "以上、よろしくお願いいたします。";

/**
 * Who a reply comes from: the name set for this project in the studio seed
 * (`mailSettings`) and the deployment's support address it falls back to.
 * Shown in the admin only; the platform decides what is actually sent.
 */
export const REPLY_FROM = "ともきちの旅行日記 <support@tmkch.io>";

export const OPENING_KEY = "diary_opening";

/**
 * Not a template anyone writes from. The platform takes a reply's subject only
 * from the template named on send, so the subject typed in the admin is put
 * here just before the reply goes out. Kept inactive and out of every list.
 */
export const SUBJECT_KEY = "diary_system_subject";

const SITE = "【ともきちの旅行日記】";

/** What a first reply is about, until a template or the operator says otherwise. */
export const DEFAULT_SUBJECT: Readonly<Record<ContactLane, string>> = {
  general: `${SITE}お問い合わせいただいた件について`,
  media: `${SITE}ご相談いただいた件について`,
};

/** When the default signature is still the deployment's (Tomokichi Studio's). */
export const DEFAULT_SIGNATURE = [
  "ともきちの旅行日記",
  "ともきち",
  "https://tomokichidiary.com",
].join("\n");

export interface DefaultTemplate {
  readonly key: string;
  /** `区分：名前`; the admin groups the picker by what comes before `：`. */
  readonly name: string;
  readonly subject: string | null;
  readonly body: string;
  readonly sortOrder: number;
}

const lines = (...text: string[]): string => text.join("\n");

/**
 * What the site starts with. Reply bodies hold only the middle: the opening is
 * put in front of them and the platform adds the closing and signature.
 * `{{userName}}` is the name typed into the form; any other `{{...}}` is for
 * the operator to fill in, and blocks the send until they do.
 */
export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  {
    key: OPENING_KEY,
    name: "冒頭：宛名・名乗り",
    subject: null,
    sortOrder: 0,
    body: lines(
      "{{userName}} 様",
      "",
      "旅行ブログ「ともきちの旅行日記」を運営しております、ともきちです。",
    ),
  },
  {
    key: "diary_thanks_feedback",
    name: "記事：感想へのお礼",
    subject: `${SITE}ご感想ありがとうございます`,
    sortOrder: 10,
    body: lines(
      "記事へのご感想をお送りいただき、本当にありがとうございます。",
      "旅先で感じたことを少しでもお届けできていたなら、これ以上うれしいことはありません。",
      "",
      "いただいた言葉を励みに、これからも実際に行って分かったことを丁寧に書いていきます。",
      "また気になる記事がありましたら、気軽にご連絡ください。",
    ),
  },
  {
    key: "diary_correction_fixed",
    name: "記事：誤り・リンク切れを修正しました",
    subject: `${SITE}記事の修正のご報告`,
    sortOrder: 20,
    body: lines(
      "記事の誤りについてご連絡いただき、ありがとうございます。",
      "ご指摘の箇所を確認し、以下のとおり修正いたしました。",
      "",
      "対象の記事：{{articleUrl}}",
      "修正した内容：{{whatWasFixed}}",
      "",
      "正確な情報をお届けできておらず、申し訳ありませんでした。",
      "お気づきの点がありましたら、また教えていただけると助かります。",
    ),
  },
  {
    key: "diary_correction_checking",
    name: "記事：ご指摘を確認中",
    subject: `${SITE}記事へのご指摘について`,
    sortOrder: 30,
    body: lines(
      "記事についてご指摘いただき、ありがとうございます。",
      "",
      "現在、最新の情報と照らし合わせて内容を確認しております。",
      "確認でき次第、記事を修正したうえで改めてご連絡いたします。",
      "少しお時間をいただきますが、どうぞよろしくお願いいたします。",
    ),
  },
  {
    key: "diary_request_thanks",
    name: "リクエスト：旅先・記事のリクエストへのお礼",
    subject: `${SITE}リクエストありがとうございます`,
    sortOrder: 40,
    body: lines(
      "旅先・記事のリクエストをお送りいただき、ありがとうございます。",
      "",
      "いただいた内容は、今後の旅の計画や記事づくりの参考にさせていただきます。",
      "実際に訪れて記事にできた際には、ブログでご紹介いたします。",
      "",
      "すぐにお応えできるとは限りませんが、楽しみにお待ちいただけるとうれしいです。",
    ),
  },
  {
    key: "diary_question_answer",
    name: "質問：ご質問への回答",
    subject: `${SITE}ご質問いただいた件について`,
    sortOrder: 50,
    body: lines(
      "ご質問をお送りいただき、ありがとうございます。",
      "私が実際に訪れたときの経験をもとに、お答えします。",
      "",
      "{{answer}}",
      "",
      "なお、現地の料金や時刻、運行状況は変わることがありますので、",
      "お出かけ前に公式の情報もあわせてご確認ください。",
      "",
      "素敵な旅になりますように。",
    ),
  },
  {
    key: "diary_more_information",
    name: "質問：追加で教えてほしいこと",
    subject: `${SITE}お問い合わせいただいた件について`,
    sortOrder: 60,
    body: lines(
      "お問い合わせいただき、ありがとうございます。",
      "より正確にお答えするため、",
      "恐れ入りますが以下を教えていただけますでしょうか。",
      "",
      "{{requestedInformation}}",
      "",
      "お手数をおかけしますが、このメールにそのままご返信ください。",
    ),
  },
  {
    key: "diary_work_details",
    name: "取材・お仕事：ご相談へのお礼と詳細の確認",
    subject: `${SITE}お仕事のご相談について`,
    sortOrder: 70,
    body: lines(
      "このたびはお仕事のご相談をいただき、ありがとうございます。",
      "前向きに検討したく、恐れ入りますが以下の点を教えていただけますでしょうか。",
      "",
      "・貴社名／媒体名",
      "・ご依頼の内容（執筆、写真提供、取材、タイアップなど）",
      "・掲載先と掲載予定の時期",
      "・ご予算・条件",
      "・ご回答の期限",
      "",
      "内容を確認のうえ、改めてお返事いたします。",
    ),
  },
  {
    key: "diary_work_accept",
    name: "取材・お仕事：お引き受けします",
    subject: `${SITE}お仕事のご相談について`,
    sortOrder: 80,
    body: lines(
      "詳しい内容をお知らせいただき、ありがとうございます。",
      "ご相談いただいた件、ぜひお引き受けさせてください。",
      "",
      "{{nextSteps}}",
      "",
      "進め方やスケジュールについて、ご不明な点があればいつでもご連絡ください。",
      "どうぞよろしくお願いいたします。",
    ),
  },
  {
    key: "diary_work_decline",
    name: "取材・お仕事：今回はお断りします",
    subject: `${SITE}お仕事のご相談について`,
    sortOrder: 90,
    body: lines(
      "このたびはお声がけいただき、ありがとうございます。",
      "",
      "大変ありがたいお話ではありますが、検討の結果、",
      "今回はお引き受けを見送らせていただくことになりました。",
      "ご期待に沿えず申し訳ありません。",
      "",
      "また別の機会がございましたら、その際はどうぞよろしくお願いいたします。",
    ),
  },
  {
    key: "diary_photo_allow",
    name: "写真：ご利用を許可します",
    subject: `${SITE}写真のご利用について`,
    sortOrder: 100,
    body: lines(
      "写真のご利用についてお問い合わせいただき、ありがとうございます。",
      "以下の条件でご利用いただけます。",
      "",
      "・対象の写真：{{photo}}",
      "・ご利用の範囲：{{scope}}",
      "・クレジット表記：「写真：ともきちの旅行日記（https://tomokichidiary.com）」",
      "・写真の加工は、トリミングと明るさの調整までとさせてください",
      "",
      "掲載されましたら、掲載先を教えていただけるとうれしいです。",
    ),
  },
  {
    key: "diary_photo_decline",
    name: "写真：今回はお断りします",
    subject: `${SITE}写真のご利用について`,
    sortOrder: 110,
    body: lines(
      "写真のご利用についてお問い合わせいただき、ありがとうございます。",
      "",
      "申し訳ありませんが、ご依頼の用途での写真のご利用はお断りさせていただいております。",
      "ご期待に沿えず恐縮ですが、ご理解いただけますと幸いです。",
    ),
  },
  {
    key: "diary_sales_decline",
    name: "営業：ご提案へのお断り",
    subject: `${SITE}ご連絡いただいた件について`,
    sortOrder: 120,
    body: lines(
      "ご連絡いただき、ありがとうございます。",
      "",
      "当サイトは個人が趣味で運営している旅行ブログのため、",
      "サイト売却・SEO対策・広告掲載などのご提案は、すべてお断りさせていただいております。",
      "",
      "今後同様のご連絡にはお返事を差し控えますので、ご了承ください。",
    ),
  },
  {
    key: "diary_resolved",
    name: "共通：対応完了のご報告",
    subject: `${SITE}お問い合わせいただいた件について`,
    sortOrder: 130,
    body: lines(
      "お問い合わせいただいた件について、対応が完了しましたのでご報告します。",
      "",
      "{{whatWasDone}}",
      "",
      "このたびはご連絡いただき、ありがとうございました。",
      "これからも「ともきちの旅行日記」をよろしくお願いいたします。",
    ),
  },
];

const SYSTEM = { id: "service:diary-defaults" };

/** Nobody picks these: the opening goes in by itself, the subject carrier is plumbing. */
export const isPickable = (template: OperatorReplyTemplate): boolean =>
  template.key !== OPENING_KEY && template.key !== SUBJECT_KEY;

/**
 * This site's templates, creating any default that is missing, the subject
 * carrier included. Throws when the platform cannot list them.
 */
export async function ensureTemplates(
  operator: ProjectOperatorClient,
): Promise<OperatorReplyTemplate[]> {
  const listed = await operator.listTemplates({ includeInactive: true });
  if (!listed.ok) throw new Error(`templates unavailable: ${listed.error.code}`);
  const have = new Set(listed.value.map((template) => template.key));
  const missing = DEFAULT_TEMPLATES.filter((template) => !have.has(template.key));
  const carrier = !have.has(SUBJECT_KEY);
  if (missing.length === 0 && !carrier) return listed.value;

  for (const template of missing) {
    // Another request may create the same key first; that CONFLICT is fine.
    await operator.createTemplate({ ...template, isActive: true }, SYSTEM);
  }
  if (carrier) {
    await operator.createTemplate(
      {
        key: SUBJECT_KEY,
        name: "（システム）返信の件名",
        subject: DEFAULT_SUBJECT.general,
        body: "返信の件名を基盤に渡すための仕組みです。編集・使用しないでください。",
        isActive: false,
        sortOrder: 9999,
      },
      SYSTEM,
    );
  }
  const again = await operator.listTemplates({ includeInactive: true });
  if (!again.ok) throw new Error(`templates unavailable: ${again.error.code}`);
  return again.value;
}

/** Gives the site its own signature while it still signs as the deployment. */
export async function ensureSignature(operator: ProjectOperatorClient): Promise<void> {
  const project = await operator.project();
  if (project.ok && project.value.signature.trim() === "") {
    await operator.setSignature(DEFAULT_SIGNATURE, SYSTEM);
  }
}
