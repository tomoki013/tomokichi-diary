/** Generates an isolated public snapshot for mocked browser checks. Never writes export/ or D1. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { parseExportFiles, buildExportFiles } from "@tomokichi/data";
const snapshot = parseExportFiles((path) => {
  try {
    return readFileSync(join("export", path), "utf8");
  } catch {
    return null;
  }
});
const articleId = "52b1cb6d-eb74-85a3-b6a1-392f83313051";
const article = snapshot.articles.find((a) => a.id === articleId);
if (!article) throw new Error("missing fixture article");
const revision = snapshot.revisions.find((r) => r.id === article.publishedRevisionId)!;
const paragraphs = revision.bodyMarkdown.split(/\n\s*\n/);
const insertion = paragraphs.findIndex(
  (p) =>
    p.startsWith("## 初めて") ||
    p.startsWith("## 5") ||
    p.startsWith("## 注文") ||
    p.startsWith("## まとめ"),
);
const body =
  insertion > 0
    ? [
        ...paragraphs.slice(0, insertion),
        "{{monetization:answers-complete}}",
        "{{monetization:private-affiliate}}",
        ...paragraphs.slice(insertion),
      ].join("\n\n")
    : `${revision.bodyMarkdown}\n\n{{monetization:answers-complete}}\n\n{{monetization:private-affiliate}}\n\n旅行の記録を続けます。`;
const fixture = {
  ...snapshot,
  revisions: snapshot.revisions.map((r) =>
    r.id === revision.id ? { ...r, bodyMarkdown: body } : r,
  ),
  monetization: [
    {
      ...(process.argv.includes("--affiliates")
        ? {
            affiliates: [
              {
                key: "private-affiliate",
                position: "marker" as const,
                provider: "Trip.com",
                heading: "旅の予約先を比較する",
                description: "料金・変更条件は予約先で確認できます。",
                url: "https://www.trip.com/t/FixtureLink",
                format: "booking_card" as const,
              },
            ],
          }
        : {}),
      articleId,
      enabled: true,
      placement: { key: "article-end", position: "article_end" as const, adUnit: "7152502134" },
      experiment: {
        id: "chagee-placement-v1",
        markerKey: "answers-complete",
        adUnitA: "7152502134",
        adUnitB: "1234567890",
        shareB: 50,
      },
    },
  ],
};
const output = resolve(".artifacts/monetization/export");
for (const file of buildExportFiles(fixture)) {
  const path = join(output, file.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.contents);
}
process.stdout.write(`${output}\n`);
