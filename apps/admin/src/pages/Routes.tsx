import { useMemo, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useResource, useTitle } from "../ui/hooks";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../ui/parts";
import { useToast } from "../ui/toast";

const KINDS = [
  { key: "all", label: "すべて" },
  { key: "canonical", label: "正規 URL" },
  { key: "redirect", label: "リダイレクト" },
] as const;

/**
 * Every URL the site answers, and the one tool for changing one: a move keeps
 * the old address alive as a redirect, so links and search results survive.
 */
export function Routes() {
  useTitle("URL");
  const toast = useToast();
  const routes = useResource(() => api.listRoutes().then((r) => r.items), "routes");
  const integrity = useResource(() => api.routeIntegrity(), "integrity");
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim();
    return (routes.data ?? [])
      .filter((route) =>
        kind === "all"
          ? true
          : kind === "canonical"
            ? route.isCanonical
            : route.redirectTo !== null,
      )
      .filter(
        (route) =>
          needle === "" || route.path.includes(needle) || (route.redirectTo ?? "").includes(needle),
      )
      .toSorted((a, b) => a.path.localeCompare(b.path));
  }, [routes.data, kind, query]);

  async function move(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const from = String(form.get("from")).trim();
    const to = String(form.get("to")).trim();
    const status = String(form.get("status")) as "301" | "302" | "308";
    if (
      !globalThis.confirm(
        `${from} を ${to} に移動し、元の URL は ${status} でリダイレクトします。よろしいですか？`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.moveRoute(from, to, status);
      toast.info("URL を移動しました");
      formElement.reset();
      await Promise.all([routes.reload(), integrity.reload()]);
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="URL" meta={routes.data && `${routes.data.length}件`} />

      <div className="grid-2">
        <Panel
          title="整合性チェック"
          actions={
            <button type="button" onClick={() => void integrity.reload()}>
              再チェック
            </button>
          }
        >
          {integrity.error ? (
            <ErrorState error={integrity.error} />
          ) : !integrity.data ? (
            <SkeletonRows rows={2} />
          ) : integrity.data.ok ? (
            <p className="ok-line">問題はありません</p>
          ) : (
            <ul className="problems">
              {integrity.data.problems.map((problem) => (
                <li key={`${problem.code}-${problem.target ?? ""}`}>
                  <code>{problem.code}</code> {problem.message}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="URL を移動">
          <form className="form-grid" onSubmit={(event) => void move(event)}>
            <label className="field">
              <span>今の URL</span>
              <input
                name="from"
                required
                pattern="/.*"
                placeholder="/posts/old-slug"
                list="route-paths"
              />
            </label>
            <label className="field">
              <span>新しい URL</span>
              <input name="to" required pattern="/.*" placeholder="/posts/new-slug" />
            </label>
            <label className="field">
              <span>リダイレクト</span>
              <select name="status" defaultValue="301">
                <option value="301">301（恒久）</option>
                <option value="308">308（恒久・メソッド維持）</option>
                <option value="302">302（一時）</option>
              </select>
            </label>
            <div className="form-actions">
              <button type="submit" className="primary" disabled={busy}>
                移動する
              </button>
            </div>
            <datalist id="route-paths">
              {(routes.data ?? [])
                .filter((route) => route.isCanonical)
                .map((route) => (
                  <option key={route.path} value={route.path} aria-label={route.path} />
                ))}
            </datalist>
          </form>
        </Panel>
      </div>

      <div className="toolbar">
        <fieldset className="chips">
          <legend className="sr-only">種類で絞り込む</legend>
          {KINDS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="chip"
              aria-pressed={kind === entry.key}
              onClick={() => setKind(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </fieldset>
        <input
          type="search"
          aria-label="URL を検索"
          placeholder="/posts/…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <Panel className="panel--flush">
        {routes.error ? (
          <ErrorState error={routes.error} onRetry={() => void routes.reload()} />
        ) : routes.loading && !routes.data ? (
          <SkeletonRows rows={10} />
        ) : visible.length === 0 ? (
          <EmptyState>該当する URL はありません。</EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>URL</th>
                <th>種類</th>
                <th>行き先</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 500).map((route) => (
                <tr key={route.path}>
                  <td className="mono">{route.path}</td>
                  <td className="nowrap">
                    {route.redirectTo ? (
                      <Badge tone="warn">リダイレクト</Badge>
                    ) : route.isCanonical ? (
                      <Badge tone="ok">正規</Badge>
                    ) : (
                      <Badge>別名</Badge>
                    )}
                    {route.noindex && <Badge>noindex</Badge>}
                  </td>
                  <td className="mono muted">
                    {route.redirectTo ??
                      `${route.targetType}${route.targetId ? `:${route.targetId}` : ""}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {visible.length > 500 && (
          <p className="muted small">先頭 500 件を表示しています。検索で絞り込んでください。</p>
        )}
      </Panel>
    </>
  );
}
