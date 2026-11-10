import { v } from "@tomokichi/contracts";

/** The knowledge bundle a save sends, checked field by field before the use case sees it. */
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
