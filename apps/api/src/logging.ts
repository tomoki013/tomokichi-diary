import type { LogFields, Logger } from "@tomokichi/application";

/**
 * Structured logs only, one JSON object per line, always carrying the request
 * id so a problem can be followed across the request (instruction §48, §49).
 * Bodies, tokens and cookies are never logged (§50).
 */
export function createLogger(requestId: string): Logger {
  const emit = (level: string, event: string, fields?: LogFields): void => {
    console.log(JSON.stringify({ level, event, requestId, ...fields }));
  };
  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}
