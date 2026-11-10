import type { Handlers } from "./scope.js";
import { analyticsHandlers } from "./handlers/analytics.js";
import { articleHandlers } from "./handlers/articles.js";
import { curationHandlers } from "./handlers/curation.js";
import { inquiryHandlers } from "./handlers/inquiry.js";
import { knowledgeHandlers } from "./handlers/knowledge.js";
import { mediaHandlers } from "./handlers/media.js";
import { monetizationHandlers } from "./handlers/monetization.js";
import { noteHandlers } from "./handlers/notes.js";
import { siteHandlers } from "./handlers/site.js";

/** One handler per operation. The type makes a missing or extra one a compile error. */
export const handlers: Handlers = {
  ...siteHandlers,
  ...articleHandlers,
  ...noteHandlers,
  ...curationHandlers,
  ...mediaHandlers,
  ...monetizationHandlers,
  ...knowledgeHandlers,
  ...analyticsHandlers,
  ...inquiryHandlers,
};
