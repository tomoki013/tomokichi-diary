export class AnalyticsHttpError extends Error {
  constructor(public status: number) {
    super(`ANALYTICS_HTTP_${status}`);
  }
}
export async function requestJson<T>(
  url: string,
  init: RequestInit,
  send = fetch,
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response: Response;
    try {
      response = await send(url, { ...init, signal: AbortSignal.timeout(30000) });
    } catch {
      if (attempt === 3) throw new Error("ANALYTICS_NETWORK_FAILURE");
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (response.ok) return (await response.json()) as T;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3)
      throw new AnalyticsHttpError(response.status);
    await sleep(500 * 2 ** attempt);
  }
  throw new Error("ANALYTICS_NETWORK_FAILURE");
}
