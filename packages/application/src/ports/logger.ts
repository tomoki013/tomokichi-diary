import type { ErrorCode } from "@tomokichi/contracts";

/** Structured logging only: no long natural-language lines (instruction §61). */
export interface LogFields {
  readonly code?: ErrorCode;
  readonly requestId?: string;
  readonly route?: string;
  readonly articleId?: string;
  readonly durationMs?: number;
  readonly [key: string]: string | number | boolean | undefined;
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
