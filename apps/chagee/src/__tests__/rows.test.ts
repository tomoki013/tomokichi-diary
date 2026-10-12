import { describe, expect, it } from "vitest";
import { jsonList, toMenu, toStore } from "../lib/rows";

describe("row mapping", () => {
  it("reads malformed JSON columns as empty lists", () => {
    expect(jsonList("{not json", (v): v is string => typeof v === "string")).toEqual([]);
    expect(jsonList('["a", 1, "b"]', (v): v is string => typeof v === "string")).toEqual([
      "a",
      "b",
    ]);
  });

  it("maps a menu row, keeping null rating and dropping bad region notes", () => {
    const m = toMenu({
      id: "1",
      slug: "x",
      tasted: 0,
      editor_rating: null,
      beginner_friendly: 1,
      availability: '[{"country":"cn","note":"上海"},{"country":"zz","note":"?"}]',
      temperatures: '["iced","warm"]',
    });
    expect(m.editorRating).toBeNull();
    expect(m.tasted).toBe(false);
    expect(m.beginnerFriendly).toBe(true);
    expect(m.availability).toEqual([{ country: "cn", note: "上海" }]);
    expect(m.temperatures).toEqual(["iced"]);
  });

  it("maps a store row with empty strings as null", () => {
    const s = toStore({ id: "1", slug: "x", country: "sg", address: "", visited: 1 });
    expect(s.address).toBeNull();
    expect(s.country).toBe("sg");
    expect(s.visited).toBe(true);
  });
});
