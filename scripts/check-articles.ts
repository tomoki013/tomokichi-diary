import { validatePublishable } from "@tomokichi/domain";
import type { Finding } from "./lib/report.js";
import { loadSnapshot, report } from "./lib/built-site.js";

/**
 * Every article the build is about to serve must pass the same rule the API
 * applies when it publishes. An article can reach the snapshot another way —
 * published before a rule existed, loaded from export/, migrated by a script —
 * and this is the one place all of those meet, so the site never serves
 * content the publish check would refuse.
 */
const snapshot = loadSnapshot();
const revisionById = new Map(snapshot.revisions.map((revision) => [revision.id, revision]));
const findings: Finding[] = [];
let checked = 0;

for (const article of snapshot.articles) {
  if (article.status !== "published" || article.publishedRevisionId === null) continue;
  const revision = revisionById.get(article.publishedRevisionId);
  const target = article.slug;
  if (!revision) {
    findings.push({
      code: "ARTICLE_NOT_PUBLISHABLE",
      target,
      message: `published revision ${article.publishedRevisionId} is missing from the snapshot`,
      rerun: "pnpm check:articles",
    });
    continue;
  }
  checked++;
  const expectedTarget = article.kind === "page" ? "static" : "article";
  const problems = validatePublishable({
    article,
    revision,
    canonicalRoute: snapshot.routes.find(
      (route) =>
        route.isCanonical && route.targetType === expectedTarget && route.targetId === article.id,
    ),
    media: snapshot.articleMedia.filter((media) => media.articleId === article.id),
    routes: snapshot.routes,
    // Already live, so a scheduled time can only lie in the past.
    now: article.publishedAt ?? article.updatedAt,
  });
  for (const problem of problems) {
    findings.push({
      code: "ARTICLE_NOT_PUBLISHABLE",
      target,
      message: problem.message,
      rerun: "pnpm check:articles",
    });
  }
}

report(findings, { articles: checked }, "articles");
