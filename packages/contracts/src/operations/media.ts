import type { MediaAssetDto, MediaHashStatusDto, MediaPageDto, MediaUploadDto } from "../dto.js";
import { v } from "../validation.js";
import { id } from "./fields.js";
import { operation } from "./spec.js";

const target = { type: "media", idField: "mediaId" } as const;

export const mediaOperations = {
  "media.list": operation<MediaPageDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({
      query: v.describe(v.optional(v.string({ max: 100 }), ""), "slug・ファイル名・地域の語"),
      offset: v.optional(v.number({ integer: true, min: 0 }), 0),
      limit: v.optional(v.number({ integer: true, min: 1, max: 200 }), 30),
    }),
    description:
      "画像ライブラリを slug・ファイル名・地域で検索します（既定30件ずつ、新しい順）。本文に入れるときは各画像の url を ![説明](url) で書きます。",
    tool: { name: "search_media", title: "Search media" },
    target: { type: "media" },
  }),
  "media.hashStatus": operation<MediaHashStatusDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description: "画像の重複確認（ハッシュ照合）がどこまで済んでいるかを返します。",
    tool: { name: "get_media_hash_status", title: "Get media hash status" },
    target: { type: "media" },
  }),
  "media.lookup": operation<{ asset: MediaAssetDto | null }>()({
    kind: "read",
    surface: "operator",
    input: v.object({
      sha256: v.describe(
        v.string({ min: 64, max: 64, pattern: /^[a-f0-9]{64}$/ }),
        "ファイルの SHA-256（16進小文字）",
      ),
    }),
    description: "同じ内容の画像がすでにライブラリにあるかを、ファイルの SHA-256 で調べます。",
    tool: { name: "find_media_by_hash", title: "Find media by hash" },
    target: { type: "media" },
  }),
  "media.update": operation<MediaAssetDto>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      mediaId: id,
      slug: v.describe(
        v.maybe(v.nullable(v.string({ max: 160 }))),
        "公開 URL に使う画像の slug。null で外す",
      ),
      aiGenerated: v.describe(
        v.maybe(v.boolean()),
        "画像生成 AI で作った画像なら true（ギャラリーに出さない）",
      ),
    }),
    description: "画像の公開 slug と「AI 生成」の印を変更します（指定した項目だけ）。",
    tool: { name: "update_media", title: "Update media" },
    target,
  }),
  "media.upload": operation<MediaUploadDto>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      slug: v.describe(v.string({ min: 1, max: 160 }), "公開 URL に使う画像の slug"),
      filename: v.string({ min: 1, max: 255 }),
      mimeType: v.describe(v.string({ max: 100 }), "image/jpeg など"),
      dataBase64: v.describe(
        v.optional(v.string({ max: 28_000_000 }), ""),
        "画像ファイルの中身（Base64）。20MB まで",
      ),
    }),
    description:
      "画像をライブラリに追加します。同じ内容の画像がすでにあれば追加せず、その画像を duplicate: true で返します。返ってきた url を本文に ![説明](url) で書けます。",
    tool: { name: "upload_media", title: "Upload media" },
    target: { type: "media" },
  }),
};
