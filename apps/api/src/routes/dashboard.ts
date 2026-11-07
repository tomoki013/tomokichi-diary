import { Hono } from "hono";
import {
  dashboardIdeaInputSchema,
  dashboardTaskInputSchema,
  dashboardTaskStatusSchema,
  validate,
  type DashboardIdeaDto,
  type DashboardTaskDto,
} from "@tomokichi/contracts";
import { fromD1 } from "@tomokichi/infra-d1";
import type { AppEnv } from "../app.js";
import { errorResponse } from "../http.js";

type TaskRow = {
  id: string;
  title: string;
  kind: DashboardTaskDto["kind"];
  priority: DashboardTaskDto["priority"];
  status: DashboardTaskDto["status"];
  source: DashboardTaskDto["source"];
  details: string;
  article_id: string | null;
  cause_key: string | null;
  evidence_start: string | null;
  evidence_end: string | null;
  rule: string | null;
  created_at: string;
  updated_at: string;
};
type IdeaRow = {
  id: string;
  provisional_title: string;
  article_kind: DashboardIdeaDto["articleKind"];
  series_id: string | null;
  summary: string;
  priority: DashboardIdeaDto["priority"];
  status: DashboardIdeaDto["status"];
  related_article_id: string | null;
  linked_article_id: string | null;
  created_at: string;
  updated_at: string;
};
const toTask = (row: TaskRow): DashboardTaskDto => ({
  id: row.id,
  title: row.title,
  kind: row.kind,
  priority: row.priority,
  status: row.status,
  source: row.source,
  details: row.details,
  articleId: row.article_id,
  causeKey: row.cause_key,
  evidenceStart: row.evidence_start,
  evidenceEnd: row.evidence_end,
  rule: row.rule,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const toIdea = (row: IdeaRow): DashboardIdeaDto => ({
  id: row.id,
  provisionalTitle: row.provisional_title,
  articleKind: row.article_kind,
  seriesId: row.series_id,
  summary: row.summary,
  priority: row.priority,
  status: row.status,
  relatedArticleId: row.related_article_id,
  linkedArticleId: row.linked_article_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const validDate = (value: string | null) =>
  value === null ||
  (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
const validId = (value: string) => /^[A-Za-z0-9_-]{1,100}$/.test(value);

export function dashboardRoutes() {
  const routes = new Hono<AppEnv>();
  routes.use("*", async (c, next) => {
    await next();
    c.header("cache-control", "private, no-store");
    c.header("x-robots-tag", "noindex, nofollow");
  });

  routes.get("/tasks", async (c) => {
    const rows = await fromD1(c.env.DB)
      .prepare(
        "SELECT id,title,kind,priority,status,source,details,article_id,cause_key,evidence_start,evidence_end,rule,created_at,updated_at FROM dashboard_tasks ORDER BY CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, updated_at DESC",
      )
      .all<TaskRow>();
    return c.json({ items: rows.map(toTask) });
  });

  routes.post("/tasks", async (c) => {
    const parsed = validate(dashboardTaskInputSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "タスク内容を確認してください", 400, parsed.issues);
    const input = { ...parsed.value, title: parsed.value.title.trim() };
    if (!input.title || (input.source === "recommendation") !== (input.causeKey !== null))
      return errorResponse(c, "API_VALIDATION_FAILED", "タスクの登録元を確認してください", 400);
    if (!validDate(input.evidenceStart) || !validDate(input.evidenceEnd))
      return errorResponse(c, "API_VALIDATION_FAILED", "根拠期間の日付を確認してください", 400);
    if (input.evidenceStart && input.evidenceEnd && input.evidenceStart > input.evidenceEnd)
      return errorResponse(c, "API_VALIDATION_FAILED", "根拠期間の開始日が終了日より後です", 400);

    const db = fromD1(c.env.DB);
    if (input.articleId) {
      const article = await db
        .prepare("SELECT id FROM articles WHERE id = ?")
        .bind(input.articleId)
        .first();
      if (!article) return errorResponse(c, "ARTICLE_NOT_FOUND", "対象の記事がありません", 404);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db
      .prepare(
        "INSERT OR IGNORE INTO dashboard_tasks (id,title,kind,priority,status,source,details,article_id,cause_key,evidence_start,evidence_end,rule,created_at,updated_at) VALUES (?,?,?,?, 'todo',?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        input.title,
        input.kind,
        input.priority,
        input.source,
        input.details,
        input.articleId,
        input.causeKey,
        input.evidenceStart,
        input.evidenceEnd,
        input.rule,
        now,
        now,
      )
      .run();
    const row = input.causeKey
      ? await db
          .prepare(
            "SELECT id,title,kind,priority,status,source,details,article_id,cause_key,evidence_start,evidence_end,rule,created_at,updated_at FROM dashboard_tasks WHERE cause_key = ?",
          )
          .bind(input.causeKey)
          .first<TaskRow>()
      : await db
          .prepare(
            "SELECT id,title,kind,priority,status,source,details,article_id,cause_key,evidence_start,evidence_end,rule,created_at,updated_at FROM dashboard_tasks WHERE id = ?",
          )
          .bind(id)
          .first<TaskRow>();
    if (!row) return errorResponse(c, "API_INTERNAL", "タスクを保存できませんでした", 500);
    return c.json({ item: toTask(row), created: row.id === id }, row.id === id ? 201 : 200);
  });

  routes.patch("/tasks/:id", async (c) => {
    const id = c.req.param("id");
    if (!validId(id)) return errorResponse(c, "API_VALIDATION_FAILED", "タスクIDが不正です", 400);
    const parsed = validate(dashboardTaskStatusSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "タスクの状態を確認してください", 400, parsed.issues);
    const db = fromD1(c.env.DB);
    await db
      .prepare("UPDATE dashboard_tasks SET status = ?, updated_at = ? WHERE id = ?")
      .bind(parsed.value.status, new Date().toISOString(), id)
      .run();
    const row = await db
      .prepare(
        "SELECT id,title,kind,priority,status,source,details,article_id,cause_key,evidence_start,evidence_end,rule,created_at,updated_at FROM dashboard_tasks WHERE id = ?",
      )
      .bind(id)
      .first<TaskRow>();
    return row
      ? c.json({ item: toTask(row) })
      : errorResponse(c, "API_NOT_FOUND", "タスクがありません", 404);
  });

  routes.get("/ideas", async (c) => {
    const rows = await fromD1(c.env.DB)
      .prepare(
        "SELECT id,provisional_title,article_kind,series_id,summary,priority,status,related_article_id,linked_article_id,created_at,updated_at FROM dashboard_ideas ORDER BY CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, updated_at DESC",
      )
      .all<IdeaRow>();
    return c.json({ items: rows.map(toIdea) });
  });

  routes.post("/ideas", async (c) => {
    const parsed = validate(dashboardIdeaInputSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "企画内容を確認してください", 400, parsed.issues);
    const input = { ...parsed.value, provisionalTitle: parsed.value.provisionalTitle.trim() };
    if (!input.provisionalTitle)
      return errorResponse(c, "API_VALIDATION_FAILED", "仮タイトルを入力してください", 400);
    const db = fromD1(c.env.DB);
    const relationError = await validateIdeaRelations(db, input);
    if (relationError)
      return errorResponse(c, relationError.code, relationError.message, relationError.status);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await db
        .prepare(
          "INSERT INTO dashboard_ideas (id,provisional_title,article_kind,series_id,summary,priority,status,related_article_id,linked_article_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          input.provisionalTitle,
          input.articleKind,
          input.seriesId,
          input.summary,
          input.priority,
          input.status,
          input.relatedArticleId,
          input.linkedArticleId,
          now,
          now,
        )
        .run();
    } catch {
      return errorResponse(c, "API_CONFLICT", "この記事は別の企画に関連付け済みです", 409);
    }
    const row = await db
      .prepare(
        "SELECT id,provisional_title,article_kind,series_id,summary,priority,status,related_article_id,linked_article_id,created_at,updated_at FROM dashboard_ideas WHERE id = ?",
      )
      .bind(id)
      .first<IdeaRow>();
    return row
      ? c.json({ item: toIdea(row) }, 201)
      : errorResponse(c, "API_INTERNAL", "企画を保存できませんでした", 500);
  });

  routes.put("/ideas/:id", async (c) => {
    const id = c.req.param("id");
    if (!validId(id)) return errorResponse(c, "API_VALIDATION_FAILED", "企画IDが不正です", 400);
    const parsed = validate(dashboardIdeaInputSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "企画内容を確認してください", 400, parsed.issues);
    const input = { ...parsed.value, provisionalTitle: parsed.value.provisionalTitle.trim() };
    if (!input.provisionalTitle)
      return errorResponse(c, "API_VALIDATION_FAILED", "仮タイトルを入力してください", 400);
    const db = fromD1(c.env.DB);
    const existing = await db
      .prepare("SELECT id FROM dashboard_ideas WHERE id = ?")
      .bind(id)
      .first();
    if (!existing) return errorResponse(c, "API_NOT_FOUND", "企画がありません", 404);
    const relationError = await validateIdeaRelations(db, input);
    if (relationError)
      return errorResponse(c, relationError.code, relationError.message, relationError.status);
    const duplicate = input.linkedArticleId
      ? await db
          .prepare("SELECT id FROM dashboard_ideas WHERE linked_article_id = ? AND id <> ?")
          .bind(input.linkedArticleId, id)
          .first()
      : null;
    if (duplicate)
      return errorResponse(c, "API_CONFLICT", "この記事は別の企画に関連付け済みです", 409);
    try {
      await db
        .prepare(
          "UPDATE dashboard_ideas SET provisional_title=?,article_kind=?,series_id=?,summary=?,priority=?,status=?,related_article_id=?,linked_article_id=?,updated_at=? WHERE id=?",
        )
        .bind(
          input.provisionalTitle,
          input.articleKind,
          input.seriesId,
          input.summary,
          input.priority,
          input.status,
          input.relatedArticleId,
          input.linkedArticleId,
          new Date().toISOString(),
          id,
        )
        .run();
    } catch {
      return errorResponse(c, "API_CONFLICT", "企画を更新できませんでした", 409);
    }
    const row = await db
      .prepare(
        "SELECT id,provisional_title,article_kind,series_id,summary,priority,status,related_article_id,linked_article_id,created_at,updated_at FROM dashboard_ideas WHERE id = ?",
      )
      .bind(id)
      .first<IdeaRow>();
    return row
      ? c.json({ item: toIdea(row) })
      : errorResponse(c, "API_INTERNAL", "企画を更新できませんでした", 500);
  });

  return routes;
}

async function validateIdeaRelations(
  db: ReturnType<typeof fromD1>,
  input: {
    seriesId: string | null;
    relatedArticleId: string | null;
    linkedArticleId: string | null;
    articleKind: DashboardIdeaDto["articleKind"];
  },
) {
  if (input.seriesId) {
    const series = await db
      .prepare("SELECT id FROM collections WHERE id = ? AND kind = 'series'")
      .bind(input.seriesId)
      .first();
    if (!series)
      return {
        code: "COLLECTION_NOT_FOUND" as const,
        message: "シリーズがありません",
        status: 404 as const,
      };
  }
  for (const articleId of [input.relatedArticleId, input.linkedArticleId]) {
    if (!articleId) continue;
    const article = await db
      .prepare("SELECT id,kind FROM articles WHERE id = ?")
      .bind(articleId)
      .first<{ id: string; kind: string }>();
    if (!article)
      return {
        code: "ARTICLE_NOT_FOUND" as const,
        message: "関連付ける記事がありません",
        status: 404 as const,
      };
    if (articleId === input.linkedArticleId && article.kind !== input.articleKind)
      return {
        code: "API_VALIDATION_FAILED" as const,
        message: "企画と関連付ける記事の種別が一致しません",
        status: 400 as const,
      };
  }
  return null;
}
