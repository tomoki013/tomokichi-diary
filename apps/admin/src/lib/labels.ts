import type { InquiryTicketStatus } from "@tomokichi/contracts";

/**
 * Every word the admin shows for a stored value. Values stay in the data as
 * stable identifiers; how they read on screen is decided here and only here.
 */

export const articleStatusLabels: Record<string, string> = {
  draft: "下書き",
  scheduled: "予約",
  published: "公開中",
  archived: "アーカイブ",
};

export const ticketStatusLabels: Record<InquiryTicketStatus, string> = {
  NEW: "新規",
  TRIAGE: "分類中",
  ACKNOWLEDGED: "確認済み",
  IN_PROGRESS: "対応中",
  WAITING_CUSTOMER: "返事待ち",
  WAITING_INTERNAL: "内部待ち",
  RESOLVED: "解決済み",
  CLOSED: "クローズ",
};

/** Statuses that still need something from the operator. */
export function isOpenTicket(status: InquiryTicketStatus): boolean {
  return status !== "RESOLVED" && status !== "CLOSED";
}

export const resolutionLabels = {
  RESOLVED: "解決",
  NO_ACTION_REQUIRED: "対応不要",
  SPAM: "スパム",
  DUPLICATE: "重複",
  INVALID: "無効",
  USER_WITHDREW: "取り下げ",
  OTHER: "その他",
} as const;
export type Resolution = keyof typeof resolutionLabels;

export const ticketEventLabels: Record<string, string> = {
  TICKET_CREATED: "受付",
  STATUS_CHANGED: "状態を変更",
  ACKNOWLEDGED: "確認",
  RESOLVED: "解決",
  CLOSED: "クローズ",
  REOPENED: "再開",
  PRIORITY_CHANGED: "優先度を変更",
  NEXT_ACTION_CHANGED: "次の対応を変更",
  DETAILS_CHANGED: "詳細を変更",
  MERGED: "統合",
  RELATION_ADDED: "関連付け",
  SERVICE_CHANGED: "プロジェクトを変更",
};

/** Mirrors the public site's wording (`apps/web/src/lib/experiences.ts`). */
export const experienceLabels: Record<string, string> = {
  exciting: "ワクワク",
  moving: "感動",
  thrilling: "ハラハラ",
  disaster: "これは終わった…",
  funny: "笑える",
  discovery: "発見",
  challenge: "挑戦",
  unforgettable: "忘れられない",
};

export const relationLabels = {
  primary: "主",
  visited: "訪問",
  mentioned: "言及",
  related: "関連",
} as const;

export const mediaRoleLabels = {
  cover: "カバー",
  inline: "本文",
  gallery: "ギャラリー",
  og: "OGP",
} as const;

const dateTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** `2026/09/27 13:40`, always in Japan time whatever the browser says. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

/** "3分前", "2時間前", "5日前", then the date. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}日前`;
  return formatDateTime(iso).slice(0, 10);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * `<input type="datetime-local">` speaks local wall-clock time without a zone.
 * The admin is operated from Japan, so it is read as JST explicitly rather
 * than as whatever zone the browser happens to be in.
 */
export function jstLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const date = new Date(`${local}:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isoToJstLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(Date.parse(iso) + 9 * 3_600_000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16);
}
