import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildKnowledgeCatalog, loadContentSnapshot } from "@tomokichi/application";
import { buildExportFiles } from "@tomokichi/data";
import { createLocalContext } from "./lib/local-db.js";

/**
 * Writes the whole content graph as Markdown + JSON. The result is committed,
 * so the public site can be rebuilt from the repository alone and the content
 * survives the database it happens to live in (instruction §53).
 */
const outDir = join(process.cwd(), "export");

const ctx = await createLocalContext();
const snapshot = await loadContentSnapshot(ctx);
const files = buildExportFiles(snapshot);
files.push({
  path: "knowledge/catalog.json",
  contents: `${JSON.stringify(buildKnowledgeCatalog(snapshot), null, 2)}\n`,
});
const migrated = new Set(snapshot.articleKnowledge.map((entry) => entry.articleId));
const backlog = snapshot.articles.flatMap((article) => {
  if (article.kind !== "article" || article.status !== "published" || migrated.has(article.id))
    return [];
  const revision = snapshot.revisions.find((entry) => entry.id === article.publishedRevisionId);
  const route = snapshot.routes.find(
    (entry) => entry.targetType === "article" && entry.targetId === article.id && entry.isCanonical,
  );
  return revision && route
    ? [
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
      ]
    : [];
});
files.push({
  path: "knowledge/migration-backlog.json",
  contents: `${JSON.stringify({ generatedAt: snapshot.generatedAt, migrated: migrated.size, pending: backlog.length, items: backlog }, null, 2)}\n`,
});

rmSync(outDir, { recursive: true, force: true });
for (const file of files) {
  const path = join(outDir, file.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.contents);
}

process.stdout.write(
  `✓ export ${files.length} files | articles ${snapshot.articles.length} | routes ${snapshot.routes.length} | media ${snapshot.media.length}\n`,
);
