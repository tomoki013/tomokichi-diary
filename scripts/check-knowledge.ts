import { validateKnowledgeGraph } from "@tomokichi/domain";
import { loadSnapshot } from "./lib/built-site.js";

const snapshot = loadSnapshot();
const issues = validateKnowledgeGraph({
  sources: snapshot.sources,
  travelRoutes: snapshot.travelRoutes,
  travelFacts: snapshot.travelFacts,
  articleKnowledge: snapshot.articleKnowledge,
  articleIds: new Set(snapshot.articles.map((article) => article.id)),
  revisionIds: new Set(snapshot.revisions.map((revision) => revision.id)),
  placeIds: new Set(snapshot.places.map((place) => place.id)),
  today: new Date().toISOString().slice(0, 10),
});
const findings = issues.map((issue) => ({
  code: "KNOWLEDGE_VALIDATION_FAILED" as const,
  target: issue.target,
  message: `${issue.code}: ${issue.message}`,
  rerun: "pnpm check:knowledge",
}));
const payload = {
  metrics: {
    facts: snapshot.travelFacts.length,
    firsthand: snapshot.travelFacts.filter(
      (fact) => fact.provenance === "firsthand" && fact.status === "verified",
    ).length,
    knowledgeArticles: snapshot.articleKnowledge.length,
  },
  findings,
};
if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(payload)}\n`);
else if (findings.length === 0)
  process.stdout.write(
    `✓ knowledge ${payload.metrics.facts} facts | ${payload.metrics.firsthand} firsthand | ${payload.metrics.knowledgeArticles} articles\n`,
  );
else
  for (const finding of findings)
    process.stdout.write(`${finding.code} ${finding.target}\n  ${finding.message}\n`);
process.exit(findings.length > 0 ? 1 : 0);
