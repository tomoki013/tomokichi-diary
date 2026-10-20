import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guards the colour pairs the design spec (docs/design/design-system.md §4.3)
// relies on. Values are read from tokens.css, so a palette change that breaks
// WCAG 2.2 AA fails here instead of on the live site.

const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

const declared = new Map<string, string>();
for (const [, name = "", value = ""] of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
  if (!declared.has(name)) declared.set(name, value.trim());
}

function resolve(token: string, seen = new Set<string>()): string {
  const value = declared.get(token);
  if (!value) throw new Error(`${token} is not declared in tokens.css`);
  const alias = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  if (!alias) return value;
  if (seen.has(token)) throw new Error(`${token} aliases itself`);
  return resolve(alias, seen.add(token));
}

function channel(hex: string, at: number): number {
  const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const digits = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!digits) throw new Error(`${hex} is not a 6-digit hex colour`);
  return 0.2126 * channel(digits, 0) + 0.7152 * channel(digits, 2) + 0.0722 * channel(digits, 4);
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const color = (value: string) => (value.startsWith("--") ? resolve(value) : value);

// [foreground, background, minimum ratio, what it is]
const pairs: Array<[string, string, number, string]> = [
  ["--ink", "--bg", 7, "body text on the page (AAA)"],
  ["--ink", "--surface", 7, "body text on cards (AAA)"],
  ["--ink", "--surface-alt", 4.5, "text on the alternate surface"],
  ["--ink", "--surface-warm", 4.5, "text on the warm surface"],
  ["--ink-soft", "--bg", 4.5, "secondary text on the page"],
  ["--ink-soft", "--surface", 4.5, "secondary text on cards"],
  ["--ink-faint", "--bg", 4.5, "meta text on the page"],
  ["--ink-faint", "--accent-tint", 4.5, "meta text on the accent tint"],
  ["--accent", "--bg", 4.5, "links on the page"],
  ["--accent", "--surface", 4.5, "links on cards"],
  ["--accent", "--accent-tint", 4.5, "links on the accent tint"],
  ["--accent-strong", "--accent-tint", 4.5, "hovered links on the accent tint"],
  ["#ffffff", "--accent", 4.5, "primary CTA label"],
  ["#ffffff", "--accent-strong", 4.5, "hovered primary CTA label"],
  ["--on-dark", "--surface-dark", 4.5, "text on dark panels"],
  ["--on-dark-soft", "--surface-dark", 4.5, "secondary text on dark panels"],
  ["--accent-on-dark", "--surface-dark", 4.5, "links on dark panels"],
  ["--color-state-error", "--surface", 4.5, "error message"],
  ["--color-state-success", "--surface", 4.5, "success message"],
  ["--line-strong", "--bg", 3, "input and control borders (non-text)"],
  ["--line-strong", "--surface", 3, "input borders on cards (non-text)"],
  ["--focus-ring", "--bg", 3, "focus ring on the page (non-text)"],
  ["--focus-ring", "--surface", 3, "focus ring on cards (non-text)"],
  ["--accent", "--bg", 3, "map pins and active-tab rules (non-text)"],
];

describe("design tokens", () => {
  it.each(pairs)("%s on %s reaches %s:1 (%s)", (fg, bg, min) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(min);
  });

  it("keeps Soft Clay out of text: it fails 4.5:1 on the page", () => {
    // If this ever passes, the "decoration only" rule can be relaxed.
    expect(contrast(resolve("--color-brand-soft"), resolve("--bg"))).toBeLessThan(4.5);
  });

  it("matches the ratios the spec publishes", () => {
    const ratio = (a: string, b: string) =>
      Math.round(contrast(resolve(a), resolve(b)) * 100) / 100;
    expect(ratio("--color-text-primary", "--color-background-base")).toBe(15.51);
    expect(ratio("--color-text-secondary", "--color-background-base")).toBe(9.67);
    expect(ratio("--color-brand-strong", "--color-background-base")).toBe(5.14);
    expect(ratio("--color-border-interactive", "--color-background-base")).toBe(3.64);
  });
});
