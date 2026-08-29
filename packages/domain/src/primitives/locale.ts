import { err, ok, type Result } from "./result.js";

export const LOCALES = ["ja", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ja";

export function parseLocale(value: string): Result<Locale> {
  return (LOCALES as readonly string[]).includes(value)
    ? ok(value as Locale)
    : err({
        code: "API_VALIDATION_FAILED",
        message: `unsupported locale: ${value}`,
        field: "locale",
      });
}
