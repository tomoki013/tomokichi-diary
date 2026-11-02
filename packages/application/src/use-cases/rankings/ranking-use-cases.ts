import {
  err,
  isExperienceTag,
  ok,
  RANKING_LIMITS,
  type ArticleId,
  type DomainError,
  type Ranking,
  type RankingId,
  type RankingPick,
  type Result,
} from "@tomokichi/domain";
import type { AppContext } from "../../context.js";

export interface RankingInput {
  readonly title?: unknown;
  readonly note?: unknown;
  /** null clears the "more" link. */
  readonly experienceTag?: unknown;
  /** The whole list, first is #1; it replaces what was there. */
  readonly picks?: unknown;
  readonly sortOrder?: unknown;
}

const fail = (message: string, field: string): DomainError => ({
  code: "API_VALIDATION_FAILED",
  message,
  field,
});

function text(value: unknown, field: string, max: number, required: boolean): Result<string> {
  if (typeof value !== "string") return err(fail(`${field} must be a string`, field));
  const trimmed = value.trim();
  if (required && trimmed === "") return err(fail(`${field} is required`, field));
  if (trimmed.length > max) return err(fail(`${field} must be at most ${max} characters`, field));
  return ok(trimmed);
}

/** Every pick must name an existing article, once; the article need not be published yet. */
async function parsePicks(ctx: AppContext, value: unknown): Promise<Result<RankingPick[]>> {
  if (!Array.isArray(value)) return err(fail("picks must be a list", "picks"));
  if (value.length > RANKING_LIMITS.picks)
    return err(fail(`at most ${RANKING_LIMITS.picks} picks`, "picks"));
  const articles = new Set<string>((await ctx.repos.articles.listAll()).map((a) => a.id));
  const picks: RankingPick[] = [];
  for (const [index, entry] of value.entries()) {
    const field = `picks.${index}`;
    if (typeof entry !== "object" || entry === null)
      return err(fail("each pick needs an articleId", field));
    const { articleId, comment } = entry as Record<string, unknown>;
    if (typeof articleId !== "string" || !articles.has(articleId))
      return err(fail(`no article ${String(articleId)}`, `${field}.articleId`));
    if (picks.some((pick) => pick.articleId === articleId))
      return err(fail(`article ${articleId} is already ranked`, `${field}.articleId`));
    const line = text(comment ?? "", `${field}.comment`, RANKING_LIMITS.comment, false);
    if (!line.ok) return err(...line.errors);
    picks.push({ articleId: articleId as ArticleId, comment: line.value });
  }
  return ok(picks);
}

async function apply(
  ctx: AppContext,
  current: Ranking,
  input: RankingInput,
): Promise<Result<Ranking>> {
  let next = current;
  if (input.title !== undefined) {
    const title = text(input.title, "title", RANKING_LIMITS.title, true);
    if (!title.ok) return err(...title.errors);
    next = { ...next, title: title.value };
  }
  if (input.note !== undefined) {
    const note = text(input.note ?? "", "note", RANKING_LIMITS.note, false);
    if (!note.ok) return err(...note.errors);
    next = { ...next, note: note.value };
  }
  if (input.experienceTag !== undefined) {
    if (input.experienceTag !== null && !isExperienceTag(input.experienceTag))
      return err(fail(`unknown experience tag ${String(input.experienceTag)}`, "experienceTag"));
    next = { ...next, experienceTag: input.experienceTag };
  }
  if (input.picks !== undefined) {
    const picks = await parsePicks(ctx, input.picks);
    if (!picks.ok) return err(...picks.errors);
    next = { ...next, picks: picks.value };
  }
  if (input.sortOrder !== undefined) {
    if (typeof input.sortOrder !== "number" || !Number.isInteger(input.sortOrder))
      return err(fail("sortOrder must be an integer", "sortOrder"));
    next = { ...next, sortOrder: input.sortOrder };
  }
  return ok({ ...next, updatedAt: ctx.clock.now() });
}

/** A new ranking goes to the end of the row and stays off the site until it has picks. */
export async function createRanking(
  ctx: AppContext,
  input: RankingInput,
): Promise<Result<Ranking>> {
  if (input.title === undefined) return err(fail("title is required", "title"));
  const existing = await ctx.repos.rankings.listAll();
  const blank: Ranking = {
    id: ctx.ids.next<RankingId>(),
    title: "",
    note: "",
    experienceTag: null,
    picks: [],
    sortOrder: existing.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 10,
    updatedAt: null,
  };
  const result = await apply(ctx, blank, input);
  if (!result.ok) return result;
  await ctx.repos.rankings.save(result.value);
  ctx.logger.info("ranking.created", { rankingId: result.value.id });
  return result;
}

/**
 * Title, aside, link and picks. The site shows the change after its next
 * build; rankings are never deleted here — emptying the picks hides one.
 */
export async function updateRanking(
  ctx: AppContext,
  id: RankingId,
  input: RankingInput,
): Promise<Result<Ranking>> {
  const current = await ctx.repos.rankings.findById(id);
  if (!current) return err({ code: "RANKING_NOT_FOUND", message: `no ranking ${id}` });
  const result = await apply(ctx, current, input);
  if (!result.ok) return result;
  await ctx.repos.rankings.save(result.value);
  ctx.logger.info("ranking.updated", { rankingId: id, picks: result.value.picks.length });
  return result;
}
