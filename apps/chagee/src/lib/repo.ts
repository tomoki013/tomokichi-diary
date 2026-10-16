import { createRepository, type GuideRepository } from "./db";
import { guideEnv } from "./env";

export function repo(): GuideRepository {
  return createRepository(guideEnv().DB);
}
