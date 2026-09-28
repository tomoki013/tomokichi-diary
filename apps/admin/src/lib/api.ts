import type {
  ArticleDetailDto,
  ArticleKnowledgeBundleDto,
  ArticleSummaryDto,
  ErrorBody,
  InquirySignatureDto,
  InquiryStatusDto,
  InquiryTicketDetailDto,
  InquiryTicketStatus,
  InquiryTicketSummaryDto,
  LocationDto,
  MediaAssetDto,
  PageDto,
  PublishCheckDto,
  RouteDto,
  TaxonomyDto,
} from "@tomokichi/contracts";
import type { DraftInput } from "./draft";
import type { Resolution } from "./labels";

/**
 * Same-origin by default: the admin Worker carries the API under `/api`, so one
 * Cloudflare Access application protects both and the browser's Access cookie
 * rides along. `VITE_API_URL` points at a deployed API for local development.
 */
// An empty `VITE_API_URL` is a value; pointing the client at "" would call
// paths the SPA fallback answers with 200 HTML.
const configured = (import.meta.env["VITE_API_URL"] ?? "").trim();
const ORIGIN = configured === "" ? "/api" : configured.replace(/\/+$/, "");
const BASE = `${ORIGIN}/v1`;

const TOKEN_KEY = "tomokichi.admin.token";

/**
 * The shared admin token, for environments without Access (local development).
 * Kept in `localStorage` when the operator asks to be remembered, otherwise in
 * `sessionStorage`. This origin serves nothing but our own bundle.
 */
function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? globalThis.localStorage : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

export function getToken(): string {
  return storage("local")?.getItem(TOKEN_KEY) ?? storage("session")?.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string, remember: boolean): void {
  clearToken();
  if (token !== "") storage(remember ? "local" : "session")?.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  storage("local")?.removeItem(TOKEN_KEY);
  storage("session")?.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly issues: readonly { path: string; message: string }[] = [],
    readonly requestId = "",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * A readable one-liner for a toast. The API's own messages are for logs and
 * are in English; the common failures get plain Japanese instead. Validation
 * and conflict messages are kept, since they say what to fix.
 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "サインインが必要です";
    if (error.code === "API_NOT_FOUND" || error.code.endsWith("_NOT_FOUND")) {
      return "見つかりませんでした";
    }
    if (error.status === 502) return "共通お問い合わせ基盤に接続できませんでした";
    if (error.status === 503) return "共通お問い合わせ基盤への接続が未設定です";
    if (error.status >= 500)
      return `サーバーでエラーが起きました（${error.requestId || error.code}）`;
    const fields = error.issues.map((issue) => issue.path).filter(Boolean);
    return `${error.message}${fields.length > 0 ? `（${fields.join(", ")}）` : ""}`;
  }
  if (error instanceof TypeError) return "通信できませんでした。接続を確認してください";
  return error instanceof Error ? error.message : String(error);
}

