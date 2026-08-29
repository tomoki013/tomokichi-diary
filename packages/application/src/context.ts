import type { Clock } from "./ports/clock.js";
import type { IdGenerator } from "./ports/id-generator.js";
import type { Logger } from "./ports/logger.js";
import type { MediaUrlResolver, ObjectStorage } from "./ports/storage.js";
import type { Repositories } from "./ports/repositories.js";
import type { AIProvider } from "./ports/ai.js";

/** Assembled once per request (API) or per build (site generation). */
export interface AppContext {
  readonly repos: Repositories;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly logger: Logger;
  readonly storage: ObjectStorage;
  readonly mediaUrls: MediaUrlResolver;
  /** Null when no provider is configured; every use case must tolerate that. */
  readonly ai: AIProvider | null;
}
