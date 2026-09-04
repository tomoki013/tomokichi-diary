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

const nullableString = v.nullable(v.string({ max: 2_000 }));
const idList = v.array(v.string({ min: 1, max: 160 }), { max: 200 });
const provenance = v.literalUnion(["firsthand", "official", "researched", "derived"] as const);
const routePointSchema = v.object({
  name: v.string({ min: 1, max: 200 }),
  placeId: nullableString,
  latitude: v.nullable(v.number({ min: -90, max: 90 })),
  longitude: v.nullable(v.number({ min: -180, max: 180 })),
  externalMapUrl: nullableString,
});

export const knowledgeBundleSchema = v.object({
  article: v.nullable(
    v.object({
      articleId: v.string({ min: 1 }),
      revisionId: v.string({ min: 1 }),
      schemaVersion: v.number({ integer: true, min: 1, max: 1 }),
      quickAnswer: v.nullable(
        v.object({
          summary: v.string({ min: 1, max: 1_000 }),
          recommendation: nullableString,
        }),
      ),
      decisionTable: v.nullable(
        v.object({
          title: v.string({ min: 1, max: 200 }),
          columns: v.array(v.string({ min: 1, max: 100 }), { max: 12 }),
          rows: v.array(
            v.object({
              label: v.string({ min: 1, max: 200 }),
              values: v.array(v.string({ max: 500 }), { max: 12 }),
            }),
            { max: 100 },
          ),
        }),
      ),
      experienceGroups: v.array(
        v.object({
          id: v.string({ min: 1, max: 160 }),
          title: v.string({ min: 1, max: 200 }),
          summary: v.string({ max: 2_000 }),
          factIds: idList,
        }),
        { max: 50 },
      ),
      currentFactIds: idList,
      cautionFactIds: idList,
      routeIds: idList,
      relatedArticles: v.array(
        v.object({
          articleId: v.string({ min: 1 }),
          relation: v.literalUnion([
            "detail",
            "recommendation",
            "how-to",
            "trip-diary",
            "location-guide",
            "next-step",
          ] as const),
        }),
        { max: 100 },
      ),
    }),
  ),
  facts: v.array(
    v.object({
      id: v.string({ min: 1, max: 160 }),
      kind: v.literalUnion([
        "visit",
        "food_drink",
        "transport",
        "cost",
        "duration",
        "procedure",
        "observation",
        "recommendation",
        "warning",
        "current_fact",
      ] as const),
      statement: v.string({ min: 1, max: 4_000 }),
      provenance,
      status: v.literalUnion(["candidate", "verified"] as const),
      experiencedAt: nullableString,
      verifiedAt: nullableString,
      value: v.nullable(
        v.object({ amount: v.number(), unit: nullableString, currency: nullableString }),
      ),
      volatility: v.nullable(v.literalUnion(["low", "medium", "high"] as const)),
      articleIds: idList,
      placeIds: idList,
      sourceIds: idList,
      travelRouteId: nullableString,
      verifiedBy: nullableString,
    }),
    { max: 500 },
  ),
  sources: v.array(
    v.object({
      id: v.string({ min: 1, max: 160 }),
      type: v.literalUnion(["firsthand-note", "official", "external"] as const),
      name: v.string({ min: 1, max: 300 }),
      url: nullableString,
      checkedAt: nullableString,
    }),
    { max: 500 },
  ),
  routes: v.array(
    v.object({
      id: v.string({ min: 1, max: 160 }),
      name: v.string({ min: 1, max: 300 }),
      mode: v.literalUnion(["walk", "bus", "train", "car", "air", "mixed"] as const),
      start: routePointSchema,
      waypoints: v.array(routePointSchema, { max: 100 }),
      end: routePointSchema,
      durationMinutes: v.nullable(v.number({ min: 0 })),
      distanceKm: v.nullable(v.number({ min: 0 })),
      experiencedAt: nullableString,
      provenance,
      note: nullableString,
    }),
    { max: 200 },
  ),
});
