import { v } from "@tomokichi/contracts";

/** Every request body the admin API accepts, validated before it reaches a use case. */
export const draftSchema = v.object({
  title: v.string({ min: 1, max: 120 }),
  summary: v.string({ min: 1, max: 400 }),
  bodyMarkdown: v.string({ min: 1, max: 200_000 }),
  seoTitleOverride: v.nullable(v.string({ max: 120 })),
  seoDescriptionOverride: v.nullable(v.string({ max: 400 })),
  changeSummary: v.nullable(v.string({ max: 400 })),
});

export const createArticleSchema = v.object({
  slug: v.string({ min: 1, max: 96, pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ }),
  locale: v.literalUnion(["ja", "en"] as const),
  kind: v.optional(v.literalUnion(["article", "page"] as const), "article"),
  path: v.string({ min: 1, max: 255 }),
  draft: draftSchema,
});

export const scheduleSchema = v.object({ at: v.string({ min: 20, max: 40 }) });

export const moveRouteSchema = v.object({
  from: v.string({ min: 1, max: 255 }),
  to: v.string({ min: 1, max: 255 }),
  status: v.optional(v.literalUnion(["301", "302", "308"] as const), "301"),
});

export const mediaUsageSchema = v.object({
  media: v.array(
    v.object({
      mediaId: v.string({ min: 1 }),
      role: v.literalUnion(["cover", "inline", "gallery", "og"] as const),
      sortOrder: v.number({ integer: true, min: 0 }),
      alt: v.string({ min: 1, max: 300 }),
      caption: v.nullable(v.string({ max: 300 })),
    }),
    { max: 100 },
  ),
});

const relationSchema = v.literalUnion(["primary", "visited", "mentioned", "related"] as const);

export const relationsSchema = v.object({
  locations: v.optional(
    v.array(v.object({ locationId: v.string({ min: 1 }), relation: relationSchema }), { max: 50 }),
    [],
  ),
  places: v.optional(
    v.array(v.object({ placeId: v.string({ min: 1 }), relation: relationSchema }), { max: 50 }),
    [],
  ),
  categoryIds: v.optional(v.array(v.string({ min: 1 }), { max: 10 }), []),
  tagIds: v.optional(v.array(v.string({ min: 1 }), { max: 50 }), []),
  collectionIds: v.optional(v.array(v.string({ min: 1 }), { max: 10 }), []),
});
