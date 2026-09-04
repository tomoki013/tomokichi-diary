import {
  parsePlainDate,
  type AIArtifact,
  type AIArtifactId,
  type ArticleId,
  type TravelFact,
  type TravelFactId,
  type TravelFactKind,
} from "@tomokichi/domain";
import type { AppContext } from "../../context.js";

const kinds = new Set<TravelFactKind>([
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
]);

/** AI may suggest candidates, but never marks a claim verified or firsthand-authorized. */
export async function suggestTravelFactCandidates(ctx: AppContext, articleId: ArticleId) {
  if (!ctx.ai) return { available: false as const, facts: [] as readonly TravelFact[] };
  const article = await ctx.repos.articles.findById(articleId);
  const revision = article?.currentRevisionId
    ? await ctx.repos.revisions.findById(article.currentRevisionId)
    : null;
  if (!article || !revision) throw new Error(`article not found: ${articleId}`);
  const completion = await ctx.ai.complete({
    instruction:
      "Extract only explicit travel claims. Return a JSON array of objects with statement, kind, provenance, and experiencedAt. provenance must be firsthand, official, researched, or derived. Do not infer missing facts.",
    input: `${revision.title}\n${revision.summary}\n${revision.bodyMarkdown}`,
    maxOutputTokens: 3_000,
  });
  const raw = JSON.parse(completion.text) as unknown;
  if (!Array.isArray(raw)) throw new Error("AI candidate response must be an array");
  const facts: TravelFact[] = raw.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (typeof item.statement !== "string" || !kinds.has(item.kind as TravelFactKind)) return [];
    const provenance = ["firsthand", "official", "researched", "derived"].includes(
      String(item.provenance),
    )
      ? (item.provenance as TravelFact["provenance"])
      : "derived";
    const parsedDate =
      typeof item.experiencedAt === "string" ? parsePlainDate(item.experiencedAt) : null;
    return [
      {
        id: ctx.ids.next<TravelFactId>(),
        kind: item.kind as TravelFactKind,
        statement: item.statement.trim(),
        provenance,
        status: "candidate",
        experiencedAt: parsedDate?.ok ? parsedDate.value : null,
        verifiedAt: null,
        value: null,
        volatility: null,
        articleIds: [articleId],
        placeIds: [],
        sourceIds: [],
        travelRouteId: null,
        verifiedBy: null,
      },
    ];
  });
  const artifact: AIArtifact = {
    id: ctx.ids.next<AIArtifactId>(),
    entityType: "article",
    entityId: articleId,
    sourceRevisionId: revision.id,
    kind: "content_audit",
    content: { candidates: facts },
    createdAt: ctx.clock.now(),
    generator: completion.generator,
  };
  await ctx.repos.aiArtifacts.save(artifact);
  await Promise.all(facts.map((fact) => ctx.repos.knowledge.saveTravelFact(fact)));
  return { available: true as const, facts };
}
