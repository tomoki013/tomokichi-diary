import type { Country } from "./types";

/**
 * Ordering guides per country. Firsthand guides come from the editor's own
 * orders (see the linked travel-blog post); the rest are marked as not yet
 * written instead of being filled with guesses.
 */

export interface OrderStep {
  title: string;
  detail: string;
}

export interface Phrase {
  label: string;
  /** What the screen shows. */
  value: string;
  meaning: string;
}

export interface OrderGuide {
  country: Country;
  slug: string;
  ready: boolean;
  /** One line under the tab. */
  method: string;
  lead: string;
  app: string;
  payment: string;
  steps: OrderStep[];
  cautions: string[];
  firstPick: string;
  checkedAt: string | null;
  blogLink: { title: string; url: string } | null;
}

const ORDER_POST = {
  title: "CHAGEEの注文方法｜中国・マレーシア・シンガポールで実際に注文して分かった違い",
  url: "https://tomokichidiary.com/posts/chagee-ordering-china-malaysia-singapore",
};

export const ORDER_GUIDES: OrderGuide[] = [
  {
    country: "cn",
    slug: "china",
    ready: true,
    method: "Alipay のモバイルオーダー",
    lead: "上海では、店頭のQRコードをAlipayで読み取ってモバイルオーダーしました。注文から支払いまでスマホで完結するので、中国語でカスタマイズを伝える必要はありません。",
    app: "アプリのインストールは不要。Alipay から注文できました。",
    payment: "Alipay（私が実際に使った方法）",
    steps: [
      { title: "QRを読み取る", detail: "店頭のQRコードを Alipay で読み取ります。" },
      { title: "メニューを選ぶ", detail: "写真付きのメニューから商品を選びます。" },
      { title: "サイズ・氷・甘さを選ぶ", detail: "選択式なので中国語を話す必要はありません。" },
      { title: "Alipay で支払う", detail: "そのまま Alipay で決済します。" },
      { title: "店舗で受け取る", detail: "完成したら店舗で受け取ります。" },
    ],
    cautions: [
      "店舗を探すときは Baidu Maps で中国語名「霸王茶姬」と検索。英字の「CHAGEE」では出てこない店舗がありました。",
      "中国旅行では CHAGEE 以外の支払いでも Alipay を多用するので、出発前に準備しておくと安心です。",
    ],
    firstPick: "まずは看板の伯牙絶弦。お茶感を強く感じたいなら大紅袍系の白雾红尘。",
    checkedAt: "2026-08-24",
    blogLink: ORDER_POST,
  },
  {
    country: "my",
    slug: "malaysia",
    ready: true,
    method: "CHAGEE 公式アプリ",
    lead: "クアラルンプールでは CHAGEE 公式アプリで注文しました。Pavilion Kuala Lumpur の店頭QRからアプリのインストール画面に進み、登録して注文しています。",
    app: "公式アプリを使用。電話番号で登録する場合はSMS認証が必要でした（Apple・Facebook などでのログインも表示）。",
    payment: "クレジットカード（私が実際に使った方法）",
    steps: [
      { title: "アプリを入れる", detail: "店頭QRからインストールし、アカウントを作成します。" },
      { title: "店舗を選ぶ", detail: "受け取る店舗をアプリで選びます。" },
      {
        title: "サイズ・氷・甘さを選ぶ",
        detail: "メニューを選んでカスタマイズし、カートに入れます。",
      },
      { title: "支払う", detail: "支払い方法を選んで注文します。" },
      { title: "店舗で受け取る", detail: "完成したら店舗で受け取ります。" },
    ],
    cautions: [
      "電話番号で登録するなら、旅行中にSMSを受信できるか確認しておくと安心です。",
      "初回登録時に半額クーポンが付きました。ただしマレーシアのクーポンはシンガポールでは使えませんでした。条件は時期で変わる可能性があります。",
      "混雑する店舗では受け取りまで30分ほど待ったことがあります。",
    ],
    firstPick: "伯牙絶弦か、フルーティーで軽やかな花田乌龙。",
    checkedAt: "2026-08-24",
    blogLink: ORDER_POST,
  },
  {
    country: "sg",
    slug: "singapore",
    ready: true,
    method: "Mobile Web（ブラウザ）",
    lead: "シンガポールでは、アプリを入れずにブラウザの Mobile Web から注文しました。CHAGEE Singapore の公式案内でも、アプリと Mobile Web は全店舗で使えるとされています。",
    app: "アプリなしでも Mobile Web で注文可能。旅行中に数回使うだけならこれで十分でした。",
    payment: "未確認（注文画面で選択）",
    steps: [
      { title: "Mobile Web を開く", detail: "店頭の案内などからブラウザで注文ページを開きます。" },
      { title: "店舗とメニューを選ぶ", detail: "受け取る店舗を選び、メニューを選びます。" },
      { title: "サイズ・氷・甘さを選ぶ", detail: "選択式でカスタマイズします。" },
      { title: "支払う", detail: "画面の案内に沿って支払います。" },
      { title: "店舗で受け取る", detail: "完成したら店舗で受け取ります。" },
    ],
    cautions: [
      "カウンター注文に対応していない店舗があります。Raffles Specialist Centre は訪問時モバイルオーダーのみでした。",
      "2026年8月時点の公式案内でも、店頭注文に対応しているのは一部店舗のみです。スマホで注文できる状態で行きましょう。",
    ],
    firstPick: "迷ったら伯牙絶弦。空港の Changi T2 店で最後の一杯にするのもおすすめ。",
    checkedAt: "2026-08-24",
    blogLink: ORDER_POST,
  },
  {
    country: "th",
    slug: "thailand",
    ready: false,
    method: "準備中",
    lead: "タイのCHAGEEはまだ実際に注文していないため、ガイドは準備中です。実際に行ってから、体験ベースでまとめます。",
    app: "未確認",
    payment: "未確認",
    steps: [],
    cautions: [],
    firstPick: "",
    checkedAt: null,
    blogLink: null,
  },
  {
    country: "jp",
    slug: "japan",
    ready: false,
    method: "日本上陸待ち",
    lead: "2026年10月時点で、CHAGEEの日本出店に関する公式発表は確認できていません。上陸が決まったら、ここに日本での注文方法をまとめます。",
    app: "未確認",
    payment: "未確認",
    steps: [],
    cautions: [],
    firstPick: "",
    checkedAt: null,
    blogLink: null,
  },
];

