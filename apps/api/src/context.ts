import type { AppContext } from "@tomokichi/application";
import { systemClock, uuidV7Generator } from "@tomokichi/application";
import { createRepositories, fromD1 } from "@tomokichi/infra-d1";
import { createMediaUrlResolver, createR2Storage } from "@tomokichi/infra-r2";
import type { Env } from "./env.js";
import { createLogger } from "./logging.js";

/** Composition root: bindings in, ports out. Assembled once per request. */
export function createContext(env: Env, requestId: string): AppContext {
  return {
    repos: createRepositories(fromD1(env.DB)),
    clock: systemClock,
    ids: uuidV7Generator,
    logger: createLogger(requestId),
    storage: createR2Storage(env.MEDIA),
    mediaUrls: createMediaUrlResolver(env.PUBLIC_MEDIA_URL ?? "https://media.tomokichidiary.com"),
    // No AI provider is configured; every use case must work without one.
    ai: null,
  };
}
