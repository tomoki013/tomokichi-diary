import type {
  ArticleDetailDto,
  ArticleSummaryDto,
  ErrorBody,
  LocationDto,
  MediaAssetDto,
  PublishCheckDto,
  RouteDto,
  TaxonomyDto,
} from "@tomokichi/contracts";

// The version prefix lives here so every call carries it and nothing else
// in the admin has to think about it.
/**
 * Same-origin by default: the admin Worker carries the API under `/api`, so
 * Cloudflare Access protects both with one application and the browser sends
 * its Access cookie automatically. `VITE_API_URL` points at a deployed API for
 * local development.
 */
const ORIGIN = (import.meta.env["VITE_API_URL"] ?? "/api").replace(/\/+$/, "");
const BASE = `${ORIGIN}/v1`;

const TOKEN_KEY = "tomokichi.admin.token";

/**
 * The token is held in `localStorage` when the operator asks to be remembered,
 * and in `sessionStorage` otherwise.
 *
 * `sessionStorage` is per-tab, so on its own it means signing in again every
 * time the admin is opened in a new tab. This origin serves only our own
 * bundle — no third-party scripts, no content from anyone else — so persisting
 * the token here is a reasonable trade for that.
 */
export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string, remember = true): void {
  clearToken();
  if (token === "") return;
  (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly issues: readonly { path: string; message: string }[] = [],
    readonly requestId = "",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}, base: string = BASE): Promise<T> {
  const headers = new Headers(init.headers);
  // Sent only when a token is stored: once Access is the sole gate, there is
  // none, and the request carries the Access cookie instead.
  const token = getToken();
  if (token !== "") headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  // The Access cookie must ride along on same-origin calls.
  const response = await fetch(`${base}${path}`, { ...init, headers, credentials: "same-origin" });
  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as ErrorBody | null)?.error;
    throw new ApiError(
      error?.code ?? "API_INTERNAL",
      error?.message ?? `request failed with ${response.status}`,
      error?.issues ?? [],
      error?.requestId ?? "",
    );
  }
  return body as T;
}

export const api = {
  health: () => request<{ status: string }>("/health", {}, ORIGIN),
  listArticles: () => request<{ items: ArticleSummaryDto[] }>("/admin/articles"),
  getArticle: (id: string) => request<ArticleDetailDto>(`/admin/articles/${id}`),
  createArticle: (input: {
    slug: string;
    locale: "ja" | "en";
    kind: "article" | "page";
    path: string;
    draft: DraftInput;
  }) => request<{ id: string }>("/admin/articles", { method: "POST", body: JSON.stringify(input) }),
  saveDraft: (id: string, draft: DraftInput) =>
    request<{ revision: { id: string; revisionNumber: number } }>(`/admin/articles/${id}/draft`, {
      method: "PUT",
      body: JSON.stringify(draft),
    }),
  publishCheck: (id: string) => request<PublishCheckDto>(`/admin/articles/${id}/publish-check`),
  publish: (id: string) =>
    request<{ status: string }>(`/admin/articles/${id}/publish`, { method: "POST" }),
  unpublish: (id: string) =>
    request<{ status: string }>(`/admin/articles/${id}/unpublish`, { method: "POST" }),
  archive: (id: string) =>
    request<{ status: string }>(`/admin/articles/${id}/archive`, { method: "POST" }),
  saveRelations: (id: string, relations: RelationsInput) =>
    request<{ ok: boolean }>(`/admin/articles/${id}/relations`, {
      method: "PUT",
      body: JSON.stringify(relations),
    }),
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
  saveArticleMedia: (id: string, media: MediaUsageInput[]) =>
    request<{ ok: boolean }>(`/admin/media/article/${id}`, {
      method: "PUT",
      body: JSON.stringify({ media }),
    }),
  listRoutes: () => request<{ items: RouteDto[] }>("/admin/routes"),
  listMessages: () => request<{ items: ContactMessageDto[]; unread: number }>("/admin/messages"),
  setMessageStatus: (id: string, status: ContactMessageDto["status"]) =>
    request<{ ok: boolean }>(`/admin/messages/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    }),
  listLocations: () => request<{ items: LocationDto[] }>("/admin/locations"),
  taxonomy: () => request<TaxonomyDto>("/admin/taxonomy"),
};

export interface DraftInput {
  title: string;
  summary: string;
  bodyMarkdown: string;
  seoTitleOverride: string | null;
  seoDescriptionOverride: string | null;
  changeSummary: string | null;
}

export interface MediaUsageInput {
  mediaId: string;
  role: "cover" | "inline" | "gallery" | "og";
  sortOrder: number;
  alt: string;
  caption: string | null;
}

export interface RelationsInput {
  locations: { locationId: string; relation: "primary" | "visited" | "mentioned" | "related" }[];
  places: { placeId: string; relation: "primary" | "visited" | "mentioned" | "related" }[];
  categoryIds: string[];
  tagIds: string[];
  collectionIds: string[];
}

export interface ContactMessageDto {
  id: string;
  name: string;
  email: string;
  subject: string;
  body: string;
  status: "unread" | "read" | "spam";
  createdAt: string;
}
