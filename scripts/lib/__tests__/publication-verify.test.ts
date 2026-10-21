import { describe, expect, it, vi } from "vitest";
import { verifyPublication } from "../publication-verify.js";
const release = { requestId: "request-2", buildId: "run-2", snapshotHash: "snapshot-2" };
describe("live publication confirmation", () => {
  it("retries stale edges and confirms all three identities", async () => {
    const dispatch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ...release, buildId: "run-1" }))
      .mockResolvedValueOnce(Response.json(release));
    await verifyPublication(release, "https://test.invalid", dispatch, async () => {});
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(String(dispatch.mock.calls[0]?.[0])).toBe(
      "https://test.invalid/__publication/run-2.json",
    );
  });
  it.each(["missing", "wrong-request", "wrong-content", "network"])(
    "never completes on %s",
    async (condition) => {
      const dispatch: typeof fetch = async () => {
        if (condition === "network") throw new Error("offline");
        if (condition === "missing") return new Response(null, { status: 404 });
        return Response.json({
          ...release,
          ...(condition === "wrong-request" ? { requestId: "old" } : { snapshotHash: "old" }),
        });
      };
      await expect(
        verifyPublication(release, "https://test.invalid", dispatch, async () => {}),
      ).rejects.toThrow("did not match");
    },
  );
});
