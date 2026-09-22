import { COMPARED_FIELDS, summarize, type ParityEntry } from "./compare.js";

const FIELD_LABELS: Record<(typeof COMPARED_FIELDS)[number], string> = {
  title: "title",
  description: "meta description",
  summary: "summary / excerpt",
  publishedAt: "publishedAt",
  updatedAt: "updatedAt",
  noindex: "noindex",
  canonical: "canonical",
  cover: "cover image",
  headings: "headings",
  body: "body",
  images: "images",
  links: "internal links",
};

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function excerpt(value: string, max = 80): string {
  const flat = value.replaceAll("\n", " ⏎ ");
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Renders `docs/migration/content-parity-report.md`.
 *
 * The table is deliberately one row per article with one column per compared
 * field, so a reviewer can scan for anything that is not `=` without reading
 * the two sites. Differences are expanded below the table.
 */
export function renderParityReport(
  entries: readonly ParityEntry[],
  options: { generatedAt: string; legacyRepo: string },
): string {
  const counts = summarize(entries);
  const lines: string[] = [];

  lines.push("# Content parity report — Diary 2.0 vs travel-diary");
  lines.push("");
  lines.push(
    `Generated ${options.generatedAt} by \`pnpm content:parity --report\` against \`${options.legacyRepo}\`. ` +
      "Do not edit by hand; the file is regenerated on every run.",
  );
  lines.push("");
  lines.push("Diary 2.0 (`export/`) is canonical. `CONFLICT` means the legacy site differs and");
  lines.push(
    "`pnpm legacy:export` has not been run (or the legacy change has not been folded into",
  );
  lines.push("2.0 through `pnpm content:revise`). See `docs/migration/legacy-content-sync.md`.");
  lines.push("");
  lines.push("| status | count |");
  lines.push("| --- | ---: |");
  for (const status of ["MATCHED", "CONFLICT", "NEW_ONLY", "OLD_ONLY"] as const) {
    lines.push(`| ${status} | ${counts[status]} |`);
  }
  lines.push("");

  lines.push("## Articles");
  lines.push("");
  lines.push(
    `| slug | public URL | old | new | ${COMPARED_FIELDS.map((f) => FIELD_LABELS[f]).join(" | ")} | result |`,
  );
  lines.push(`| --- | --- | :-: | :-: | ${COMPARED_FIELDS.map(() => ":-:").join(" | ")} | --- |`);
  for (const entry of entries) {
    const differing = new Set(entry.differences.map((d) => d.field));
    const marks = COMPARED_FIELDS.map((field) =>
      entry.status === "MATCHED" || entry.status === "CONFLICT"
        ? differing.has(field)
          ? "≠"
          : "="
        : "·",
    );
    lines.push(
      `| ${entry.slug} | ${entry.url} | ${entry.oldArticle ? "✓" : "—"} | ${entry.newArticle ? "✓" : "—"} | ${marks.join(" | ")} | ${entry.status} |`,
    );
  }
  lines.push("");

  const conflicts = entries.filter((e) => e.status !== "MATCHED");
  if (conflicts.length === 0) {
    lines.push("## Differences");
    lines.push("");
    lines.push("None. Both sites serve the same article set with the same content.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  lines.push("## Differences");
  lines.push("");
  for (const entry of conflicts) {
    lines.push(`### ${entry.slug} — ${entry.status}`);
    lines.push("");
    if (entry.status === "NEW_ONLY") {
      lines.push(
        "Published on Diary 2.0 only. Run `pnpm legacy:export` to add it to the legacy site.",
      );
      lines.push("");
      continue;
    }
    if (entry.status === "OLD_ONLY") {
      lines.push(
        "Published on the legacy site only. Create the article on Diary 2.0 (same slug, path, " +
          "publishedAt) with `pnpm content:revise`; the legacy sync never imports it automatically.",
      );
      lines.push("");
      continue;
    }
    lines.push("| field | Diary 2.0 (canonical) | travel-diary |");
    lines.push("| --- | --- | --- |");
    for (const difference of entry.differences) {
      lines.push(
        `| ${FIELD_LABELS[difference.field]} | ${cell(excerpt(difference.newValue))} | ${cell(excerpt(difference.oldValue))} |`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
