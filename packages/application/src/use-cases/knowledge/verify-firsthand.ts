import { verifyFirsthandFact, type AuthorId, type TravelFactId } from "@tomokichi/domain";
import type { AppContext } from "../../context.js";

/** Private control-plane command. No public adapter exposes this command. */
export async function verifyFirsthandCandidate(
  ctx: AppContext,
  factId: TravelFactId,
  authorizedBy: AuthorId,
) {
  const fact = (await ctx.repos.knowledge.listTravelFacts()).find((item) => item.id === factId);
  if (!fact) throw new Error(`travel fact not found: ${factId}`);
  const verified = verifyFirsthandFact(
    fact,
    { kind: "human", authorId: authorizedBy },
    ctx.clock.now().slice(0, 10) as typeof fact.verifiedAt,
  );
  await ctx.repos.knowledge.saveTravelFact(verified);
  return verified;
}
