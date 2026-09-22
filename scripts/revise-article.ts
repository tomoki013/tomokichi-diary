import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  fixedClock,
  publishArticle,
  saveEditableKnowledge,
  updateArticleDraft,
} from "@tomokichi/application";
import { instantFrom, parseSlug, type AuthorId, type Instant } from "@tomokichi/domain";
import { parse as parseYaml } from "yaml";
import { createLocalContext } from "./lib/local-db.js";

/**
 * Publishes a new revision of an existing article from a Markdown file, through
 * the same use cases the admin API calls (draft → publish), against the local
 * authoring database. Run `pnpm db:restore-local` first so the edit starts from
 * the committed export, and `pnpm export:data` afterwards.
 *
 *   pnpm content:revise path/to/revision.md [more.md ...]
 *
 * Revision file:
 *
 *   ---
 *   slug: batu-caves-guide          required
 *   title: …                        optional; omitted = unchanged
 *   summary: …                      optional; omitted = unchanged
 *   seoDescription: …               optional; omitted = unchanged, "" = cleared
 *   changeSummary: …                required; shown in the revision history
 *   updatedAt: 2026-09-22           optional; omitted = now, "keep" = do not
 *                                   touch article.updatedAt (metadata-only edit)
 *   ---
 *   body markdown                   optional; empty = unchanged
 *
 * `publishedAt` is never written: publishing an existing article keeps it.
 * Travel knowledge attached to the previous revision is carried over to the
 * new one (through the same validated use case the admin uses), so the
 * knowledge sidecar, WebMCP and the MCP catalog do not silently lose the
 * article when its prose is edited.
 */
interface RevisionFile {
  slug: string;
  title?: string;
  summary?: string;
  seoDescription?: string;
  changeSummary: string;
  updatedAt?: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function readRevisionFile(path: string): { meta: RevisionFile; body: string } {
  const raw = readFileSync(path, "utf8");
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) throw new Error(`${path}: no frontmatter`);
  const meta = parseYaml(match[1]!) as RevisionFile;
  if (!meta.slug) throw new Error(`${path}: slug is required`);
  if (!meta.changeSummary) throw new Error(`${path}: changeSummary is required`);
  return { meta, body: raw.slice(match[0].length).trim() };
}

const files = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
if (files.length === 0) {
  process.stderr.write("usage: pnpm content:revise <revision.md> [...]\n");
  process.exit(2);
}

const base = await createLocalContext();

for (const file of files) {
  const { meta, body } = readRevisionFile(file);
  const slug = parseSlug(meta.slug);
  if (!slug.ok) throw new Error(`${file}: invalid slug ${meta.slug}`);
  const article = await base.repos.articles.findBySlug(slug.value, "ja");
  if (!article) throw new Error(`${file}: no article with slug ${meta.slug}`);
  const previous = article.publishedRevisionId
    ? await base.repos.revisions.findById(article.publishedRevisionId)
    : null;
  if (!previous) throw new Error(`${file}: ${meta.slug} has no published revision`);

  const keepUpdatedAt = meta.updatedAt === "keep";
  const now: Instant =
    meta.updatedAt && !keepUpdatedAt
      ? instantFrom(`${String(meta.updatedAt).slice(0, 10)}T00:00:00.000Z`)
      : instantFrom(Date.now());
  const ctx = { ...base, clock: fixedClock(now) };

  const draft = await updateArticleDraft(
    ctx,
    article.id,
    {
      title: meta.title ?? previous.title,
      summary: meta.summary ?? previous.summary,
      bodyMarkdown: body || previous.bodyMarkdown,
      seoTitleOverride: previous.seoTitleOverride,
      seoDescriptionOverride:
        meta.seoDescription === undefined
          ? previous.seoDescriptionOverride
          : meta.seoDescription.trim() || null,
      changeSummary: meta.changeSummary,
    },
    article.authorId as AuthorId,
  );
  if (!draft.ok) throw new Error(`${file}: ${JSON.stringify(draft.errors)}`);

  const published = await publishArticle(ctx, article.id);
  if (!published.ok) throw new Error(`${file}: ${JSON.stringify(published.errors)}`);

  // A metadata-only change (description, SEO title) is not an update readers
  // should be told about, so the article's updatedAt is put back.
  if (keepUpdatedAt) {
    await base.repos.articles.save({ ...published.value, updatedAt: article.updatedAt });
  }

  const knowledge = (await base.repos.knowledge.listArticleKnowledge()).find(
    (entry) => entry.articleId === article.id && entry.revisionId === previous.id,
  );
  if (knowledge) {
    const facts = (await base.repos.knowledge.listTravelFacts()).filter((fact) =>
      fact.articleIds.includes(article.id),
    );
    const sourceIds = new Set(facts.flatMap((fact) => fact.sourceIds));
    const routeIds = new Set([
      ...knowledge.routeIds,
      ...facts.flatMap((fact) => fact.travelRouteId ?? []),
    ]);
    await saveEditableKnowledge(ctx, article.id, {
      article: { ...knowledge, revisionId: draft.value.revision.id },
      facts,
      sources: (await base.repos.knowledge.listSources()).filter((s) => sourceIds.has(s.id)),
      routes: (await base.repos.knowledge.listTravelRoutes()).filter((r) => routeIds.has(r.id)),
    });
  }

  process.stdout.write(
    `✓ ${meta.slug} revision ${draft.value.revision.revisionNumber} published (${basename(file)})` +
      ` | updatedAt ${keepUpdatedAt ? article.updatedAt : now}` +
      `${knowledge ? " | travel knowledge carried over" : ""}\n`,
  );
}

process.stdout.write("next: pnpm export:data && pnpm legacy:export\n");
