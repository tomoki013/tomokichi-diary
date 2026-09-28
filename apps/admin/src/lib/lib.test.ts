import { describe, expect, it } from "vitest";
import type { ArticleDetailDto } from "@tomokichi/contracts";
import type { LocationDto } from "@tomokichi/contracts";
import { href, parseRoute, section } from "./route";
import { treeOrder } from "./locations";
import { bodyStats, draftFrom, isDirty, normalizeDraft } from "./draft";
import {
  formatDateTime,
  formatRelative,
  isoToJstLocal,
  isOpenTicket,
  jstLocalToIso,
} from "./labels";

describe("parseRoute", () => {
  it.each([
    ["", { name: "dashboard" }],
    ["#/", { name: "dashboard" }],
    ["#/articles", { name: "articles" }],
    ["#/articles/", { name: "articles" }],
    ["#/articles/a%2Fb", { name: "article", id: "a/b" }],
    ["#/media", { name: "media" }],
    ["#/routes", { name: "routes" }],
    ["#/inquiries", { name: "inquiries" }],
    ["#/inquiries/archive", { name: "legacy-messages" }],
    ["#/inquiries/t-1", { name: "inquiry", id: "t-1" }],
  ])("reads %s", (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected);
  });

  it.each(["#/nope", "#/media/x", "#/articles/a/b"])("does not guess at %s", (hash) => {
    expect(parseRoute(hash).name).toBe("not-found");
  });

  it("round-trips every link it builds", () => {
    expect(parseRoute(href.article("x y"))).toEqual({ name: "article", id: "x y" });
    expect(parseRoute(href.inquiry("TK/1"))).toEqual({ name: "inquiry", id: "TK/1" });
    expect(parseRoute(href.legacyMessages()).name).toBe("legacy-messages");
  });

  it("puts detail screens under their list in the menu", () => {
    expect(section({ name: "article", id: "a" })).toBe("articles");
    expect(section({ name: "legacy-messages" })).toBe("inquiries");
    expect(section({ name: "not-found", path: "/x" })).toBeNull();
  });
});

describe("drafts", () => {
  const article = {
    currentRevision: {
      title: "タイトル",
      summary: "要約",
      bodyMarkdown: "本文",
      seoTitleOverride: null,
      seoDescriptionOverride: null,
    },
  } as unknown as ArticleDetailDto;

  it("starts clean from the current revision", () => {
    const draft = draftFrom(article);
    expect(isDirty(draft, draftFrom(article))).toBe(false);
    expect(isDirty({ ...draft, bodyMarkdown: "本文！" }, draftFrom(article))).toBe(true);
  });

  it("does not count a change note, or an emptied override, as an edit", () => {
    const saved = draftFrom(article);
    expect(isDirty({ ...saved, changeSummary: "typo" }, saved)).toBe(false);
    expect(isDirty({ ...saved, seoTitleOverride: "" }, saved)).toBe(false);
    expect(isDirty({ ...saved, seoTitleOverride: "SEO" }, saved)).toBe(true);
  });

  it("sends blank overrides as null so the site generates them", () => {
    const normalized = normalizeDraft({
      ...draftFrom(article),
      seoTitleOverride: "  ",
      seoDescriptionOverride: "説明",
      changeSummary: "",
    });
    expect(normalized).toMatchObject({
      seoTitleOverride: null,
      seoDescriptionOverride: "説明",
      changeSummary: null,
    });
  });

  it("starts an article without a revision empty", () => {
    const draft = draftFrom({ currentRevision: null } as unknown as ArticleDetailDto);
    expect(draft.title).toBe("");
  });

  it("counts characters without whitespace", () => {
    expect(bodyStats("あい う\nえ")).toEqual({ characters: 4, minutes: 1 });
    expect(bodyStats("あ".repeat(1500)).minutes).toBe(3);
  });
});

describe("dates", () => {
  it("shows Japan time whatever the browser's zone", () => {
    expect(formatDateTime("2026-09-27T04:40:00.000Z")).toBe("2026/09/27 13:40");
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("nonsense")).toBe("—");
  });

  it("reads the schedule picker as Japan time", () => {
    expect(jstLocalToIso("2026-10-01T09:00")).toBe("2026-10-01T00:00:00.000Z");
    expect(jstLocalToIso("2026-10-01")).toBeNull();
    expect(isoToJstLocal("2026-10-01T00:00:00.000Z")).toBe("2026-10-01T09:00");
    expect(isoToJstLocal(null)).toBe("");
  });

  it("says how long ago, then falls back to the date", () => {
    const now = Date.parse("2026-09-27T12:00:00.000Z");
    expect(formatRelative("2026-09-27T11:59:50.000Z", now)).toBe("たった今");
    expect(formatRelative("2026-09-27T11:45:00.000Z", now)).toBe("15分前");
    expect(formatRelative("2026-09-27T09:00:00.000Z", now)).toBe("3時間前");
    expect(formatRelative("2026-09-20T12:00:00.000Z", now)).toBe("7日前");
    expect(formatRelative("2026-06-01T00:00:00.000Z", now)).toBe("2026/06/01");
  });
});

describe("tickets", () => {
  it("treats only resolved and closed as done", () => {
    expect(isOpenTicket("NEW")).toBe(true);
    expect(isOpenTicket("WAITING_CUSTOMER")).toBe(true);
    expect(isOpenTicket("RESOLVED")).toBe(false);
    expect(isOpenTicket("CLOSED")).toBe(false);
  });
});

const at = (id: string, name: string, parentId: string | null): LocationDto => ({
  id,
  slug: id,
  type: "city",
  parentId,
  name,
});

describe("treeOrder", () => {
  it("puts parents before children, siblings in reading order", () => {
    const tree = treeOrder([
      at("abusimbel", "アブシンベル", "egypt"),
      at("asia", "アジア", null),
      at("egypt", "エジプト", "africa"),
      at("africa", "アフリカ", null),
      at("aswan", "アスワン", "egypt"),
    ]);
    expect(tree.map(({ location, depth }) => `${depth}:${location.id}`)).toEqual([
      "0:asia",
      "0:africa",
      "1:egypt",
      "2:aswan",
      "2:abusimbel",
    ]);
  });

  it("keeps a location whose parent is missing, and survives a cycle", () => {
    const orphan = treeOrder([at("x", "X", "gone")]);
    expect(orphan).toEqual([{ location: at("x", "X", "gone"), depth: 0 }]);
    // a → b → a: neither is a root, so neither is reachable; nothing hangs.
    expect(treeOrder([at("a", "A", "b"), at("b", "B", "a")])).toEqual([]);
  });
});
