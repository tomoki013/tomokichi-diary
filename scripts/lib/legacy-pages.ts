import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsxProseToMarkdown } from "./jsx-prose.js";
import { LEGACY_REPO, loadLegacyModule } from "./legacy-source.js";

/**
 * Standalone pages (about, FAQ, legal) carried over from the legacy app.
 *
 * They are imported as `page`-kind articles: same title, body, revisions and
 * SEO handling as an article, but never listed or syndicated.
 */
export interface LegacyPage {
  key: string;
  /** URL in the tidied structure; the legacy path is redirected to it. */
  path: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  unknown: string[];
}

interface PageSource {
  key: string;
  path: string;
  /** Files whose JSX prose makes up the body, in order. */
  files: string[];
}

const PAGE_SOURCES: PageSource[] = [
  { key: "privacy", path: "/legal/privacy", files: ["src/app/(pages)/privacy/page.tsx"] },
  { key: "terms", path: "/legal/terms", files: ["src/app/(pages)/terms/page.tsx"] },
  {
    key: "cookie-policy",
    path: "/legal/cookies",
    files: ["src/app/(pages)/cookie-policy/page.tsx"],
  },
  {
    key: "editorial-policy",
    path: "/legal/editorial-policy",
    files: ["src/app/(pages)/editorial-policy/page.tsx"],
  },
  { key: "affiliates", path: "/legal/affiliates", files: ["src/app/(pages)/affiliates/page.tsx"] },
  { key: "contact", path: "/contact", files: ["src/app/(pages)/contact/page.tsx"] },
  {
    key: "about",
    path: "/about",
    files: [
      "src/components/features/about/AboutJourneySection.tsx",
      "src/components/features/about/AboutMeSection.tsx",
      // FootprintsSection is a world map driven by live counts; the new /about
      // template renders that from Location data instead of frozen prose.
    ],
  },
];

function metadataOf(key: string): { title: string; summary: string } {
  const source = safeRead(`src/app/(pages)/${key}/page.tsx`);
  if (source === null) return { title: key, summary: "" };

  // Most pages declare metadata explicitly; the legal ones pass it to their
  // shared layout instead.
  const title = /title:\s*"([^"]*)"/.exec(source)?.[1] ?? /title="([^"]*)"/.exec(source)?.[1];
  const description =
    /description:\s*\n?\s*"([^"]*)"/.exec(source)?.[1] ?? /description="([^"]*)"/.exec(source)?.[1];

  // The site name is appended by the new metadata builder, so it is stripped
  // here rather than ending up duplicated.
  return {
    title: (title ?? key).replace(/\s*[|｜]\s*ともきちの旅行日記\s*$/, "").trim(),
    summary: description ?? "",
  };
}

function safeRead(relativePath: string): string | null {
  try {
    return readFileSync(join(LEGACY_REPO, relativePath), "utf8");
  } catch {
    return null;
  }
}

/** The JSX body is what sits between the component's `return (` and its closing `);`. */
function bodyOf(source: string): string {
  const start = source.indexOf("return (");
  if (start === -1) return source;
  const body = source.slice(start + "return (".length);
  const end = body.lastIndexOf(");");
  return end === -1 ? body : body.slice(0, end);
}

/**
 * Only programs the legacy page actually rendered are listed; the rest are
 * placeholders. The disclosure has to name real partners, so it is generated
 * from the same source the page used rather than hand-copied.
 */
function affiliateProgramList(): string {
  const source = safeRead("src/constants/affiliates.tsx");
  if (source === null) return "";

  const entries = [
    ...source.matchAll(/name:\s*"([^"]+)"[\s\S]*?homeUrl:\s*"([^"]+)"[\s\S]*?status:\s*"(\w+)"/g),
  ]
    .filter((match) => match[3] === "ready" && !match[2]!.startsWith("YOUR_"))
    .map((match) => `- [${match[1]}](${match[2]})`);

  return entries.length === 0 ? "" : `\n\n${entries.join("\n")}`;
}

interface FaqItem {
  question: string;
  answer: string;
  category: string;
}

interface FaqCategory {
  id: string;
  label: string;
}

/**
 * The FAQ was an interactive accordion over structured data. Rendering it as
 * ordinary prose keeps the questions and answers readable to both people and
 * machines, which the accordion did not.
 */
async function buildFaqPage(): Promise<LegacyPage> {
  const [items, categories] = await Promise.all([
    loadLegacyModule<FaqItem[]>("src/data/faq.ts", "FAQS"),
    loadLegacyModule<FaqCategory[]>("src/data/faq.ts", "FAQ_CATEGORIES"),
  ]);

  const sections = categories
    .filter((category) => category.id !== "all")
    .map((category) => {
      const questions = items.filter((item) => item.category === category.id);
      if (questions.length === 0) return null;
      return [
        `## ${category.label}`,
        "",
        ...questions.flatMap((item) => [`### ${item.question}`, "", item.answer.trim(), ""]),
      ].join("\n");
    })
    .filter((section) => section !== null);

  const metadata = metadataOf("faq");
  return {
    key: "faq",
    path: "/faq",
    title: metadata.title,
    summary: metadata.summary,
    bodyMarkdown: sections.join("\n"),
    unknown: [],
  };
}

export async function readLegacyPages(): Promise<LegacyPage[]> {
  const pages: LegacyPage[] = [];

  for (const source of PAGE_SOURCES) {
    const parts = source.files.map((file) => {
      const contents = safeRead(file);
      if (contents === null) throw new Error(`missing legacy page source: ${file}`);
      return jsxProseToMarkdown(bodyOf(contents));
    });
    const metadata = metadataOf(source.key);
    pages.push({
      key: source.key,
      path: source.path,
      title: metadata.title,
      summary: metadata.summary,
      bodyMarkdown: (
        parts.map((part) => part.markdown).join("\n\n") +
        (source.key === "affiliates" ? affiliateProgramList() : "")
      ).trim(),
      unknown: [...new Set(parts.flatMap((part) => part.unknown))],
    });
  }

  pages.push(await buildFaqPage());
  return pages;
}
