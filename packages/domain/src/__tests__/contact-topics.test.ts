import { describe, expect, it } from "vitest";
import {
  CONTACT_LANES,
  CONTACT_LANE_LABELS,
  CONTACT_TOPICS,
  contactTopicsIn,
  findContactTopic,
} from "../rules/contact-topics.js";

describe("contact topics", () => {
  it("finds a topic by the key the form posts and by the label tickets keep", () => {
    expect(findContactTopic("work")).toMatchObject({ label: "お仕事・取材の相談", lane: "media" });
    expect(findContactTopic(" 記事について ")).toMatchObject({ key: "article", lane: "general" });
    expect(findContactTopic("")).toBeUndefined();
    expect(findContactTopic("SEO対策のご提案")).toBeUndefined();
  });

  it("keeps keys and labels unique, so a value never names two topics", () => {
    const names = CONTACT_TOPICS.flatMap((topic) => [
      topic.key,
      topic.label,
      ...(topic.aliases ?? []),
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every lane a label and at least one topic", () => {
    for (const lane of CONTACT_LANES) {
      expect(CONTACT_LANE_LABELS[lane]).not.toBe("");
      expect(contactTopicsIn(lane).length).toBeGreaterThan(0);
    }
  });

  it("fits every label in the subject the form allows", () => {
    for (const topic of CONTACT_TOPICS) expect(topic.label.length).toBeLessThanOrEqual(150);
  });
});
