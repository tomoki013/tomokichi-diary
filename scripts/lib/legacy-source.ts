import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

export const LEGACY_REPO = process.env.LEGACY_REPO ?? join(process.cwd(), "..", "travel-diary");

/**
 * The legacy data files are TypeScript modules that import app-internal types
 * and path aliases. Rather than resolving the old project's build setup, the
 * declarations are stripped and the remaining object literals are imported by
 * tsx. Anything unexpected therefore fails loudly instead of silently.
 */
export async function loadLegacyModule<T>(relativePath: string, exportName: string): Promise<T> {
  const source = readFileSync(join(LEGACY_REPO, relativePath), "utf8")
    .replace(/^import[\s\S]*?;\s*$/gm, "")
    .replace(/^export interface [\s\S]*?^}\s*$/gm, "");

  const dir = mkdtempSync(join(tmpdir(), "tomokichi-legacy-"));
  const file = join(dir, `${exportName}.mts`);
  writeFileSync(file, source);
  const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  const value = module[exportName];
  if (value === undefined) throw new Error(`${relativePath} does not export ${exportName}`);
  return value as T;
}

export interface LegacyPost {
  readonly slug: string;
  readonly frontmatter: LegacyFrontmatter;
  readonly body: string;
}

export interface LegacyFrontmatter {
  title: string;
  excerpt: string;
  publishedAt: string;
  updatedAt?: string;
  category: string;
  tags: string[];
  heroImage: string;
  regionIds: string[];
  author: string;
  noindex?: boolean;
  journeyId?: string;
  series?: { slug: string };
  travelTopics?: string[];
  travelDates?: { start?: string; end?: string };
  promotionPrograms?: unknown;
  costReport?: unknown;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function readLegacyPosts(): LegacyPost[] {
  const dir = join(LEGACY_REPO, "posts");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .toSorted()
    .map((name) => {
      const raw = readFileSync(join(dir, name), "utf8");
      const match = FRONTMATTER_RE.exec(raw);
      if (!match) throw new Error(`${name} has no frontmatter`);
      return {
        slug: name.replace(/\.md$/, ""),
        frontmatter: parseYaml(match[1]!) as LegacyFrontmatter,
        body: raw.slice(match[0].length).trim(),
      };
    });
}

export interface LegacyRegionNode {
  slug: string;
  name: string;
  imageURL?: string;
  children?: LegacyRegionNode[];
  countries?: LegacyRegionNode[];
}

export function loadLegacyRegions(): Promise<LegacyRegionNode[]> {
  return loadLegacyModule<LegacyRegionNode[]>("src/data/region.ts", "regionData");
}

export interface LegacySeries {
  id: number;
  slug: string;
  title: string;
  description: string;
  imageUrl: string;
}

export function loadLegacySeries(): Promise<LegacySeries[]> {
  return loadLegacyModule<LegacySeries[]>("src/data/series.ts", "featuredSeries");
}

export interface LegacyJourney {
  id: string;
  date: string;
  title: string;
  location: string;
  description: string;
  image?: string;
  tags?: string[];
}

export function loadLegacyJourneys(): Promise<LegacyJourney[]> {
  return loadLegacyModule<LegacyJourney[]>("src/data/journey.ts", "JOURNEY_DATA");
}
