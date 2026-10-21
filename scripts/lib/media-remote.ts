import { createHash } from "node:crypto";

export interface RemoteMediaObject {
  key: string;
  size: number;
  etag: string;
  http_metadata?: { cacheControl?: string };
}

function remoteConfig() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error("Cloudflare media credentials are required");
  const bucket = process.env.MEDIA_BUCKET ?? "tomokichi-diary-media";
  return {
    url: `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects`,
    headers: { authorization: `Bearer ${token}` },
  };
}

/** Fresh origin inventory, never the CDN or a cached upload manifest. */
export async function listRemoteMedia(dispatch = fetch): Promise<Map<string, RemoteMediaObject>> {
  const config = remoteConfig();
  const objects = new Map<string, RemoteMediaObject>();
  let cursor = "";
  const seen = new Set<string>();
  do {
    const query = new URLSearchParams({ per_page: "1000", ...(cursor ? { cursor } : {}) });
    const response = await dispatch(`${config.url}?${query}`, {
      headers: config.headers,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`R2 inventory failed (HTTP ${response.status})`);
    const body = (await response.json()) as {
      success: boolean;
      result: RemoteMediaObject[];
      result_info?: { is_truncated?: boolean; cursor?: string };
    };
    if (!body.success || !Array.isArray(body.result)) throw new Error("Invalid R2 inventory");
    for (const object of body.result) {
      if (
        typeof object.key !== "string" ||
        typeof object.size !== "number" ||
        typeof object.etag !== "string"
      )
        throw new Error("Incomplete R2 object metadata");
      objects.set(object.key, object);
    }
    cursor = body.result_info?.is_truncated ? (body.result_info.cursor ?? "") : "";
    if (body.result_info?.is_truncated && (!cursor || seen.has(cursor)))
      throw new Error("Invalid R2 inventory cursor");
    seen.add(cursor);
  } while (cursor);
  return objects;
}

export const md5 = (body: Buffer) => createHash("md5").update(body).digest("hex");

/** R2 single-part object ETags are byte digests; multipart/unknown ETags fail closed. */
export function matchesRemote(
  body: Buffer,
  object: RemoteMediaObject | undefined,
  cacheControl?: string,
): boolean {
  return Boolean(
    object &&
    object.size === body.length &&
    object.etag.replaceAll('"', "") === md5(body) &&
    (cacheControl === undefined || object.http_metadata?.cacheControl === cacheControl),
  );
}

export async function downloadRemoteMedia(key: string, dispatch = fetch): Promise<Buffer | null> {
  const config = remoteConfig();
  const response = await dispatch(
    `${config.url}/${key.split("/").map(encodeURIComponent).join("/")}`,
    {
      headers: config.headers,
      signal: AbortSignal.timeout(30000),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`R2 download failed (HTTP ${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

/** Rehydrate large caches through public delivery, but certify bytes against
 * the fresh origin inventory. A stale/missing CDN object falls back to R2.
 * This avoids thousands of authenticated REST calls on an empty cache.
 */
export async function downloadDerivative(
  object: RemoteMediaObject,
  dispatch = fetch,
): Promise<Buffer | null> {
  try {
    const url = `https://media.tomokichidiary.com/${object.key.split("/").map(encodeURIComponent).join("/")}`;
    const response = await dispatch(url, { signal: AbortSignal.timeout(30000) });
    if (response.ok) {
      const body = Buffer.from(await response.arrayBuffer());
      if (matchesRemote(body, object)) return body;
    }
  } catch {
    /* Origin fallback still verifies the expected object digest. */
  }
  const body = await downloadRemoteMedia(object.key, dispatch);
  return body && matchesRemote(body, object) ? body : null;
}

export async function concurrent<T>(
  items: readonly T[],
  limit: number,
  action: (item: T) => Promise<void>,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 32)
    throw new Error("Invalid media concurrency");
  const queue = [...items];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await action(item);
    }),
  );
}
