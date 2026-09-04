import { App } from "@modelcontextprotocol/ext-apps";

interface Entry {
  title: string;
  summary: string;
  url: string;
  quickAnswer: string | null;
  facts: {
    statement: string;
    provenance: string;
    experiencedAt: string | null;
    verifiedAt: string | null;
  }[];
  sources: { name: string; url: string | null; checkedAt: string | null }[];
}
const status = document.querySelector<HTMLElement>("#status")!;
const items = document.querySelector<HTMLElement>("#items")!;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
const render = (entries: readonly Entry[]) => {
  status.textContent = `${entries.length}件の記録`;
  items.innerHTML = entries
    .map(
      (entry) =>
        `<article><h2><a href="${escape(entry.url)}" target="_blank">${escape(entry.title)}</a></h2><p>${escape(entry.quickAnswer ?? entry.summary)}</p><ul>${entry.facts.map((fact) => `<li>${escape(fact.statement)} <small>${escape(fact.provenance)}${fact.experiencedAt ? `・体験 ${escape(fact.experiencedAt)}` : ""}${fact.verifiedAt ? `・確認 ${escape(fact.verifiedAt)}` : ""}</small></li>`).join("")}</ul>${entry.sources.length > 0 ? `<p><small>出典: ${entry.sources.map((source) => (source.url ? `<a href="${escape(source.url)}" target="_blank">${escape(source.name)}</a>${source.checkedAt ? ` (${escape(source.checkedAt)})` : ""}` : escape(source.name))).join(" / ")}</small></p>` : ""}</article>`,
    )
    .join("");
};
const app = new App({ name: "Tomokichi Travel Evidence", version: "1.0.0" });
app.ontoolresult = (toolResult) => {
  const structured = toolResult.structuredContent as { items?: Entry[] } | undefined;
  render(structured?.items ?? []);
};
void app.connect();
