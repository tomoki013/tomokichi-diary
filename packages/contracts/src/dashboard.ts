import { v, type Validator } from "./validation.js";

export const DASHBOARD_TASK_KINDS = [
  "seo",
  "rewrite",
  "ad_test",
  "affiliate",
  "publish",
  "planning",
  "operations",
] as const;
export const DASHBOARD_TASK_PRIORITIES = ["P1", "P2", "P3"] as const;
export const DASHBOARD_TASK_STATUSES = ["todo", "in_progress", "done", "hold"] as const;
export const DASHBOARD_TASK_SOURCES = ["manual", "recommendation"] as const;
export const DASHBOARD_IDEA_STATUSES = [
  "planning",
  "drafting",
  "ready",
  "scheduled",
  "hold",
] as const;

export interface DashboardTaskDto {
  id: string;
  title: string;
  kind: (typeof DASHBOARD_TASK_KINDS)[number];
  priority: (typeof DASHBOARD_TASK_PRIORITIES)[number];
  status: (typeof DASHBOARD_TASK_STATUSES)[number];
  source: (typeof DASHBOARD_TASK_SOURCES)[number];
  details: string;
  articleId: string | null;
  causeKey: string | null;
  evidenceStart: string | null;
  evidenceEnd: string | null;
  rule: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardTaskInput {
  title: string;
  kind: DashboardTaskDto["kind"];
  priority: DashboardTaskDto["priority"];
  source: DashboardTaskDto["source"];
  details: string;
  articleId: string | null;
  causeKey: string | null;
  evidenceStart: string | null;
  evidenceEnd: string | null;
  rule: string | null;
}

export interface DashboardIdeaDto {
  id: string;
  provisionalTitle: string;
  articleKind: "article" | "page";
  seriesId: string | null;
  summary: string;
  priority: DashboardTaskDto["priority"];
  status: (typeof DASHBOARD_IDEA_STATUSES)[number];
  relatedArticleId: string | null;
  linkedArticleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardIdeaInput {
  provisionalTitle: string;
  articleKind: DashboardIdeaDto["articleKind"];
  seriesId: string | null;
  summary: string;
  priority: DashboardIdeaDto["priority"];
  status: DashboardIdeaDto["status"];
  relatedArticleId: string | null;
  linkedArticleId: string | null;
}

export const dashboardTaskInputSchema: Validator<DashboardTaskInput> = v.object({
  title: v.string({ min: 1, max: 180 }),
  kind: v.literalUnion(DASHBOARD_TASK_KINDS),
  priority: v.literalUnion(DASHBOARD_TASK_PRIORITIES),
  source: v.literalUnion(DASHBOARD_TASK_SOURCES),
  details: v.string({ max: 2000 }),
  articleId: v.nullable(v.string({ min: 1, max: 100, pattern: /^[A-Za-z0-9_-]+$/ })),
  causeKey: v.nullable(v.string({ min: 1, max: 180, pattern: /^[A-Za-z0-9:._-]+$/ })),
  evidenceStart: v.nullable(v.string({ pattern: /^\d{4}-\d\d-\d\d$/ })),
  evidenceEnd: v.nullable(v.string({ pattern: /^\d{4}-\d\d-\d\d$/ })),
  rule: v.nullable(v.string({ max: 500 })),
});

export const dashboardIdeaInputSchema: Validator<DashboardIdeaInput> = v.object({
  provisionalTitle: v.string({ min: 1, max: 180 }),
  articleKind: v.literalUnion(["article", "page"]),
  seriesId: v.nullable(v.string({ min: 1, max: 100, pattern: /^[A-Za-z0-9_-]+$/ })),
  summary: v.string({ max: 3000 }),
  priority: v.literalUnion(DASHBOARD_TASK_PRIORITIES),
  status: v.literalUnion(DASHBOARD_IDEA_STATUSES),
  relatedArticleId: v.nullable(v.string({ min: 1, max: 100, pattern: /^[A-Za-z0-9_-]+$/ })),
  linkedArticleId: v.nullable(v.string({ min: 1, max: 100, pattern: /^[A-Za-z0-9_-]+$/ })),
});

export const dashboardTaskStatusSchema: Validator<{ status: DashboardTaskDto["status"] }> =
  v.object({ status: v.literalUnion(DASHBOARD_TASK_STATUSES) });

export const dashboardIdeaLinkSchema: Validator<{
  linkedArticleId: string | null;
}> = v.object({
  linkedArticleId: v.nullable(v.string({ min: 1, max: 100, pattern: /^[A-Za-z0-9_-]+$/ })),
});
