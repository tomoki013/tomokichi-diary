import type { Brand } from "./brand.js";

export type ArticleId = Brand<string, "ArticleId">;
export type RevisionId = Brand<string, "RevisionId">;
export type EmbedId = Brand<string, "EmbedId">;
export type LocationId = Brand<string, "LocationId">;
export type PlaceId = Brand<string, "PlaceId">;
export type MediaId = Brand<string, "MediaId">;
export type RouteId = Brand<string, "RouteId">;
export type CategoryId = Brand<string, "CategoryId">;
export type TagId = Brand<string, "TagId">;
export type AuthorId = Brand<string, "AuthorId">;
export type AIArtifactId = Brand<string, "AIArtifactId">;
export type SourceId = Brand<string, "SourceId">;
export type TravelFactId = Brand<string, "TravelFactId">;
export type TravelRouteId = Brand<string, "TravelRouteId">;

const HEX = "0123456789abcdef";

/**
 * UUID v7 — time-ordered, so identifiers sort by creation and index well in any
 * database. Implemented here rather than pulled in as a dependency: it is a few
 * lines of standard Web Crypto and the Core must stay dependency-free.
 */
export function generateId(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // 48-bit big-endian millisecond timestamp
  let timestamp = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = timestamp & 0xff;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant

  let out = "";
  for (let i = 0; i < 16; i++) {
    const byte = bytes[i]!;
    out += HEX[byte >> 4]! + HEX[byte & 0x0f]!;
    if (i === 3 || i === 5 || i === 7 || i === 9) out += "-";
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isId(value: string): boolean {
  return UUID_RE.test(value);
}

/** Casts a validated string to a branded id. Callers own the validation. */
export function asId<T extends string>(value: string): T {
  return value as T;
}
