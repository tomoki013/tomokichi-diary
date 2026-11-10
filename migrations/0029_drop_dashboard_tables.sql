-- The dashboard tasks and ideas were dropped with the admin rebuild (ADR 0011).
-- Nothing reads or writes these tables any more.
DROP INDEX IF EXISTS dashboard_tasks_cause_key;
DROP INDEX IF EXISTS dashboard_tasks_status_priority;
DROP TABLE IF EXISTS dashboard_tasks;
DROP INDEX IF EXISTS dashboard_ideas_linked_article;
DROP INDEX IF EXISTS dashboard_ideas_status_priority;
DROP TABLE IF EXISTS dashboard_ideas;
