import type {
  ErrorBody,
  MediaUploadDto,
  OperationInput,
  OperationName,
  OperationOutput,
} from "@tomokichi/contracts";

/**
 * The admin's one way to the API: run a named operation. The names, inputs
 * and outputs are the catalogue's (packages/contracts/operations), so the
 * admin cannot ask for something the API and the MCP servers do not share.
 *
 * Same-origin by default: the admin Worker carries the API under `/api`, so
 * one Cloudflare Access application protects both and the Access cookie rides
 * along. `VITE_API_URL` points at another API for local development.
 */
const configured = (import.meta.env["VITE_API_URL"] ?? "").trim();
// A production bundle always uses the Access-protected service binding.
const ORIGIN = import.meta.env.PROD || configured === "" ? "/api" : configured.replace(/\/+$/, "");
const BASE = `${ORIGIN}/v1/admin`;
const TOKEN_KEY = "tomokichi.admin.token";

/**
 * The shared admin token, for environments without Access (local development).
 * `localStorage` when the operator asks to be remembered, else `sessionStorage`.
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

/** A readable one-liner. Validation and conflict messages are kept: they say what to fix. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "サインインが必要です";
    if (error.status === 403) return "この操作はできません";
    if (error.code === "API_NOT_FOUND" || error.code.endsWith("_NOT_FOUND"))
      return "見つかりませんでした";
    if (error.code === "INQUIRY_MAIL_FAILED")
      return "返信メールを送れませんでした。時間をおいてもう一度送信してください";
    if (error.status >= 500)
      return `サーバーでエラーが起きました（${error.requestId || error.code}）`;
    const fields = error.issues.map((issue) => issue.path).filter(Boolean);
    return `${error.message}${fields.length > 0 ? `（${fields.join(", ")}）` : ""}`;
  }
  if (error instanceof TypeError) return "通信できませんでした。接続を確認してください";
  return error instanceof Error ? error.message : String(error);
}

async function send<T>(path: string, body: BodyInit, json: boolean): Promise<T> {
  const headers = new Headers();
  const token = getToken();
  if (token !== "") headers.set("authorization", `Bearer ${token}`);
  if (json) headers.set("content-type", "application/json");
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body,
    credentials: "same-origin",
  });
  if (response.status === 401) globalThis.dispatchEvent?.(new Event("admin-session-expired"));
  // A JSON API answering with HTML has been misrouted, usually to the SPA fallback.
  if (!(response.headers.get("content-type") ?? "").includes("json"))
    throw new ApiError("API_INTERNAL", "unexpected response", response.status);
  const parsed: unknown = await response.json();
  if (!response.ok) {
    const error = (parsed as ErrorBody).error;
    throw new ApiError(
      error?.code ?? "API_INTERNAL",
      error?.message ?? "request failed",
      response.status,
      error?.issues ?? [],
      error?.requestId ?? "",
    );
  }
  return parsed as T;
}

/** Runs one operation. */
export function op<N extends OperationName>(
  name: N,
  ...input: object extends OperationInput<N> ? [OperationInput<N>?] : [OperationInput<N>]
): Promise<OperationOutput<N>> {
  return send(`/ops/${name}`, JSON.stringify(input[0] ?? {}), true);
}

/** `media.upload` with the file as multipart, so a 20 MB photo is not inflated to Base64. */
export function uploadFile(file: File, slug: string): Promise<MediaUploadDto> {
  const form = new FormData();
  form.append("file", file);
  form.append("slug", slug);
  return send("/ops/media.upload", form, false);
}

/** The original of a library photo, downloaded with the admin's credentials. */
export async function downloadOriginal(mediaId: string, name: string): Promise<void> {
  const headers = new Headers();
  const token = getToken();
  if (token !== "") headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${BASE}/media/${encodeURIComponent(mediaId)}/file`, {
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) throw new ApiError("MEDIA_NOT_FOUND", "image not found", response.status);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