/**
 * Customisation choices as the editor saw them in the CHAGEE app for
 * BO·YA Jasmine Green Milk Tea. Options differ by drink, country and season.
 */
export const CUSTOMIZE: { group: string; note: string; phrases: Phrase[] }[] = [
  {
    group: "サイズ",
    note: "Large が最初から選ばれていました。たっぷり飲みたいなら Large で問題なし。",
    phrases: [
      { label: "サイズ", value: "Regular", meaning: "レギュラー" },
      { label: "サイズ", value: "Large", meaning: "ラージ" },
    ],
  },
  {
    group: "氷",
    note: "冷たいドリンクだけでなく Hot も選べました。",
    phrases: [
      { label: "氷", value: "Normal", meaning: "普通" },
      { label: "氷", value: "Less", meaning: "少なめ" },
      { label: "氷", value: "No Ice", meaning: "氷なし" },
      { label: "氷", value: "Hot", meaning: "ホット" },
    ],
  },
  {
    group: "甘さ",
    note: "Normal は比較的しっかり甘め。甘さが気になるなら Less から試すのがおすすめ。",
    phrases: [
      { label: "甘さ", value: "Normal", meaning: "標準" },
      { label: "甘さ", value: "Less", meaning: "少なめ" },
      { label: "甘さ", value: "Slightly", meaning: "ほんのり" },
      { label: "甘さ", value: "No Additional Sugar", meaning: "砂糖の追加なし" },
    ],
  },
];

/**
 * Chinese words commonly printed on milk-tea menus in mainland China. General
 * vocabulary, not CHAGEE's exact labels — the app's own wording may differ.
 */
export const CHINESE_WORDS: Phrase[] = [
  { label: "サイズ", value: "大杯 / 中杯", meaning: "大きいサイズ / 中くらいのサイズ" },
  { label: "氷", value: "少冰 / 去冰", meaning: "氷少なめ / 氷なし" },
  { label: "温度", value: "常温 / 热", meaning: "常温 / ホット" },
  { label: "甘さ", value: "少糖 / 微糖", meaning: "甘さ少なめ / ほんのり" },
  { label: "受け取り", value: "取餐码", meaning: "受け取り番号" },
];

export const ORDER_FAQ: { q: string; a: string }[] = [
  {
    q: "中国語や英語が話せなくても注文できる？",
    a: "私が使った3か国はどれもスマホで商品とカスタマイズを選ぶ方式だったので、話す必要はほとんどありませんでした。",
  },
  {
    q: "アプリは入れたほうがいい？",
    a: "国によります。中国は Alipay、シンガポールは Mobile Web で済みました。マレーシアでは公式アプリを使い、初回クーポンも付きました。",
  },
  {
    q: "クーポンは他の国でも使える？",
    a: "私の場合、マレーシアで付いたクーポンはシンガポールでは使えませんでした。国ごとに条件が違う前提で、アプリの表示を確認してください。",
  },
  {
    q: "甘すぎない？",
    a: "Normal は比較的しっかり甘めです。甘さ控えめが好きなら Less から試してみてください。",
  },
];

export function guideBySlug(slug: string): OrderGuide | undefined {
  return ORDER_GUIDES.find((guide) => guide.slug === slug);
}
