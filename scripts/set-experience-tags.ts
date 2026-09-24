import { readFileSync } from "node:fs";
import { setArticleExperienceTags } from "@tomokichi/application";
import type { Slug } from "@tomokichi/domain";
import { parse as parseYaml } from "yaml";
import { createLocalContext } from "./lib/local-db.js";

/**
 * Sets experience tags on many articles at once, through the same use case the
 * admin API calls, against the local authoring database. Run
 * `pnpm db:restore-local` first and `pnpm export:data` afterwards, exactly as
 * with `pnpm content:revise`.
 *
 *   pnpm content:experiences path/to/experience-tags.yaml
 *
 * File: one entry per article slug; the list replaces what the article had
 * and `[]` clears it. Articles not named are left alone.
 *
 *   egypt4: [thrilling, unforgettable]
 *   turkey3:
 *     - moving
 *     - unforgettable
 */
const [file] = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
if (!file) {
  process.stderr.write("usage: pnpm content:experiences <experience-tags.yaml>\n");
  process.exit(2);
}

const entries = parseYaml(readFileSync(file, "utf8")) as Record<string, unknown> | null;
if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
  throw new Error(`${file}: expected a mapping of slug → experience tags`);
}

const ctx = await createLocalContext();
const problems: string[] = [];
let updated = 0;

for (const [slug, value] of Object.entries(entries)) {
  // A lookup, not a new slug: legacy slugs (`trip_com-…`) predate `parseSlug`
  // and must still be addressable.
  const article = await ctx.repos.articles.findBySlug(slug as Slug, "ja");
  if (!article) {
    problems.push(`${slug}: no such article`);
    continue;
  }
  const result = await setArticleExperienceTags(
    ctx,
    article.id,
    Array.isArray(value) ? value : [value],
  );
  if (!result.ok) {
    problems.push(`${slug}: ${result.errors.map((error) => error.message).join("; ")}`);
    continue;
  }
  updated += 1;
}

if (problems.length > 0) {
  process.stderr.write(`${problems.map((problem) => `✗ ${problem}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`✓ experience tags set on ${updated} articles — now run pnpm export:data\n`);
