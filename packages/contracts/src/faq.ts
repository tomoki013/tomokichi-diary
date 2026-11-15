/**
 * The FAQ page's body is ordinary page Markdown with a fixed shape:
 *
 *   ## Category
 *
 *   ### Question?
 *
 *   Answer (Markdown, any number of paragraphs)
 *
 * The public page and the admin's FAQ editor both read it through
 * `parseFaqMarkdown`, and the editor writes it back through
 * `formatFaqMarkdown`, so the stored body stays plain page Markdown that the
 * operator MCP (save_article_draft) can edit too.
 */
export interface FaqItem {
  question: string;
  /** Markdown. */
  answer: string;
}

export interface FaqGroup {
  title: string;
  items: FaqItem[];
}

export function parseFaqMarkdown(markdown: string): FaqGroup[] {
  const groups: FaqGroup[] = [];
  let group: FaqGroup | null = null;
  let item: FaqItem | null = null;
  const lines: string[] = [];

  const closeItem = () => {
    if (item) item.answer = lines.join("\n").trim();
    lines.length = 0;
    item = null;
  };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const category = /^##\s+(.+?)\s*$/.exec(line);
    const question = /^###\s+(.+?)\s*$/.exec(line);
    if (category && !line.startsWith("###")) {
      closeItem();
      group = { title: category[1]!, items: [] };
      groups.push(group);
    } else if (question) {
      closeItem();
      if (!group) {
        group = { title: "", items: [] };
        groups.push(group);
      }
      item = { question: question[1]!, answer: "" };
      group.items.push(item);
    } else if (item) {
      lines.push(line);
    }
  }
  closeItem();
  return groups;
}

export function formatFaqMarkdown(groups: readonly FaqGroup[]): string {
  const blocks: string[] = [];
  for (const group of groups) {
    const items = group.items.filter((item) => item.question.trim() || item.answer.trim());
    if (!group.title.trim() && items.length === 0) continue;
    blocks.push(`## ${oneLine(group.title)}`);
    for (const item of items) {
      blocks.push(`### ${oneLine(item.question)}`);
      if (item.answer.trim()) blocks.push(item.answer.trim());
    }
  }
  return blocks.length > 0 ? `${blocks.join("\n\n")}\n` : "";
}

/** What an editor must fix before the FAQ can be saved. */
export function faqProblems(groups: readonly FaqGroup[]): string[] {
  const problems: string[] = [];
  groups.forEach((group, groupIndex) => {
    const where = group.title.trim() || `${groupIndex + 1}番目のカテゴリ`;
    if (!group.title.trim() && group.items.length > 0)
      problems.push(`${groupIndex + 1}番目のカテゴリに名前がありません`);
    group.items.forEach((item, itemIndex) => {
      if (!item.question.trim() && !item.answer.trim()) return;
      if (!item.question.trim())
        problems.push(`「${where}」の${itemIndex + 1}番目に質問がありません`);
      if (!item.answer.trim())
        problems.push(`「${where}」の「${oneLine(item.question)}」に答えがありません`);
      if (/^#{1,6}\s/m.test(item.answer))
        problems.push(`「${oneLine(item.question)}」の答えに見出し（#）は使えません`);
    });
  });
  return problems;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
