import type { Instant } from "@tomokichi/domain";
import { instantFrom } from "@tomokichi/domain";

/** Injected so publish/schedule behaviour is deterministic in tests. */
export interface Clock {
  now(): Instant;
}

export const systemClock: Clock = { now: () => instantFrom(Date.now()) };

export function fixedClock(at: Instant): Clock {
  return { now: () => at };
}
