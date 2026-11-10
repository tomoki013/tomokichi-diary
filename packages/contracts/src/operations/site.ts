import type { LikeActivityDto } from "../dto.js";
import type { SitePublicationStatus } from "../publication.js";
import { v } from "../validation.js";
import { plainDate } from "./fields.js";
import { operation } from "./spec.js";

/** One line of the home screen: something that needs the owner, and where to go. */
export interface HomeTaskDto {
  readonly kind:
    | "publication-failed"
    | "draft"
    | "unpublished-changes"
    | "scheduled"
    | "open-inquiries"
    | "pending-facts";
  readonly title: string;
  readonly detail: string | null;
  /** Where the admin goes for it, as a hash route. */
  readonly href: string;
  readonly count?: number;
}
export interface HomeDto {
  readonly publication: SitePublicationStatus;
  readonly tasks: readonly HomeTaskDto[];
}

export interface ActivityItemDto {
  readonly id: string;
  readonly occurredAt: string;
  readonly requestId: string;
  readonly actorType: string;
  readonly actorSubject: string | null;
  readonly clientId: string | null;
  readonly clientName: string | null;
  readonly clientTrust: string;
  readonly source: string;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly result: string;
  readonly statusCode: number | null;
  readonly metadata: Record<string, unknown>;
  readonly oauthGrantRef: string | null;
  readonly mcpToolName: string | null;
  readonly publicationId: string | null;
  readonly clientRedirectHost: string | null;
}
export interface ActivityPageDto {
  readonly items: readonly ActivityItemDto[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly pages: number;
}

export interface ConnectionDto {
  readonly id: string;
  readonly issuer: "analytics" | "analytics-legacy" | "operator" | "operator-legacy";
  /** A hash of the OAuth client id; the id itself never leaves the MCP Worker. */
  readonly clientId: string;
  readonly clientName: string;
  readonly clientTrust: "confirmed" | "self-asserted" | "unknown";
  readonly actorSubject: string;
  readonly scopes: readonly string[];
  readonly approvedAt: string;
  readonly expiresAt: string | null;
  readonly redirectHost: string | null;
  readonly lastUsedAt: string | null;
  readonly active: boolean;
}

export const ACTIVITY_RESULTS = ["requested", "succeeded", "failed", "rejected"] as const;

export const siteOperations = {
  "home.get": operation<HomeDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description:
      "いま手を付けるものの一覧: サイト反映の失敗、公開していない変更、書きかけの下書き、予約公開、確認待ちの事実。管理画面のホームと同じ内容です（問い合わせは管理画面だけに出ます）。",
    tool: { name: "get_home", title: "Get what needs attention" },
    target: { type: "admin" },
  }),
  "publication.status": operation<SitePublicationStatus>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description: "サイトへの反映状況（反映済み・生成中・失敗）を確認します。",
    tool: { name: "publication_status", title: "Publication status" },
    target: { type: "publication" },
  }),
  "publication.run": operation<SitePublicationStatus>()({
    kind: "write",
    surface: "operator",
    input: v.object({}),
    description:
      'DBの公開版でサイト全体を再生成・配信します（ランキング・シリーズの変更をサイトに出すとき）。記事の下書きは公開しません。利用者の明示的な指示があるときだけ使い、confirm に "publish" を入れてください。',
    tool: {
      name: "publish_site",
      title: "Publish site",
      confirm: { field: "confirm", literal: "publish", description: "publish と入れる" },
    },
    target: { type: "publication" },
    publishes: true,
  }),
  "like.activity": operation<LikeActivityDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description: "記事の「いいね」の合計・人数・記事別の数・最近のいいねを返します。",
    tool: { name: "get_like_activity", title: "Get like activity" },
    target: { type: "like" },
  }),
  "activity.list": operation<ActivityPageDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({
      page: v.optional(v.number({ integer: true, min: 1, max: 100_000 }), 1),
      limit: v.optional(v.number({ integer: true, min: 1, max: 100 }), 50),
      start: v.describe(v.maybe(plainDate), "この日以降（UTC）"),
      end: v.describe(v.maybe(plainDate), "この日まで（UTC）"),
      result: v.maybe(v.literalUnion(ACTIVITY_RESULTS)),
      targetType: v.describe(
        v.maybe(v.string({ max: 40 })),
        "article, note, series, ranking, ad, media, publication, knowledge など",
      ),
      targetId: v.maybe(v.string({ max: 120 })),
      client: v.describe(v.maybe(v.string({ max: 120 })), "接続先の名前か ID。unknown で未確認"),
      action: v.describe(v.maybe(v.string({ max: 100 })), "操作名の先頭（例: article.）"),
    }),
    description:
      "操作ログ（誰が・どの経路で・何をしたか）を新しい順に返します。期間・結果・対象・接続先で絞れます。",
    tool: { name: "list_activity", title: "List activity log" },
    target: { type: "admin" },
  }),
  "connection.list": operation<{ items: readonly ConnectionDto[] }>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description: "この管理 MCP・分析 MCP に接続しているクライアント（許可済みの接続）の一覧。",
    tool: { name: "list_mcp_connections", title: "List MCP connections" },
    target: { type: "connection" },
  }),
  "connection.label": operation<{
    clientId: string;
    redirectHost: string;
    displayName: string;
    clientTrust: "confirmed";
  }>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      clientId: v.string({ min: 32, max: 32, pattern: /^[a-fA-F0-9]{32}$/ }),
      redirectHost: v.string({ min: 1, max: 253 }),
      displayName: v.string({ min: 1, max: 80 }),
    }),
    description:
      "接続中のクライアントに、操作ログで使う表示名を付けます（client_id のハッシュと戻り先ホストで特定）。",
    tool: { name: "label_mcp_client", title: "Label MCP client" },
    target: { type: "connection", idField: "clientId" },
  }),
  "connection.revoke": operation<Record<string, unknown>>()({
    kind: "write",
    surface: "admin-only",
    input: v.object({
      issuer: v.literalUnion([
        "analytics",
        "analytics-legacy",
        "operator",
        "operator-legacy",
      ] as const),
      grantId: v.string({ min: 1, max: 80, pattern: /^[A-Za-z0-9_-]+$/ }),
      confirm: v.literalUnion(["revoke"] as const),
    }),
    description: "MCP 接続を失効させます。管理画面で本人だけが行えます。",
    target: { type: "connection", idField: "grantId" },
  }),
};
