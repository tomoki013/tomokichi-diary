import { createApp } from "./app.js";
import { createContext } from "./context.js";
import type { Env } from "./env.js";
import { publishDueArticles, requestPublication } from "./publication.js";

const app = createApp();
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    if (await publishDueArticles(createContext(env, crypto.randomUUID())))
      await requestPublication(env);
  },
};
