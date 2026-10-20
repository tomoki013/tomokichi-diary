import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forget, onShelfChange, remember, shelf } from "../lib/my-trips";

/*
 * The shelf is the reader's only record of what they liked. These pin the
 * behaviour the UI relies on: a re-read never moves or re-dates a story, old
 * likes are not pushed out, and the store failing never breaks the page.
 */

const KEY = "tomokichi-my-trips";
let store: Map<string, string>;
let listeners: Map<string, ((event: unknown) => void)[]>;
let flag: boolean;

function stubBrowser({ broken = false } = {}) {
  store = new Map();
  listeners = new Map();
  flag = false;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => {
      if (broken) throw new Error("denied");
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (broken) throw new Error("denied");
      store.set(key, value);
    },
  });
  vi.stubGlobal("addEventListener", (name: string, callback: (event: unknown) => void) =>
    listeners.set(name, [...(listeners.get(name) ?? []), callback]),
  );
  vi.stubGlobal("dispatchEvent", (event: { type: string }) => {
    listeners.get(event.type)?.forEach((callback) => callback(event));
    return true;
  });
  vi.stubGlobal("document", {
    documentElement: {
      toggleAttribute: (_name: string, on: boolean) => {
        flag = on;
      },
    },
  });
}

beforeEach(() => {
  stubBrowser();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("my-trips shelf", () => {
  it("keeps a story's place and date when it is remembered again", () => {
    remember("liked", "/posts/a", "A");
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    remember("liked", "/posts/b", "B");
    remember("liked", "/posts/a", "A");
    expect(shelf("liked")).toEqual([
      { path: "/posts/b", title: "B", at: "2026-10-05T00:00:00.000Z" },
      { path: "/posts/a", title: "A", at: "2026-10-01T00:00:00.000Z" },
    ]);
  });

  it("reads the existing stored shape without migration and skips broken entries", () => {
    store.set(
      KEY,
      JSON.stringify({
        liked: [{ path: "/posts/old", title: "Old", at: "2025-01-01T00:00:00Z" }, { nope: 1 }],
        shared: [],
      }),
    );
    expect(shelf("liked")).toEqual([
      { path: "/posts/old", title: "Old", at: "2025-01-01T00:00:00Z" },
    ]);
  });

  it("no longer drops the oldest likes past 50", () => {
    for (let index = 0; index < 120; index += 1) remember("liked", `/posts/${index}`, `S${index}`);
    expect(shelf("liked")).toHaveLength(120);
    expect(shelf("liked").at(-1)?.path).toBe("/posts/0");
  });

  it("notifies this tab and other tabs, and mirrors the has-liked flag", () => {
    const seen = vi.fn();
    onShelfChange(seen);
    remember("liked", "/posts/a", "A");
    expect(seen).toHaveBeenCalledTimes(1);
    expect(flag).toBe(true);
    forget("liked", "/posts/a");
    expect(flag).toBe(false);
    forget("liked", "/posts/a");
    expect(seen).toHaveBeenCalledTimes(2);
    listeners.get("storage")?.forEach((callback) => callback({ key: "unrelated" }));
    listeners.get("storage")?.forEach((callback) => callback({ key: KEY }));
    expect(seen).toHaveBeenCalledTimes(3);
  });

  it("keeps working when storage is refused", () => {
    stubBrowser({ broken: true });
    expect(() => remember("liked", "/posts/a", "A")).not.toThrow();
    expect(() => forget("liked", "/posts/a")).not.toThrow();
    expect(shelf("liked")).toEqual([]);
  });
});
