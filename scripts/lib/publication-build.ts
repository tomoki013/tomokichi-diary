import type { SqlDatabase } from "@tomokichi/infra-d1";

/** Code releases and content releases both need a distinct, observable build. */
export async function beginPublicationBuild(
  db: SqlDatabase,
  options: { force: boolean; requestId: string; now: string; buildUrl: string | null },
): Promise<string | null> {
  const row = await db
    .prepare("SELECT requested_id, deployed_id FROM site_publication WHERE id = 'site'")
    .first<{ requested_id: string | null; deployed_id: string | null }>();
  const pending = Boolean(row?.requested_id && row.requested_id !== row.deployed_id);
  if (!options.force && !pending) return null;
  const requestId = pending ? row!.requested_id! : options.requestId;
  // A newer editor request may arrive after the read. Keep it queued rather
  // than replacing it with the code release's request ID.
  await db
    .prepare(
      "UPDATE site_publication SET requested_id = CASE WHEN requested_id IS ? THEN ? ELSE requested_id END, requested_at = CASE WHEN requested_id IS ? THEN ? ELSE requested_at END, building_id = ?, build_url = ?, failed_id = NULL, error = NULL WHERE id = 'site'",
    )
    .bind(
      row?.requested_id ?? null,
      requestId,
      row?.requested_id ?? null,
      options.now,
      requestId,
      options.buildUrl,
    )
    .run();
  return requestId;
}
