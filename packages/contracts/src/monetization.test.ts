import { expect, it } from "vitest";
import { adExperimentId, isAdExperimentForArticle, isAdExperimentId } from "./monetization.js";
const article = "ea3bf3bc-ffb6-84ed-8147-188ed74d7a50";
it("binds bounded public experiment identifiers to their article and retains the initial trial", () => {
  expect(isAdExperimentId(adExperimentId(article))).toBe(true);
  expect(isAdExperimentForArticle(adExperimentId(article), article)).toBe(true);
  expect(
    isAdExperimentForArticle(adExperimentId(article), "52b1cb6d-eb74-85a3-b6a1-392f83313051"),
  ).toBe(false);
  expect(
    isAdExperimentForArticle("chagee-placement-v1", "52b1cb6d-eb74-85a3-b6a1-392f83313051"),
  ).toBe(true);
  expect(isAdExperimentForArticle("chagee-placement-v1", article)).toBe(false);
  for (const value of [
    "https://example.com/private",
    "placement-v1-private-label",
    "placement-v1-",
    "random",
    null,
  ])
    expect(isAdExperimentId(value)).toBe(false);
});

it("accepts later rounds of a test on the same article, and only those", () => {
  const uuid = "ea3bf3bc-ffb6-84ed-8147-188ed74d7a50";
  const second = adExperimentId(uuid, 2);
  expect(second).toBe(`placement-v1-${uuid}-r2`);
  expect(isAdExperimentForArticle(second, uuid)).toBe(true);
  expect(isAdExperimentForArticle(adExperimentId(uuid, 42), uuid)).toBe(true);
  for (const value of [
    `${adExperimentId(uuid)}-r1`,
    `${adExperimentId(uuid)}-r100`,
    `${adExperimentId(uuid)}-r02`,
    `${adExperimentId(uuid)}-x2`,
  ])
    expect(isAdExperimentId(value)).toBe(false);
  expect(isAdExperimentForArticle(second, "52b1cb6d-eb74-85a3-b6a1-392f83313051")).toBe(false);
});
