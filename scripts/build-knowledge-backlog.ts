import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseExportFiles } from "@tomokichi/data";

const exportDir = join(process.cwd(), "export");
const snapshot = parseExportFiles((path) => {
  try {
    return readFileSync(join(exportDir, path), "utf8");
  } catch {
    return null;
  }
});
const migrated = new Set(snapshot.articleKnowledge.map((entry) => entry.articleId));
const backlog = snapshot.articles
  .flatMap((article) => {
    if (article.kind !== "article" || article.status !== "published" || migrated.has(article.id))
      return [];
    const revision = snapshot.revisions.find((entry) => entry.id === article.publishedRevisionId);
    const route = snapshot.routes.find(
      (entry) =>
        entry.targetType === "article" && entry.targetId === article.id && entry.isCanonical,
    );
    if (!revision || !route) return [];
    return [
      {
        articleId: article.id,
        revisionId: revision.id,
        title: revision.title,
        path: route.path,
        suggestedQuickAnswer: revision.summary,
        status: "needs-human-review",
        requiredChecks: [
          "本文から一次体験と一般情報を分離する",
          "一次体験の日付を訪問記録と照合する",
          "現在情報は公式ソースと確認日を付ける",
          "本文と構造化データの重複表現を編集する",
        ],
      },
    ];
  })
  .toSorted((a, b) => a.path.localeCompare(b.path));
const output = join(exportDir, "knowledge", "migration-backlog.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `${JSON.stringify({ generatedAt: snapshot.generatedAt, migrated: migrated.size, pending: backlog.length, items: backlog }, null, 2)}\n`,
);
process.stdout.write(
  `✓ knowledge migration backlog ${backlog.length} pending / ${migrated.size} migrated\n`,
);
