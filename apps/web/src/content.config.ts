import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * Article bodies are read from the committed export rather than from a
 * database, which is what makes the whole site statically generatable and the
 * build reproducible from the repository alone
 * (docs/adr/0006-build-time-content-snapshot.md).
 *
 * Only the body is read here; the content graph (routes, relations, media)
 * comes from the JSON part of the same export.
 */
const articles = defineCollection({
  loader: glob({ pattern: "*.md", base: "../../export/articles" }),
  schema: z.object({
    id: z.string(),
    slug: z.string(),
    locale: z.string(),
    status: z.string(),
    path: z.string().nullable().optional(),
    title: z.string(),
    summary: z.string(),
    revision: z.number(),
    publishedAt: z.string().nullable().optional(),
    updatedAt: z.string(),
    noindex: z.boolean(),
  }),
});

export const collections = { articles };
