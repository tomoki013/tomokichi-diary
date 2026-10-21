import type { PublicationBuild } from "./publication-build.js";

export async function verifyPublication(
  release: PublicationBuild & { snapshotHash: string },
  origin: string,
  dispatch = fetch,
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 5000)),
) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await dispatch(new URL(`/__publication/${release.buildId}.json`, origin), {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const body = (await response.json()) as {
          requestId?: string;
          buildId?: string;
          snapshotHash?: string;
        };
        if (
          body.requestId === release.requestId &&
          body.buildId === release.buildId &&
          body.snapshotHash === release.snapshotHash
        )
          return;
      }
    } catch {
      /* A temporarily stale edge is retried; it never certifies success. */
    }
    if (attempt < 11) await pause();
  }
  throw new Error("Deployed publication marker did not match this build");
}
