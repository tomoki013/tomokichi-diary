import { v } from "../validation.js";

/** Field shapes shared across operations. */
export const id = v.string({ min: 1, max: 160 });
export const slug = v.string({ min: 1, max: 96, pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ });
export const plainDate = v.string({ min: 10, max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ });
export const title = v.string({ min: 1, max: 120 });
export const summary = v.string({ min: 1, max: 400 });
export const body = v.string({ min: 1, max: 200_000 });
export const none = v.object({});
export const articleId = v.describe(id, "記事の ID");
export const noteId = v.describe(id, "一言日記の ID");
