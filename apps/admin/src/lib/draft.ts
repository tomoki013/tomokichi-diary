import type { ArticleDetailDto } from "@tomokichi/contracts";

/** What the editor sends to save a draft. */
export interface DraftInput {
  title: string;
  summary: string;
  bodyMarkdown: string;
  seoTitleOverride: string | null;
  seoDescriptionOverride: string | null;
  changeSummary: string | null;
}

/** The editable draft for an article, starting from its current revision. */
export function draftFrom(article: ArticleDetailDto): DraftInput {
  const revision = article.currentRevision;
  return {
    title: revision?.title ?? "",
    summary: revision?.summary ?? "",
    bodyMarkdown: revision?.bodyMarkdown ?? "",
    seoTitleOverride: revision?.seoTitleOverride ?? null,
    seoDescriptionOverride: revision?.seoDescriptionOverride ?? null,
    changeSummary: null,
  };
}

const blank = (value: string | null): string => value ?? "";
const orNull = (value: string | null): string | null =>
  value === null || value.trim() === "" ? null : value;

/**
 * Whether the draft differs from what was last saved. The change summary is
 * a note about the save, not content, so it alone does not make a draft dirty.
 * An empty override and no override are the same thing.
 */
export function isDirty(draft: DraftInput, saved: DraftInput): boolean {
  return (
    draft.title !== saved.title ||
    draft.summary !== saved.summary ||
    draft.bodyMarkdown !== saved.bodyMarkdown ||
    blank(draft.seoTitleOverride) !== blank(saved.seoTitleOverride) ||
    blank(draft.seoDescriptionOverride) !== blank(saved.seoDescriptionOverride)
  );
}

/** Empty overrides are sent as null so the site falls back to generating them. */
export function normalizeDraft(draft: DraftInput): DraftInput {
  return {
    ...draft,
    seoTitleOverride: orNull(draft.seoTitleOverride),
    seoDescriptionOverride: orNull(draft.seoDescriptionOverride),
    changeSummary: orNull(draft.changeSummary),
  };
}

/** Rough reading metrics for the editor's status line. */
export function bodyStats(markdown: string): { characters: number; minutes: number } {
  const characters = markdown.replace(/\s+/g, "").length;
  // ~500 Japanese characters a minute.
  return { characters, minutes: Math.max(1, Math.round(characters / 500)) };
}