async function request<T>(path: string, init: RequestInit = {}, base = BASE): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token !== "") headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${base}${path}`, { ...init, headers, credentials: "same-origin" });
  if (response.status === 204) return undefined as T;

  // A JSON API answering with HTML has been misrouted, usually to the SPA
  // fallback. Treating that as success would hide it behind an empty screen.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new ApiError(
      "API_INTERNAL",
      `${path} が JSON 以外（${contentType || "不明"}）を返しました`,
      response.status,
    );
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as ErrorBody | null)?.error;
    throw new ApiError(
      error?.code ?? "API_INTERNAL",
      error?.message ?? `request failed with ${response.status}`,
      response.status,
      error?.issues ?? [],
      error?.requestId ?? "",
    );
  }
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export type Relation = "primary" | "visited" | "mentioned" | "related";
export type MediaRole = "cover" | "inline" | "gallery" | "og";

export interface MediaUsageInput {
  mediaId: string;
  role: MediaRole;
  sortOrder: number;
  alt: string;
  caption: string | null;
}

export interface RelationsInput {
  locations: { locationId: string; relation: Relation }[];
  places: { placeId: string; relation: Relation }[];
  categoryIds: string[];
  tagIds: string[];
  collectionIds: string[];
}

export interface PlaceDto {
  id: string;
  slug: string;
  name: string;
  kind: string;
  locationId: string | null;
}

export interface LegacyMessageDto {
  id: string;
  name: string;
  email: string;
  subject: string;
  body: string;
  status: "unread" | "read" | "spam";
  createdAt: string;
}

export interface TicketChange {
  revision: number;
  status?: InquiryTicketStatus;
  resolution?: Resolution;
  nextAction?: string | null;
  nextActionAt?: string | null;
}

const id = encodeURIComponent;

export const api = {
  health: () => request<{ status: string }>("/health", {}, ORIGIN),

  // Articles
  listArticles: () => request<{ items: ArticleSummaryDto[] }>("/admin/articles"),
  getArticle: (articleId: string) => request<ArticleDetailDto>(`/admin/articles/${id(articleId)}`),
  createArticle: (input: {
    slug: string;
    locale: "ja";
    kind: "article" | "page";
    path: string;
    draft: DraftInput;
  }) => request<{ id: string }>("/admin/articles", json("POST", input)),
  saveDraft: (articleId: string, draft: DraftInput) =>
    request<{ revision: { id: string; revisionNumber: number } }>(
      `/admin/articles/${id(articleId)}/draft`,
      json("PUT", draft),
    ),
  publishCheck: (articleId: string) =>
    request<PublishCheckDto>(`/admin/articles/${id(articleId)}/publish-check`),
  publish: (articleId: string) =>
    request<{ status: string }>(`/admin/articles/${id(articleId)}/publish`, json("POST")),
  schedule: (articleId: string, at: string) =>
    request<{ status: string }>(`/admin/articles/${id(articleId)}/schedule`, json("POST", { at })),
  unpublish: (articleId: string) =>
    request<{ status: string }>(`/admin/articles/${id(articleId)}/unpublish`, json("POST")),
  archive: (articleId: string) =>
    request<{ status: string }>(`/admin/articles/${id(articleId)}/archive`, json("POST")),
  saveRelations: (articleId: string, relations: RelationsInput) =>
    request<{ ok: boolean }>(`/admin/articles/${id(articleId)}/relations`, json("PUT", relations)),
  saveExperienceTags: (articleId: string, experienceTags: string[]) =>
    request<{ experienceTags: string[] }>(
      `/admin/articles/${id(articleId)}/experience-tags`,
      json("PUT", { experienceTags }),
    ),

  // Media
  listMedia: () => request<{ items: MediaAssetDto[] }>("/admin/media"),
  uploadMedia: (file: File, size?: { width: number; height: number }) => {
    const form = new FormData();
    form.append("file", file);
    if (size) {
      form.append("width", String(size.width));
      form.append("height", String(size.height));
    }
    return request<MediaAssetDto>("/admin/media", { method: "POST", body: form });
  },
  saveArticleMedia: (articleId: string, media: MediaUsageInput[]) =>
    request<{ ok: boolean }>(`/admin/media/article/${id(articleId)}`, json("PUT", { media })),

  // Reference data
  listLocations: () => request<{ items: LocationDto[] }>("/admin/locations"),
  listPlaces: () => request<{ items: PlaceDto[] }>("/admin/places"),
  taxonomy: () => request<TaxonomyDto>("/admin/taxonomy"),

  // URLs
  listRoutes: () => request<{ items: RouteDto[] }>("/admin/routes"),
  routeIntegrity: () =>
    request<{ ok: boolean; problems: { code: string; target: string | null; message: string }[] }>(
      "/admin/routes/integrity",
    ),
  moveRoute: (from: string, to: string, status: "301" | "302" | "308") =>
    request<{ canonical: RouteDto; redirect: RouteDto }>(
      "/admin/routes/move",
      json("POST", { from, to, status }),
    ),

  // Travel knowledge
  getKnowledge: (articleId: string) =>
    request<ArticleKnowledgeBundleDto>(`/admin/knowledge/article/${id(articleId)}`),
  saveKnowledge: (articleId: string, input: Omit<ArticleKnowledgeBundleDto, "canSuggestWithAi">) =>
    request<ArticleKnowledgeBundleDto>(
      `/admin/knowledge/article/${id(articleId)}`,
      json("PUT", input),
    ),
  verifyKnowledgeFact: (factId: string) =>
    request<ArticleKnowledgeBundleDto["facts"][number]>(
      `/admin/knowledge/facts/${id(factId)}/verify`,
      json("POST"),
    ),
  suggestKnowledgeFacts: (articleId: string) =>
    request<{ available: boolean; facts: ArticleKnowledgeBundleDto["facts"] }>(
      `/admin/knowledge/article/${id(articleId)}/suggestions`,
      json("POST"),
    ),

  // Inquiries (the shared platform, through the diary API)
  inquiryStatus: () => request<InquiryStatusDto>("/admin/inquiry/status"),
  getSignature: () => request<InquirySignatureDto>("/admin/inquiry/signature"),
  saveSignature: (signature: string) =>
    request<InquirySignatureDto>("/admin/inquiry/signature", json("PUT", { signature })),
  listTickets: (filter: { status?: string; query?: string; offset?: number }) => {
    const query = new URLSearchParams();
    if (filter.status) query.set("status", filter.status);
    if (filter.query) query.set("query", filter.query);
    if (filter.offset) query.set("offset", String(filter.offset));
    return request<PageDto<InquiryTicketSummaryDto>>(`/admin/inquiry/tickets?${query}`);
  },
  getTicket: (ticketId: string, offset = 0) =>
    request<InquiryTicketDetailDto>(`/admin/inquiry/tickets/${id(ticketId)}?offset=${offset}`),
  changeTicket: (ticketId: string, change: TicketChange) =>
    request<{ ok: boolean }>(`/admin/inquiry/tickets/${id(ticketId)}`, json("PATCH", change)),
  addTicketNote: (ticketId: string, body: string, idempotencyKey: string) =>
    request<{ ok: boolean }>(
      `/admin/inquiry/tickets/${id(ticketId)}/notes`,
      json("POST", { body, idempotencyKey }),
    ),
  replyToTicket: (
    ticketId: string,
    body: string,
    idempotencyKey: string,
    reopenIfResolved: boolean,
  ) =>
    request<{ ok: boolean }>(
      `/admin/inquiry/tickets/${id(ticketId)}/reply`,
      json("POST", { body, idempotencyKey, reopenIfResolved }),
    ),

  // Messages received before the switch to the platform
  listLegacyMessages: () =>
    request<{ items: LegacyMessageDto[]; unread: number }>("/admin/messages"),
  setLegacyMessageStatus: (messageId: string, status: LegacyMessageDto["status"]) =>
    request<{ ok: boolean }>(`/admin/messages/${id(messageId)}/status`, json("PUT", { status })),
};
