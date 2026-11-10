import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import type { AppContext } from "@tomokichi/application";
import { createApp } from "../app.js";
import type { AuditContext } from "../audit.js";
import type { Env } from "../env.js";

/*
 * Travel knowledge: anyone proposes, only the owner in the admin confirms.
 * A fact never arrives verified through saving, and rewording a verified
 * fact puts it back in question.
 */
const TOKEN = "test-admin-token";
const env = { ADMIN_TOKEN: TOKEN } as unknown as Env;
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const remote: AuditContext = {
  actorType: "remote-operator",
  actorSubject: "owner",
  source: "remote-mcp",
  clientTrust: "unknown",
  operatorWrite: true,
};

let ctx: AppContext;
let admin: ReturnType<typeof createApp>;
let mcp: ReturnType<typeof createApp>;
const call = (app: ReturnType<typeof createApp>, name: string, input: unknown = {}) =>
  app.request(
    `/v1/admin/ops/${name}`,
    { method: "POST", headers: auth, body: JSON.stringify(input) },
    env,
  );

async function article(): Promise<string> {
  const response = await call(admin, "article.create", {
    slug: "toledo",
    path: "/posts/toledo",
    title: "トレドの展望台",
    summary: "歩いて行った",
    bodyMarkdown: "本文".repeat(200),
    seoTitleOverride: null,
    seoDescriptionOverride: null,
    changeSummary: null,
  });
  return ((await response.json()) as { id: string }).id;
}

beforeEach(async () => {
  ctx = await createTestContext();
  admin = createApp({ contextFactory: () => ctx });
  mcp = createApp({
    contextFactory: () => ctx,
    operatorActor: "operator-mcp",
    operatorAuditContext: remote,
  });
});

describe("travel knowledge review", () => {
  it("takes proposals over MCP as candidates that only the admin can confirm", async () => {
    const id = await article();
    expect((await (await call(mcp, "knowledge.backlog")).json()).pending).toBe(0);

    const proposed = await call(mcp, "knowledge.proposeFacts", {
      articleId: id,
      facts: [
        {
          statement: "サン・マルティン橋から展望台まで歩いた。",
          kind: "visit",
          provenance: "firsthand",
          experiencedAt: "2025-02-24",
        },
      ],
    });
    expect(proposed.status).toBe(200);
    const [fact] = ((await proposed.json()) as { added: { id: string; status: string }[] }).added;
    expect(fact?.status).toBe("candidate");

    const pending = (await (await call(mcp, "knowledge.pending")).json()) as {
      items: { id: string; article: { slug: string } }[];
    };
    expect(pending.items.map((item) => [item.id, item.article.slug])).toEqual([
      [fact!.id, "toledo"],
    ]);

    expect(
      (await call(mcp, "knowledge.reviewFact", { factId: fact!.id, decision: "verify" })).status,
    ).toBe(403);
    const verified = await call(admin, "knowledge.reviewFact", {
      factId: fact!.id,
      decision: "verify",
    });
    expect(verified.status).toBe(200);
    expect(((await verified.json()) as { fact: { status: string } }).fact.status).toBe("verified");
    expect((await (await call(admin, "knowledge.pending")).json()).items).toEqual([]);
  });

  it("needs a date for a firsthand fact, and rejecting removes the candidate", async () => {
    const id = await article();
    const undated = await call(mcp, "knowledge.proposeFacts", {
      articleId: id,
      facts: [
        { statement: "歩いた。", kind: "visit", provenance: "firsthand", experiencedAt: null },
      ],
    });
    expect(undated.status).toBe(400);

    const proposed = await call(mcp, "knowledge.proposeFacts", {
      articleId: id,
      facts: [
        { statement: "入場は無料。", kind: "cost", provenance: "derived", experiencedAt: null },
      ],
    });
    const [fact] = ((await proposed.json()) as { added: { id: string }[] }).added;
    const rejected = await call(admin, "knowledge.reviewFact", {
      factId: fact!.id,
      decision: "reject",
    });
    expect(await rejected.json()).toEqual({ fact: null });
    expect(await ctx.repos.knowledge.listTravelFacts()).toEqual([]);
  });

  it("never verifies through saving, and returns a reworded verified fact to the queue", async () => {
    const id = await article();
    const proposed = await call(mcp, "knowledge.proposeFacts", {
      articleId: id,
      facts: [
        {
          statement: "バスで戻った。",
          kind: "transport",
          provenance: "derived",
          experiencedAt: null,
        },
      ],
    });
    const [fact] = ((await proposed.json()) as { added: Record<string, unknown>[] }).added;
    const bundle = (facts: unknown[]) => ({
      articleId: id,
      bundle: { article: null, facts, sources: [], routes: [] },
    });

    const forged = await call(mcp, "knowledge.save", bundle([{ ...fact, status: "verified" }]));
    expect(forged.status).toBe(200);
    expect((await ctx.repos.knowledge.listTravelFacts())[0]?.status).toBe("candidate");

    await call(admin, "knowledge.reviewFact", { factId: fact!["id"], decision: "verify" });
    const verified = (await ctx.repos.knowledge.listTravelFacts())[0]!;
    expect(verified.status).toBe("verified");

    // The same claim saved again stays verified; a different one does not.
    await call(mcp, "knowledge.save", bundle([verified]));
    expect((await ctx.repos.knowledge.listTravelFacts())[0]?.status).toBe("verified");
    await call(mcp, "knowledge.save", bundle([{ ...verified, statement: "L71 バスで戻った。" }]));
    const reworded = (await ctx.repos.knowledge.listTravelFacts())[0]!;
    expect(reworded).toMatchObject({ status: "candidate", verifiedAt: null, verifiedBy: null });
  });
});
