import { describe, expect, it } from "vitest";
import type { LocationDto, SitePublicationStatus } from "@tomokichi/contracts";
import { addMissing, locationTagIds, removeAdded } from "./relation-defaults";
import { seriesSiteState } from "./series-site";

const site = (overrides: Partial<SitePublicationStatus>): SitePublicationStatus => ({
  state: "deployed",
  configured: true,
  requestId: "r1",
  buildId: null,
  stage: null,
  requestedAt: "2026-10-28T01:00:00.000Z",
  startedAt: null,
  stageStartedAt: null,
  deployedAt: "2026-10-28T01:05:00.000Z",
  durationMs: null,
  elapsedMs: null,
  errorCode: null,
  buildUrl: null,
  error: null,
  stages: {},
  ...overrides,
});

describe("seriesSiteState", () => {
  const saved = "2026-10-28T00:30:00.000Z";
  it("is deployed only by a build requested after the save", () => {
    expect(seriesSiteState(saved, site({}), false).tone).toBe("ok");
    const before = site({ requestedAt: "2026-10-28T00:00:00.000Z" });
    expect(seriesSiteState(saved, before, false)).toMatchObject({ tone: "warn", canPublish: true });
  });
  it("tells a running or failed build apart", () => {
    expect(seriesSiteState(saved, site({ state: "building" }), false).tone).toBe("accent");
    expect(seriesSiteState(saved, site({ state: "failed" }), false)).toMatchObject({
      tone: "danger",
      canPublish: true,
    });
  });
  it("does not claim anything for unsaved edits", () => {
    expect(seriesSiteState(saved, site({}), true).canPublish).toBe(false);
  });
});

describe("relation defaults", () => {
  it("reports only what it added, and removes only that", () => {
    const { next, added } = addMissing(["a"], ["a", "b", "b"]);
    expect(next).toEqual(["a", "b"]);
    expect(added).toEqual(["b"]);
    expect(removeAdded(next, added)).toEqual(["a"]);
    expect(removeAdded(next, added, ["b"])).toEqual(["a", "b"]);
  });

  const locations: LocationDto[] = [
    { id: "asia", slug: "asia", type: "continent", parentId: null, name: "アジア" },
    { id: "jp", slug: "japan", type: "country", parentId: "asia", name: "日本" },
    { id: "kyoto", slug: "kyoto", type: "city", parentId: "jp", name: "京都" },
    { id: "th", slug: "thailand", type: "country", parentId: "asia", name: "タイ" },
    { id: "bkk", slug: "bangkok", type: "city", parentId: "th", name: "バンコク" },
  ];
  const tags = [
    { id: "t-asia", name: "アジア" },
    { id: "t-thai", name: "タイ" },
    { id: "t-home", name: "国内旅行" },
    { id: "t-abroad", name: "海外旅行" },
  ];

  it("picks the tags a place decides", () => {
    expect(locationTagIds("bkk", locations, tags).toSorted()).toEqual(
      ["t-abroad", "t-asia", "t-thai"].toSorted(),
    );
    expect(locationTagIds("kyoto", locations, tags).toSorted()).toEqual(["t-asia", "t-home"]);
    // A continent alone says nothing about whether the trip was abroad.
    expect(locationTagIds("asia", locations, tags)).toEqual(["t-asia"]);
    expect(locationTagIds("missing", locations, tags)).toEqual([]);
  });
});
